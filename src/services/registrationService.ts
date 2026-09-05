// src/services/registrationService.ts
//
// The concurrency-critical core of the app. Every mutation that touches
// Registration.status goes through this file — never call
// `prisma.registration.update({ data: { status } })` directly from a route
// handler or Server Action, or you bypass the state machine, the capacity
// check, and the audit trail.
//
// Locking strategy: Option A from docs/BUSINESS_LOGIC.md — a pessimistic
// `SELECT ... FOR UPDATE` on the row being contended (the Session row for
// seat reservation, the Registration row for status transitions), inside a
// `ReadCommitted` transaction. This serializes concurrent writers on the
// same row instead of aborting-and-retrying, which is easier to reason
// about under bursty contention on a single popular session.

import { Prisma, RegistrationStatus, type Registration } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { RESERVATION_EXPIRY_MINUTES, EXPIRE_BATCH_SIZE } from "../lib/config";
import { assertSessionAccess, getAssignedSessionIdsOrNull } from "../lib/permissions";
import type { SessionUser } from "../lib/auth";
import {
  NotFoundError,
  ValidationError,
  CapacityExceededError,
  DuplicateRegistrationError,
  InvalidTransitionError,
} from "../lib/errors";

type Tx = Prisma.TransactionClient;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shared email-format check so every entry point (direct calls, bulk CSV import) agrees on what "valid" means. */
export function isValidEmailFormat(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

// ----------------------------------------------------------------------
// State machine
// ----------------------------------------------------------------------

/**
 * Legal forward transitions from each status. Anything not listed here
 * (including transitioning a status to itself) is rejected by
 * `assertLegalTransition`. Mirrors docs/BUSINESS_LOGIC.md §2 exactly —
 * keep the two in sync if this ever changes.
 */
const ALLOWED_TRANSITIONS: Record<RegistrationStatus, RegistrationStatus[]> = {
  RESERVED: ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: [],
  CANCELLED: [],
  EXPIRED: [],
};

function assertLegalTransition(from: RegistrationStatus, to: RegistrationStatus): void {
  if (from === to) {
    throw new InvalidTransitionError(`Registration is already ${from}.`);
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    if (from === "CHECKED_IN") {
      throw new InvalidTransitionError(
        "This attendee has already been checked in and cannot be cancelled or otherwise modified."
      );
    }
    if (from === "CANCELLED" || from === "EXPIRED") {
      throw new InvalidTransitionError(
        `Registration is ${from}, which is a terminal state — it cannot be changed.`
      );
    }
    const allowed = ALLOWED_TRANSITIONS[from];
    throw new InvalidTransitionError(
      `Cannot move registration from ${from} to ${to}. Allowed transitions from ${from}: ${
        allowed.length ? allowed.join(", ") : "none (terminal state)"
      }.`
    );
  }
}

// ----------------------------------------------------------------------
// Capacity helpers
// ----------------------------------------------------------------------

const OCCUPYING_STATUSES: RegistrationStatus[] = ["RESERVED", "CONFIRMED", "CHECKED_IN"];

async function getOccupiedCount(tx: Tx, sessionId: string): Promise<number> {
  return tx.registration.count({
    where: { sessionId, status: { in: OCCUPYING_STATUSES } },
  });
}

/**
 * Re-evaluates whether a session should have an ACTIVE capacity alert and
 * creates one if it just crossed the threshold with nothing already active.
 *
 * Re-trigger semantics (brief requirement #4): we never resolve an ACTIVE
 * alert automatically when the count drops back below capacity — only an
 * explicit `dismissCapacityAlert` clears it. That's precisely what makes a
 * later refill "re-trigger": once dismissed, the next call that finds
 * `occupied >= capacity` sees no ACTIVE row and inserts a fresh one,
 * producing a full history of every threshold breach.
 *
 * Must be called from inside the same transaction as the mutation that
 * changed the occupied count, so the count it evaluates against can't be
 * stale by the time the alert is written.
 */
async function evaluateCapacityAlert(
  tx: Tx,
  sessionId: string,
  occupiedCount: number,
  capacity: number
): Promise<void> {
  if (occupiedCount < capacity) return;

  const active = await tx.capacityAlert.findFirst({
    where: { sessionId, status: "ACTIVE" },
    select: { id: true },
  });
  if (active) return; // already alerted; nothing to do until it's dismissed

  try {
    await tx.capacityAlert.create({
      data: { sessionId, status: "ACTIVE", currentCount: occupiedCount, capacity },
    });
  } catch (err) {
    // [DB backstop] The partial unique index `UNIQUE (sessionId) WHERE
    // status = 'ACTIVE'` (see prisma/migrations_manual/001_extra_constraints.sql)
    // can reject this insert if a concurrent transaction created the ACTIVE
    // alert a moment ago. That's not an error from the caller's point of
    // view — an alert exists either way — so swallow only that specific
    // unique-constraint violation and re-throw anything else.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return;
    }
    throw err;
  }
}

