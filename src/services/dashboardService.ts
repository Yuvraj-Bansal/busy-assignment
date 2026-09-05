// src/services/dashboardService.ts
//
// Read-only aggregate queries for the Organizer dashboard. Org-wide by
// design (see docs/BUSINESS_LOGIC.md §1 — dashboard/analytics is an
// Organizer-only capability in this build; a Staff-scoped "my sessions"
// variant is a reasonable v2 but out of scope here). Because of that, this
// service does NOT call assertOrganizer itself — the page/route calling it
// is responsible for that, the same way registrationService's functions
// take an already-authorized actor rather than re-deriving auth. Keeping
// auth at the edges keeps these functions trivially unit-testable.

import { prisma } from "../lib/prisma";
import type { RegistrationStatus } from "@prisma/client";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function daysAgo(n: number): Date {
  const x = new Date();
  x.setDate(x.getDate() - n);
  return x;
}

// ----------------------------------------------------------------------
// Headline metric cards
// ----------------------------------------------------------------------

export type DashboardMetrics = {
  sessionsToday: number;
  checkedInToday: number;
  expiredThisWeek: number;
  sessionsAtCapacity: number;
};

export async function getDashboardMetrics(now: Date = new Date()): Promise<DashboardMetrics> {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const weekAgo = daysAgo(7);

  const [sessionsToday, checkedInToday, expiredThisWeek, sessionsAtCapacity] = await Promise.all([
    prisma.session.count({
      where: { startTime: { gte: todayStart, lte: todayEnd } },
    }),
    prisma.registration.count({
      where: { status: "CHECKED_IN", checkedInAt: { gte: todayStart, lte: todayEnd } },
    }),
    // No dedicated `expiredAt` column on Registration (status timestamps only
    // cover confirm/check-in/cancel) — the timeline is the source of truth
    // for *when* a transition happened, so we count EXPIRED transitions
    // there rather than approximating off `updatedAt`.
    prisma.registrationTimeline.count({
      where: { newStatus: "EXPIRED", timestamp: { gte: weekAgo } },
    }),
    // An ACTIVE CapacityAlert exists exactly when a session is at/over
    // capacity (see registrationService.evaluateCapacityAlert), and the
    // partial unique index guarantees at most one ACTIVE row per session —
    // so this count is already a distinct-session count, no groupBy needed.
    prisma.capacityAlert.count({ where: { status: "ACTIVE" } }),
  ]);

  return { sessionsToday, checkedInToday, expiredThisWeek, sessionsAtCapacity };
}

// ----------------------------------------------------------------------
// Breakdown by status (org-wide, all sessions)
// ----------------------------------------------------------------------

export type StatusBreakdownRow = { status: RegistrationStatus; count: number };

export async function getStatusBreakdown(): Promise<StatusBreakdownRow[]> {
  const grouped = await prisma.registration.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  // groupBy only returns rows for statuses that actually occur — fill in
  // zeroes for the rest so the UI always renders all five without special-casing.
  const ALL: RegistrationStatus[] = ["RESERVED", "CONFIRMED", "CHECKED_IN", "CANCELLED", "EXPIRED"];
  const byStatus = new Map(grouped.map((g: any) => [g.status as RegistrationStatus, g._count._all as number]));
  return ALL.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));
}

// ----------------------------------------------------------------------
// Breakdown by session
// ----------------------------------------------------------------------

export type SessionBreakdownRow = {
  sessionId: string;
  sessionTitle: string;
  eventName: string;
  capacity: number;
  reserved: number;
  confirmed: number;
  checkedIn: number;
  cancelled: number;
  expired: number;
  occupied: number; // reserved + confirmed + checkedIn — what counts against capacity
};

export async function getSessionBreakdown(): Promise<SessionBreakdownRow[]> {
  const sessions = await prisma.session.findMany({
    select: {
      id: true,
      title: true,
      capacity: true,
      event: { select: { name: true } },
      registrations: { select: { status: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return sessions.map((s: any) => {
    const counts: Record<RegistrationStatus, number> = {
      RESERVED: 0,
      CONFIRMED: 0,
      CHECKED_IN: 0,
      CANCELLED: 0,
      EXPIRED: 0,
    };
    for (const r of s.registrations as { status: RegistrationStatus }[]) {
      counts[r.status] += 1;
    }
    return {
      sessionId: s.id,
      sessionTitle: s.title,
      eventName: s.event.name,
      capacity: s.capacity,
      reserved: counts.RESERVED,
      confirmed: counts.CONFIRMED,
      checkedIn: counts.CHECKED_IN,
      cancelled: counts.CANCELLED,
      expired: counts.EXPIRED,
      occupied: counts.RESERVED + counts.CONFIRMED + counts.CHECKED_IN,
    };
  });
}

// ----------------------------------------------------------------------
// 14-day check-in activity (for the Recharts chart)
// ----------------------------------------------------------------------

export type CheckInActivityPoint = { date: string; checkIns: number }; // date = "YYYY-MM-DD"

export async function getCheckInActivity(days = 14): Promise<CheckInActivityPoint[]> {
  const start = startOfDay(daysAgo(days - 1));

  const rows = await prisma.registration.findMany({
    where: { status: "CHECKED_IN", checkedInAt: { gte: start } },
    select: { checkedInAt: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = daysAgo(days - 1 - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows as { checkedInAt: Date | null }[]) {
    if (!r.checkedInAt) continue;
    const key = r.checkedInAt.toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, checkIns]) => ({ date, checkIns }));
}
