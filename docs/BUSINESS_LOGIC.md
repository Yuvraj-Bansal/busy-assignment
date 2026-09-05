# Business Logic Reference — Event Registration System

This document is the companion to `prisma/schema.prisma`. The schema says
*what* is stored; this document says *how* the rules in the brief are
enforced, and specifically **which layer (database vs. application) owns
each rule**.

---

## 1. RBAC Matrix

| Action                                   | Organizer | Check-in Staff                  |
|-------------------------------------------|:---------:|:--------------------------------:|
| Create / edit / delete Events              | ✅        | ❌                               |
| Create / edit / delete Sessions, capacity  | ✅        | ❌                               |
| Assign staff to sessions                   | ✅        | ❌                               |
| View all sessions & registrations          | ✅        | ⚠️ assigned sessions only        |
| Reserve a seat                             | ✅        | ⚠️ assigned sessions only        |
| Check in an attendee                       | ✅        | ⚠️ assigned sessions only        |
| Cancel a registration                      | ✅        | ⚠️ assigned sessions only        |
| Dismiss a capacity alert                   | ✅        | ⚠️ assigned sessions only        |
| View dashboard / analytics (Recharts)      | ✅        | ❌ (org-wide) / ✅ (own sessions) |

**[DB]** `Role` enum on `User` restricts every account to one of the two
values. **[APP]** The *scoping* of Check-in Staff to "assigned sessions
only" is authorization logic, not a schema constraint — it is implemented
as a query-time filter joined through `SessionAssignment`:

```ts
// lib/auth/scope.ts
async function assertStaffCanActOnSession(userId: string, sessionId: string) {
  const assignment = await prisma.sessionAssignment.findUnique({
    where: { sessionId_userId: { sessionId, userId } },
  });
  if (!assignment) {
    throw new ForbiddenError(
      "You are not assigned to this session and cannot perform this action."
    );
  }
}
```

Every Server Action / API route that mutates a Registration or dismisses an
Alert calls this guard first when `session.user.role === "CHECK_IN_STAFF"`.
Organizers skip the check entirely (full access by role).

---

## 2. Registration State Machine

```
                 ┌────────────┐
   create ─────► │  RESERVED  │
                 └─────┬──────┘
             confirm   │   │  cancel        (system) expire
                       │   └───────────► CANCELLED
                       ▼
                 ┌────────────┐
                 │ CONFIRMED  │
                 └─────┬──────┘
             check-in  │   │  cancel
                       │   └───────────► CANCELLED
                       ▼
                 ┌────────────┐
                 │ CHECKED_IN │  (terminal — no transitions out)
                 └────────────┘

   RESERVED  ──(expiresAt elapsed, still RESERVED)──► EXPIRED   (terminal)
```

**[APP]** Legal transition table, enforced in a single `transitionRegistration()`
service function that every mutation (confirm / check-in / cancel / expire)
goes through — never a raw `prisma.registration.update({ data: { status } })`
call from a route handler:

| From         | To           | Allowed | Notes |
|--------------|---------------|:-------:|-------|
| RESERVED     | CONFIRMED     | ✅ | must be before `expiresAt` |
| RESERVED     | CANCELLED     | ✅ | attendee or staff cancel |
| RESERVED     | EXPIRED       | ✅ | system-only, cron/lazy-check |
| CONFIRMED    | CHECKED_IN    | ✅ | staff/organizer only |
| CONFIRMED    | CANCELLED     | ✅ | |
| CHECKED_IN   | *(anything)*  | ❌ | "Cannot cancel a registration that has already been checked in." |
| CANCELLED    | *(anything)*  | ❌ | terminal |
| EXPIRED      | *(anything)*  | ❌ | terminal |
| any status   | same status   | ❌ | "Registration is already {status}." |