/**
 * Active (undismissed) capacity alerts visible to this user, scoped the
 * same way search results are: Organizers see every active alert,
 * Check-in Staff only see alerts for sessions they're assigned to. Backs
 * the top-nav alert badge/dropdown.
 */
export type ActiveAlertSummary = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  eventName: string;
  currentCount: number;
  capacity: number;
  triggeredAt: Date;
};

export async function listActiveAlerts(user: SessionUser): Promise<ActiveAlertSummary[]> {
  const assignedSessionIds = await getAssignedSessionIdsOrNull(user);
  if (assignedSessionIds !== null && assignedSessionIds.length === 0) return [];

  const alerts = await prisma.capacityAlert.findMany({
    where: {
      status: "ACTIVE",
      ...(assignedSessionIds !== null ? { sessionId: { in: assignedSessionIds } } : {}),
    },
    orderBy: { triggeredAt: "desc" },
    include: { session: { select: { title: true, event: { select: { name: true } } } } },
  });

  return (alerts as any[]).map((a) => ({
    id: a.id,
    sessionId: a.sessionId,
    sessionTitle: a.session.title,
    eventName: a.session.event.name,
    currentCount: a.currentCount,
    capacity: a.capacity,
    triggeredAt: a.triggeredAt,
  }));
}

// ----------------------------------------------------------------------
// getRegistrationById — detail view read, RBAC-checked
// ----------------------------------------------------------------------

export type RegistrationDetail = Registration & {
  session: { id: string; title: string; eventId: string; eventName: string };
  timeline: {
    id: string;
    actorId: string | null;
    actorName: string | null;
    oldStatus: RegistrationStatus | null;
    newStatus: RegistrationStatus;
    note: string | null;
    timestamp: Date;
  }[];
};

/**
 * Loads a single registration plus its immutable timeline (each entry
 * resolved with the actor's display name, or null for system actions) for
 * the detail page. Enforces the same session-scoping rule as every other
 * read/write here.
 */
export async function getRegistrationById(
  registrationId: string,
  actorUser: SessionUser
): Promise<RegistrationDetail> {
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: {
      session: { select: { id: true, title: true, eventId: true, event: { select: { name: true } } } },
      timeline: {
        orderBy: { timestamp: "asc" },
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!registration) throw new NotFoundError("Registration not found.");

  const reg = registration as any;
  await assertSessionAccess(actorUser, reg.sessionId);

  return {
    ...reg,
    session: {
      id: reg.session.id,
      title: reg.session.title,
      eventId: reg.session.eventId,
      eventName: reg.session.event.name,
    },
    timeline: reg.timeline.map((t: any) => ({
      id: t.id,
      actorId: t.actorId,
      actorName: t.actor?.name ?? null,
      oldStatus: t.oldStatus,
      newStatus: t.newStatus,
      note: t.note,
      timestamp: t.timestamp,
    })),
  };
}

/**
 * Dismisses the current ACTIVE alert for a session. No-op (throws
 * NotFoundError) if there isn't one — dismissing is only meaningful against
 * a live alert. The row is updated, never deleted, so the trigger/dismiss
 * history stays intact for organizer reporting.
 */
export async function dismissCapacityAlert(
  alertId: string,
  actorUser: SessionUser
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const alert = await tx.capacityAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundError("Capacity alert not found.");
    if (alert.status === "DISMISSED") {
      throw new ValidationError("This alert has already been dismissed.");
    }

    await assertSessionAccess(actorUser, alert.sessionId);

    await tx.capacityAlert.update({
      where: { id: alertId },
      data: { status: "DISMISSED", dismissedAt: new Date(), dismissedById: actorUser.id },
    });
  });
}

