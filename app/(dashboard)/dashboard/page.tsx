// app/(dashboard)/dashboard/page.tsx

import { requireUser } from "@/src/lib/auth";
import { assertOrganizer } from "@/src/lib/permissions";
import {
  getDashboardMetrics,
  getStatusBreakdown,
  getSessionBreakdown,
  getCheckInActivity,
} from "@/src/services/dashboardService";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { StatusBreakdownPanel } from "@/components/dashboard/StatusBreakdownPanel";
import { SessionBreakdownTable } from "@/components/dashboard/SessionBreakdownTable";
import { CheckInActivityChart } from "@/components/dashboard/CheckInActivityChart";

export const dynamic = "force-dynamic"; // dashboard metrics must always be fresh, never statically cached

export default async function DashboardPage() {
  // Dashboard/analytics is Organizer-only in this build (see
  // docs/BUSINESS_LOGIC.md §1) — Check-in Staff are redirected via the
  // thrown ForbiddenError, caught by the nearest error boundary.
  const user = await requireUser();
  assertOrganizer(user);

  const [metrics, statusBreakdown, sessionBreakdown, checkInActivity] = await Promise.all([
    getDashboardMetrics(),
    getStatusBreakdown(),
    getSessionBreakdown(),
    getCheckInActivity(14),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Sessions today" value={metrics.sessionsToday} />
        <MetricCard
          label="Checked in today"
          value={metrics.checkedInToday}
          tone="success"
        />
        <MetricCard
          label="Expired this week"
          value={metrics.expiredThisWeek}
          detail="Reservations left unconfirmed past the window"
        />
        <MetricCard
          label="Sessions at capacity"
          value={metrics.sessionsAtCapacity}
          tone={metrics.sessionsAtCapacity > 0 ? "warning" : "neutral"}
        />
      </div>

      <CheckInActivityChart data={checkInActivity} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <StatusBreakdownPanel rows={statusBreakdown} />
        </div>
        <div className="lg:col-span-2">
          <SessionBreakdownTable rows={sessionBreakdown} />
        </div>
      </div>
    </div>
  );
}
