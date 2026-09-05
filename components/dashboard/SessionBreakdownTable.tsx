// components/dashboard/SessionBreakdownTable.tsx

import clsx from "clsx";
import type { SessionBreakdownRow } from "@/src/services/dashboardService";

export function SessionBreakdownTable({ rows }: { rows: SessionBreakdownRow[] }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <p className="text-sm font-medium text-ink">Sessions by occupancy</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-ink-muted">
              <th className="px-5 py-2.5 font-medium">Session</th>
              <th className="px-3 py-2.5 font-medium">Event</th>
              <th className="px-3 py-2.5 font-medium">Occupied</th>
              <th className="px-3 py-2.5 font-medium">Checked in</th>
              <th className="px-5 py-2.5 font-medium">Capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const atCapacity = row.occupied >= row.capacity;
              return (
                <tr key={row.sessionId}>
                  <td className="px-5 py-3 font-medium text-ink">{row.sessionTitle}</td>
                  <td className="px-3 py-3 text-ink-muted">{row.eventName}</td>
                  <td
                    className={clsx(
                      "px-3 py-3 font-mono tabular-nums",
                      atCapacity ? "text-warning" : "text-ink"
                    )}
                  >
                    {row.occupied}/{row.capacity}
                  </td>
                  <td className="px-3 py-3 font-mono tabular-nums text-ink">{row.checkedIn}</td>
                  <td className="px-5 py-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-bg">
                      <div
                        className={clsx("h-full rounded-full", atCapacity ? "bg-warning" : "bg-accent")}
                        style={{ width: `${Math.min(100, (row.occupied / row.capacity) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-muted">
                  No sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