// ----------------------------------------------------------------------
// Timeline helper
// ----------------------------------------------------------------------

async function appendTimeline(
  tx: Tx,
  registrationId: string,
  actorId: string | null,
  oldStatus: RegistrationStatus | null,
  newStatus: RegistrationStatus,
  note?: string
): Promise<void> {
  await tx.registrationTimeline.create({
    data: { registrationId, actorId, oldStatus, newStatus, note },
  });
  // [DB] This table only ever receives INSERTs from this codebase, and the
  // manual migration additionally REVOKEs UPDATE/DELETE at the DB-role
  // level — see prisma/migrations_manual/001_extra_constraints.sql — so the
  // append-only guarantee holds even against a future bug elsewhere in the
  // app, not just "we promise not to update this table."
}

// ----------------------------------------------------------------------
// Lazy expiry
// ----------------------------------------------------------------------
//
// See docs/decisions.md #4 — this project started with a cron-only expiry
// sweep (expireStaleReservations, below) and later added this lazy path
// after finding a correctness gap: a RESERVED row whose expiresAt has
// already passed but that the cron job hasn't reached yet was still being
// counted as "occupying a seat" and was still eligible to be CONFIRMED,
// which is wrong on both counts. These helpers close that gap by expiring
// stale rows the instant something touches them, with the sweep left in
// place as a backstop for reservations nobody ever revisits.

