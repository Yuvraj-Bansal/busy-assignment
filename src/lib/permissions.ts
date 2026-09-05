// src/lib/permissions.ts
//
// Thin, composable authorization guards. These are plain functions (not
// framework middleware) so they can be called from Server Actions, Route
// Handlers, and directly inside service functions — anywhere a mutation or
// a scoped read happens. Every guard either resolves silently or throws
// (ForbiddenError / UnauthorizedError), so callers can just `await
// assertX(...)` without an if/else.

import { prisma } from "./prisma";
import { ForbiddenError } from "./errors";
import type { SessionUser } from "./auth";

/**
 * Throws unless the user is an Organizer. Organizers have full access to
 * everything (events, sessions, capacities, assignments, all registrations).
 */
export function assertOrganizer(user: SessionUser): void {
  if (user.role !== "ORGANIZER") {
    throw new ForbiddenError(
      "Only Organizers can perform this action."
    );
  }
}

/**
 * Throws unless the user may act on the given session:
 *  - Organizers: always allowed (full access by role).
 *  - Check-in Staff: allowed only if a SessionAssignment row exists linking
 *    them to this exact session — i.e. read/check-in/cancel/reserve are
 *    scoped to sessions they've been explicitly assigned to. Staff can
 *    never edit the session/event/capacity itself; that's gated separately
 *    by `assertOrganizer` wherever session/event mutation happens.
 *
 * [APP] This is authorization logic and cannot live in the schema — the
 * schema only records *that* an assignment exists (via the composite
 * unique index on SessionAssignment); deciding what that assignment
 * *permits* is this function's job.
 */
export async function assertSessionAccess(
  user: SessionUser,
  sessionId: string
): Promise<void> {
  if (user.role === "ORGANIZER") return;

  const assignment = await prisma.sessionAssignment.findUnique({
    where: { sessionId_userId: { sessionId, userId: user.id } },
    select: { id: true },
  });

  if (!assignment) {
    throw new ForbiddenError(
      "You are not assigned to this session, so you cannot view or act on its registrations."
    );
  }
}

/**
 * Convenience variant of assertSessionAccess for code paths that already
 * loaded a Registration and want to authorize against its parent session
 * without a second query — pass `registration.sessionId` in directly. Kept
 * as a thin alias so call sites read clearly (`assertRegistrationAccess`
 * vs. having to know a Registration's parent is a Session under the hood).
 */
export async function assertRegistrationAccess(
  user: SessionUser,
  registrationSessionId: string
): Promise<void> {
  return assertSessionAccess(user, registrationSessionId);
}

/**
 * Returns the list of session IDs a Check-in Staff member is assigned to.
 * Organizers get `null` back, meaning "no scoping — full access", so
 * callers (notably searchService) can distinguish "scope to this array"
 * from "don't scope at all" without a magic empty-array sentinel.
 */
export async function getAssignedSessionIdsOrNull(
  user: SessionUser
): Promise<string[] | null> {
  if (user.role === "ORGANIZER") return null;

  const assignments = await prisma.sessionAssignment.findMany({
    where: { userId: user.id },
    select: { sessionId: true },
  });
  return assignments.map((a) => a.sessionId);
}
