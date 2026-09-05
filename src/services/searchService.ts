// src/services/searchService.ts
//
// Server-side paginated search over Registrations, with RBAC scoping baked
// in at the query level (not filtered after the fact) — a Check-in Staff
// member's results are constrained by an `sessionId IN (...)` clause built
// from their SessionAssignment rows, so there's no code path where an
// unscoped query result could accidentally leak past a UI-layer filter.

import { Prisma, type Registration, type RegistrationStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getAssignedSessionIdsOrNull } from "../lib/permissions";
import { ForbiddenError } from "../lib/errors";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/config";
import type { SessionUser } from "../lib/auth";

export type RegistrationSortBy = "reservedTime" | "status" | "sessionTitle";
export type SortDirection = "asc" | "desc";

export type SearchRegistrationsParams = {
  page?: number;
  pageSize?: number;
  /** Matches against attendee name OR email, case-insensitive, substring match. */
  searchQuery?: string;
  eventId?: string;
  sessionId?: string;
  status?: RegistrationStatus;
  sortBy?: RegistrationSortBy;
  sortDir?: SortDirection;
};

export type RegistrationWithSession = Registration & {
  session: { id: string; title: string; eventId: string };
};

export type SearchRegistrationsResult = {
  data: RegistrationWithSession[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

function buildOrderBy(
  sortBy: RegistrationSortBy | undefined,
  sortDir: SortDirection | undefined
): Prisma.RegistrationOrderByWithRelationInput {
  const dir: SortDirection = sortDir ?? "desc";
  switch (sortBy) {
    case "status":
      return { status: dir };
    case "sessionTitle":
      return { session: { title: dir } };
    case "reservedTime":
    default:
      return { reservedAt: dir };
  }
}

/**
 * Paginated registration search. `requestingUser` drives RBAC scoping:
 *  - Organizer: unrestricted, sees every registration matching the filters.
 *  - Check-in Staff: results are always intersected with their assigned
 *    sessions. If they explicitly pass a `sessionId` they aren't assigned
 *    to, this throws `ForbiddenError` rather than silently returning an
 *    empty page — an empty page reads as "no results" (ambiguous with a
 *    legitimately empty session), whereas the explicit error makes the
 *    access-denial unambiguous to the caller/UI.
 */
export async function searchRegistrations(
  params: SearchRegistrationsParams,
  requestingUser: SessionUser
): Promise<SearchRegistrationsResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE))
  );

  const where: Prisma.RegistrationWhereInput = {};

  if (params.status) where.status = params.status;
  if (params.sessionId) where.sessionId = params.sessionId;
  if (params.eventId) where.session = { eventId: params.eventId };

  const q = params.searchQuery?.trim();
  if (q) {
    where.OR = [
      { attendeeName: { contains: q, mode: "insensitive" } },
      { attendeeEmail: { contains: q, mode: "insensitive" } },
    ];
  }

  // --- RBAC scoping -----------------------------------------------------
  const assignedSessionIds = await getAssignedSessionIdsOrNull(requestingUser);
  if (assignedSessionIds !== null) {
    // requestingUser is Check-in Staff (Organizers get `null` back = unscoped).
    if (params.sessionId) {
      if (!assignedSessionIds.includes(params.sessionId)) {
        throw new ForbiddenError(
          "You are not assigned to this session, so you cannot search its registrations."
        );
      }
      // where.sessionId already set above to the single allowed value.
    } else if (assignedSessionIds.length === 0) {
      // Assigned to nothing at all — short-circuit rather than issuing a
      // query that would (correctly, but wastefully) return zero rows.
      return { data: [], page, pageSize, totalCount: 0, totalPages: 0 };
    } else {
      where.sessionId = { in: assignedSessionIds };
    }
  }
  // -----------------------------------------------------------------------

  const orderBy = buildOrderBy(params.sortBy, params.sortDir);

  const [rawData, totalCount] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { session: { select: { id: true, title: true, eventId: true } } },
    }),
    prisma.registration.count({ where }),
  ]);
  // The real Prisma client infers the `include`d shape automatically; this
  // cast exists only because of this project's dependency-light stub types
  // (see node_modules/.prisma/client) — remove it once `prisma generate`
  // has been run for real against schema.prisma.
  const data = rawData as unknown as RegistrationWithSession[];

  return {
    data,
    page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