/** Expires every stale RESERVED registration in a session, under a lock the caller already holds. */
async function lazilyExpireStaleForSession(tx: Tx, sessionId: string): Promise<void> {
  const stale = await tx.registration.findMany({
    where: { sessionId, status: "RESERVED", expiresAt: { lt: new Date() } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await tx.registration.update({ where: { id }, data: { status: "EXPIRED" } });
    await appendTimeline(
      tx,
      id,
      null,
      "RESERVED",
      "EXPIRED",
      `Lazily expired on access after ${RESERVATION_EXPIRY_MINUTES}-minute reservation window`
    );
  }
}

// ----------------------------------------------------------------------
// reserveSeat
// ----------------------------------------------------------------------

/**
 * Reserves a seat in a session. Race-condition-safe: locks the Session row
 * with `SELECT ... FOR UPDATE`, counts currently-occupying registrations
 * under that lock, and only inserts if there's room — all inside one
 * transaction, so two concurrent callers can never both squeeze into the
 * last seat.
 *
 * `actorUser` is nullable to support anonymous public self-service
 * registration (createdById = null on the row, actorId = null on the
 * timeline entry, matching the seed data's "self-service" narrative). When
 * `actorUser` is a Check-in Staff member, they must be assigned to the
 * session — Organizers and anonymous public callers are always allowed.
 */
export async function reserveSeat(
  sessionId: string,
  attendeeName: string,
  attendeeEmail: string,
  actorUser: SessionUser | null,
  attendeePhone?: string
): Promise<Registration> {
  if (!attendeeName?.trim()) {
    throw new ValidationError("Attendee name is required.");
  }
  if (!attendeeEmail?.trim() || !isValidEmailFormat(attendeeEmail)) {
    throw new ValidationError(`"${attendeeEmail}" is not a valid email address.`);
  }
  if (actorUser && actorUser.role === "CHECK_IN_STAFF") {
    await assertSessionAccess(actorUser, sessionId);
  }

  return prisma.$transaction(
    async (tx) => {
      // 1. Lock the session row so concurrent reservations against it serialize.
      const locked = await tx.$queryRaw<{ id: string; capacity: number }[]>(
        Prisma.sql`SELECT "id", "capacity" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`
      );
      const session = locked[0];
      if (!session) throw new NotFoundError("Session not found.");

      // 1b. Lazily expire any RESERVED rows in this session whose window has
      // already lapsed, before we count occupied seats or check duplicates —
      // otherwise a stale reservation the cron sweep hasn't reached yet would
      // wrongly still occupy a seat and wrongly still block a re-registration
      // from the same email. Safe under the session lock we already hold.
      await lazilyExpireStaleForSession(tx, sessionId);

      // 2. Reject duplicate *active* registrations for this email+session,
      //    under the same lock (the partial unique index in the manual
      //    migration is the DB-level backstop for this same rule).
      const existingActive = await tx.registration.findFirst({
        where: {
          sessionId,
          attendeeEmail: attendeeEmail.trim(),
          status: { in: OCCUPYING_STATUSES },
        },
        select: { id: true, status: true },
      });
      if (existingActive) {
        throw new DuplicateRegistrationError(
          `${attendeeEmail} already has a ${existingActive.status.toLowerCase()} registration for this session.`
        );
      }

      // 3. Count seats currently occupying capacity, under the same lock.
      const occupied = await getOccupiedCount(tx, sessionId);
      if (occupied >= session.capacity) {
        throw new CapacityExceededError(
          `Session is at capacity (${occupied}/${session.capacity}). No seats available.`
        );
      }

      // 4. Insert the registration + its opening timeline entry.
      const registration = await tx.registration.create({
        data: {
          sessionId,
          attendeeName: attendeeName.trim(),
          attendeeEmail: attendeeEmail.trim(),
          attendeePhone: attendeePhone?.trim() || undefined,
          status: "RESERVED",
          reservedAt: new Date(),
          expiresAt: new Date(Date.now() + RESERVATION_EXPIRY_MINUTES * 60_000),
          createdById: actorUser?.id ?? null,
        },
      });

      await appendTimeline(
        tx,
        registration.id,
        actorUser?.id ?? null,
        null,
        "RESERVED",
        actorUser ? "Reservation created by staff/organizer" : "Self-service registration created"
      );

      // 5. Re-evaluate the capacity alert with the up-to-date count.
      await evaluateCapacityAlert(tx, sessionId, occupied + 1, session.capacity);

      return registration;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

// ----------------------------------------------------------------------
// updateRegistrationStatus
// ----------------------------------------------------------------------

/**
 * Drives the Registration through the state machine
 * (Reserved -> Confirmed -> Checked In; Reserved/Confirmed -> Cancelled).
 * Locks the Registration row, validates the transition, applies the
 * corresponding timestamp/field updates, appends a timeline entry, and
 * re-evaluates the session's capacity alert — all atomically.
 *
 * Runs as TWO transactions, not one — see docs/decisions.md #4. The first
 * lazily expires the row if it's a stale RESERVED reservation the cron
 * sweep hasn't reached yet, and always commits. The second authorizes and
 * applies the transition the caller actually asked for, against whatever
 * status is current *after* that possible expiry. Combining both into a
 * single transaction was the first approach tried, but it has a bug: if
 * the requested transition (e.g. CONFIRMED) is then rejected as illegal
 * because the row turned out to be EXPIRED, throwing inside that shared
 * transaction rolls back the expiry write too — leaving a registration
 * that is, in the database, still RESERVED and still past its expiry,
 * ready to trip the exact same bug on the next request.
 */
export async function updateRegistrationStatus(
  registrationId: string,
  newStatus: RegistrationStatus,
  actorUser: SessionUser,
  note?: string
): Promise<Registration> {
  // Step 1: lock the row, lazily expire it if stale, and commit regardless
  // of what happens next.
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string; sessionId: string; status: RegistrationStatus; expiresAt: Date | null }[]
    >(
      Prisma.sql`SELECT "id", "sessionId", "status", "expiresAt" FROM "registrations" WHERE "id" = ${registrationId} FOR UPDATE`
    );
    const current = locked[0];
    if (!current) throw new NotFoundError("Registration not found.");

    if (current.status === "RESERVED" && current.expiresAt && current.expiresAt < new Date()) {
      await tx.registration.update({ where: { id: registrationId }, data: { status: "EXPIRED" } });
      await appendTimeline(
        tx,
        registrationId,
        null,
        "RESERVED",
        "EXPIRED",
        `Lazily expired on access after ${RESERVATION_EXPIRY_MINUTES}-minute reservation window`
      );
      const sessionRow = await tx.session.findUniqueOrThrow({
        where: { id: current.sessionId },
        select: { capacity: true },
      });
      const occupied = await getOccupiedCount(tx, current.sessionId);
      await evaluateCapacityAlert(tx, current.sessionId, occupied, sessionRow.capacity);
    }
  });

  // Step 2: authorize + apply the requested transition, against whatever
  // status is current now (possibly EXPIRED as of the step above).
  return prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; sessionId: string; status: RegistrationStatus }[]
      >(
        Prisma.sql`SELECT "id", "sessionId", "status" FROM "registrations" WHERE "id" = ${registrationId} FOR UPDATE`
      );
      const current = locked[0];
      if (!current) throw new NotFoundError("Registration not found.");

      await assertSessionAccess(actorUser, current.sessionId);
      assertLegalTransition(current.status, newStatus);

      const now = new Date();
      const data: Prisma.RegistrationUpdateInput = { status: newStatus };
      if (newStatus === "CONFIRMED") {
        data.confirmedAt = now;
        data.expiresAt = null; // no longer subject to reservation expiry
      } else if (newStatus === "CHECKED_IN") {
        data.checkedInAt = now;
      } else if (newStatus === "CANCELLED") {
        data.cancelledAt = now;
        data.cancelReason = note ?? null;
      } else if (newStatus === "EXPIRED") {
        // handled primarily by expireStaleReservations()/the lazy step above,
        // but allowed here too for an organizer manually forcing an expiry.
      }

      const registration = await tx.registration.update({
        where: { id: registrationId },
        data,
      });

      await appendTimeline(
        tx,
        registrationId,
        actorUser.id,
        current.status,
        newStatus,
        note
      );

      // Cancelling/expiring frees a seat; confirming/checking-in doesn't
      // change the occupied count (RESERVED already counted). Recomputing
      // unconditionally is cheap (indexed count) and keeps this correct even
      // if a session's capacity was edited after the fact.
      const sessionRow = await tx.session.findUniqueOrThrow({
        where: { id: current.sessionId },
        select: { capacity: true },
      });
      const occupied = await getOccupiedCount(tx, current.sessionId);
      await evaluateCapacityAlert(tx, current.sessionId, occupied, sessionRow.capacity);

      return registration;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
  );
}