```ts
// lib/registrations/transition.ts
const ALLOWED: Record<RegistrationStatus, RegistrationStatus[]> = {
  RESERVED:   ["CONFIRMED", "CANCELLED", "EXPIRED"],
  CONFIRMED:  ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: [],
  CANCELLED:  [],
  EXPIRED:    [],
};

export function assertLegalTransition(from: RegistrationStatus, to: RegistrationStatus) {
  if (!ALLOWED[from]?.includes(to)) {
    throw new InvalidTransitionError(
      `Cannot move registration from ${from} to ${to}. ` +
      (from === "CHECKED_IN"
        ? "This attendee has already been checked in and cannot be cancelled."
        : `Allowed transitions from ${from}: ${ALLOWED[from]?.join(", ") || "none (terminal state)"}.`)
    );
  }
}
```

Every successful transition writes exactly one `RegistrationTimeline` row in
the *same* database transaction as the `Registration.status` update, so the
audit trail can never drift from the actual current state.

---

## 3. Hard Capacity Enforcement (Race-Condition-Safe)

**[APP + DB]** The comparison `count <= capacity` is application logic, but
it is only *safe* because it runs inside a transaction that takes a
row-level lock on the Session before counting. Two implementation options,
both valid — pick one per your Postgres/Prisma version:

### Option A — `SELECT ... FOR UPDATE` (pessimistic lock, recommended default)

