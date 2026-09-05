// app/(dashboard)/registrations/page.tsx

import { requireUser } from "@/src/lib/auth";
import { getAssignedSessionIdsOrNull } from "@/src/lib/permissions";
import { searchRegistrations, type RegistrationSortBy, type SortDirection } from "@/src/services/searchService";
import { prisma } from "@/src/lib/prisma";
import { RegistrationFilters } from "@/components/registrations/RegistrationFilters";
import { RegistrationsTable } from "@/components/registrations/RegistrationsTable";
import { Pagination } from "@/components/ui/Pagination";
import type { RegistrationStatus } from "@prisma/client";

export const dynamic = "force-dynamic"; // always reflect the latest reservation/check-in state

type SearchParams = {
  page?: string;
  q?: string;
  eventId?: string;
  sessionId?: string;
  status?: string;
  sortBy?: string;
  sortDir?: string;
};

export default async function RegistrationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();

  const params = {
    page: searchParams.page ? Number(searchParams.page) : 1,
    searchQuery: searchParams.q,
    eventId: searchParams.eventId || undefined,
    sessionId: searchParams.sessionId || undefined,
    status: (searchParams.status || undefined) as RegistrationStatus | undefined,
    sortBy: (searchParams.sortBy || undefined) as RegistrationSortBy | undefined,
    sortDir: (searchParams.sortDir || undefined) as SortDirection | undefined,
  };

  const [result, events, assignedSessionIds] = await Promise.all([
    searchRegistrations(params, user),
    prisma.event.findMany({ select: { id: true, name: true }, orderBy: { startDate: "asc" } }),
    getAssignedSessionIdsOrNull(user),
  ]);

  // Staff only ever see filter options for sessions they're assigned to —
  // mirrors the scoping searchRegistrations itself enforces, so the
  // dropdown never offers a session that would then 403.
  const sessions = await prisma.session.findMany({
    where: assignedSessionIds !== null ? { id: { in: assignedSessionIds } } : {},
    select: { id: true, title: true, eventId: true },
    orderBy: { startTime: "asc" },
  });

  return (
    <div className="rounded border border-border bg-surface">
      <RegistrationFilters events={events} sessions={sessions} />
      <RegistrationsTable rows={result.data} />
      <Pagination page={result.page} totalPages={result.totalPages} totalCount={result.totalCount} />
    </div>
  );
}