// ----------------------------------------------------------------------
// expireStaleReservations
// ----------------------------------------------------------------------

export type ExpireStaleReservationsResult = {
  scanned: number;
  expired: number;
  skipped: number; // rows that were no longer RESERVED by the time we locked them
};

/**
 * Batch job (run from a cron endpoint / scheduled task every minute — see
 * docs/BUSINESS_LOGIC.md §4). Finds RESERVED registrations whose
 * `expiresAt` has elapsed and transitions each to EXPIRED, one small
 * transaction per row so a single slow/contended row can't hold up the
 * whole batch or block unrelated reservations for the duration of a large
 * scan.
 *
 * Each row is re-checked *after* acquiring its lock (status still RESERVED,
 * expiresAt still elapsed) before writing, in case a user confirmed it in
 * the moment between the initial scan and the lock being granted.
 */
export async function expireStaleReservations(): Promise<ExpireStaleReservationsResult> {
  const now = new Date();

  const candidates = await prisma.registration.findMany({
    where: { status: "RESERVED", expiresAt: { lt: now } },
    select: { id: true },
    take: EXPIRE_BATCH_SIZE,
  });

  let expired = 0;
  let skipped = 0;

  for (const { id } of candidates) {
    const didExpire = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; sessionId: string; status: RegistrationStatus; expiresAt: Date | null }[]
      >(Prisma.sql`SELECT "id", "sessionId", "status", "expiresAt" FROM "registrations" WHERE "id" = ${id} FOR UPDATE`);
      const reg = locked[0];

      if (!reg || reg.status !== "RESERVED" || !reg.expiresAt || reg.expiresAt >= new Date()) {
        return false; // someone confirmed/cancelled it, or it's not actually stale anymore
      }

      await tx.registration.update({
        where: { id: reg.id },
        data: { status: "EXPIRED" },
      });

      await appendTimeline(
        tx,
        reg.id,
        null, // system action
        "RESERVED",
        "EXPIRED",
        `Auto-expired by system after ${RESERVATION_EXPIRY_MINUTES}-minute reservation window`
      );

      const sessionRow = await tx.session.findUniqueOrThrow({
        where: { id: reg.sessionId },
        select: { capacity: true },
      });
      const occupied = await getOccupiedCount(tx, reg.sessionId);
      await evaluateCapacityAlert(tx, reg.sessionId, occupied, sessionRow.capacity);

      return true;
    });

    if (didExpire) expired += 1;
    else skipped += 1;
  }

  return { scanned: candidates.length, expired, skipped };
}