```ts
export async function reserveSeat(sessionId: string, attendee: AttendeeInput, actorId: string | null) {
  return prisma.$transaction(async (tx) => {
    // 1. Lock the session row so concurrent reservations serialize on it.
    const [session] = await tx.$queryRaw<{ id: string; capacity: number }[]>`
      SELECT id, capacity FROM sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    if (!session) throw new NotFoundError("Session not found.");

    // 2. Count seats that currently occupy capacity, under the same lock.
    const occupied = await tx.registration.count({
      where: { sessionId, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } },
    });

    if (occupied >= session.capacity) {
      throw new CapacityExceededError(
        `Session is at capacity (${occupied}/${session.capacity}). No seats available.`
      );
    }

    // 3. Insert + timeline row, still inside the lock.
    const reg = await tx.registration.create({
      data: {
        sessionId,
        attendeeName: attendee.name,
        attendeeEmail: attendee.email,
        attendeePhone: attendee.phone,
        status: "RESERVED",
        expiresAt: addMinutes(new Date(), RESERVATION_EXPIRY_MINUTES),
        createdById: actorId,
      },
    });
    await tx.registrationTimeline.create({
      data: { registrationId: reg.id, actorId, oldStatus: null, newStatus: "RESERVED", note: "Reservation created" },
    });

    // 4. Re-evaluate the capacity alert for this session (see §5) inside the same lock.
    await evaluateCapacityAlert(tx, sessionId, occupied + 1, session.capacity);

    return reg;
  }, { isolationLevel: "ReadCommitted" }); // FOR UPDATE lock makes ReadCommitted sufficient
}
```

### Option B — `SERIALIZABLE` transaction (optimistic, retry-on-conflict)

```ts
await prisma.$transaction(async (tx) => {
  // same body as above, minus the explicit FOR UPDATE
}, { isolationLevel: "Serializable" });
// Caller must catch Postgres error 40001 (serialization_failure) and retry
// with exponential backoff — Postgres aborts one of the two conflicting
// transactions rather than blocking, unlike Option A.
```

The brief explicitly allows either; **Option A is simpler to reason about
under high contention on a single hot session** (e.g. a popular keynote)
because it blocks-and-queues instead of aborting-and-retrying, so it's the
default recommendation. Cancel/check-in/confirm follow the identical
lock-then-mutate pattern (lock the session, or lock the specific
Registration row with `SELECT ... FOR UPDATE` scoped to `registrations`
when the action doesn't need a fresh capacity count, e.g. plain check-in).

---

## 4. Expiry Window

**[APP]** Two complementary mechanisms, used together:

1. **Lazy / on-read expiry** — any query path that reads a `RESERVED`
   registration first checks `expiresAt < now()` and, if true, transitions
   it to `EXPIRED` before returning it. This guarantees correctness even if
   the background job below is delayed or down.
2. **Active background job** — a scheduled job (Vercel Cron / node-cron)
   runs every minute:
   ```ts
   const stale = await prisma.registration.findMany({
     where: { status: "RESERVED", expiresAt: { lt: new Date() } },
     select: { id: true, sessionId: true },
   });
   for (const r of stale) {
     await transitionRegistration(r.id, "EXPIRED", {
       actorId: null, // system action
       note: `Auto-expired by system after ${RESERVATION_EXPIRY_MINUTES}-minute reservation window`,
     });
   }
   ```
   Expiring a registration also frees a seat, so it re-runs the same
   `evaluateCapacityAlert` re-trigger check as a cancellation (§5) — an
   expiry can just as validly cause a session to drop *out* of alert range.

`X` (the expiry window) is an environment variable
(`RESERVATION_EXPIRY_MINUTES`), not hardcoded, so organizers can tune it
per deployment without a schema change.

---

## 5. Capacity Alerts & Re-Triggering

**[APP]** After every mutation that changes occupied-seat count (reserve,
confirm has no effect on count, cancel, expire, check-in has no effect on
count), recompute against the threshold and reconcile:

```ts
async function evaluateCapacityAlert(tx: PrismaTx, sessionId: string, occupied: number, capacity: number) {
  const active = await tx.capacityAlert.findFirst({
    where: { sessionId, status: "ACTIVE" },
  });

  const isAtOrOverCapacity = occupied >= capacity;

  if (isAtOrOverCapacity && !active) {
    // Crossed the threshold and nothing is currently active -> trigger
    // (covers first-time trigger AND re-trigger after a prior dismissal).
    await tx.capacityAlert.create({
      data: { sessionId, status: "ACTIVE", currentCount: occupied, capacity },
    });
  }
  // If isAtOrOverCapacity is false, we deliberately do NOT auto-resolve an
  // ACTIVE alert — an organizer must explicitly dismiss it (the brief only
  // specifies "dismissal tracking", not auto-resolution). This also means
  // "drops below max and later fills back up" naturally re-triggers: the
  // dismiss action is what clears `active`, so the next threshold-crossing
  // insert of a NEW row is exactly the re-trigger the brief asks for.
}
```

Dismissal is a plain update of the *existing* ACTIVE row
(`status: "DISMISSED"`, `dismissedAt`, `dismissedById`) — never a delete,
preserving history. The **[DB] partial unique index**
`UNIQUE (sessionId) WHERE status = 'ACTIVE'` (see
`prisma/migrations_manual/001_extra_constraints.sql`) is what makes this
safe under concurrency: two simultaneous reservations both crossing the
threshold at once can't both insert an ACTIVE row — the second insert fails
the unique constraint and the transaction catches it as a no-op (alert
already exists).

---

## 6. DB-vs-App Constraint Summary

| Rule | Layer | Mechanism |
|---|---|---|
| Role is one of 2 values | **DB** | `Role` enum |
| Registration status is one of 5 values | **DB** | `RegistrationStatus` enum |
| Email uniqueness | **DB** | unique index on `User.email` |
| Staff assigned to a session at most once | **DB** | composite unique index |
| Session capacity > 0 | **DB** | raw SQL `CHECK` constraint (manual migration) |
| At most one ACTIVE alert per session | **DB** | partial unique index (manual migration) |
| No duplicate *active* registration per email+session | **DB** (backstop) + **APP** (primary check) | partial unique index + in-transaction check |
| Audit trail is append-only | **DB** (via `REVOKE UPDATE, DELETE`) + **APP** (no code path updates/deletes) | GRANT/REVOKE in manual migration |
| `count(Reserved+Confirmed+CheckedIn) <= capacity` | **APP**, made race-safe by **DB** locking | `SELECT ... FOR UPDATE` / `SERIALIZABLE` tx |
| Legal status transitions (state machine) | **APP** | `assertLegalTransition()` |
| RBAC scoping to assigned sessions | **APP** | `assertStaffCanActOnSession()` |
| Reservation expiry after X minutes | **APP** | lazy check + cron job |
| Alert re-trigger after refill | **APP**, deduped by **DB** | `evaluateCapacityAlert()` + partial unique index |
