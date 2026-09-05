// components/dashboard/StatusBreakdownPanel.tsx

import type { StatusBreakdownRow } from "@/src/services/dashboardService";
import { StatusBadge } from "@/components/registrations/StatusBadge";

export function StatusBreakdownPanel({ rows }: { rows: StatusBreakdownRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="rounded border border-border bg-surface p-5">
      <p className="text-sm font-medium text-ink">Registrations by status</p>
      <ul className="mt-4 space-y-3">
        {rows.map((row) => {
          const pct = total === 0 ? 0 : Math.round((row.count / total) * 100);
          return (
            <li key={row.status}>
              <div className="flex items-center justify-between">
                <StatusBadge status={row.status} />
                <span className="font-mono text-sm tabular-nums text-ink">{row.count}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-current text-ink-faint" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
