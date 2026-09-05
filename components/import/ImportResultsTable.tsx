// components/import/ImportResultsTable.tsx

import clsx from "clsx";
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import type { BulkImportReport, BulkImportRowStatus } from "@/src/services/bulkService";

const ROW_STYLE: Record<BulkImportRowStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  CREATED: { icon: CheckCircle2, className: "text-success", label: "Created" },
  DUPLICATE: { icon: MinusCircle, className: "text-ink-muted", label: "Duplicate" },
  INVALID: { icon: XCircle, className: "text-danger", label: "Invalid" },
  CAPACITY_REACHED: { icon: AlertTriangle, className: "text-warning", label: "Capacity reached" },
};

export function ImportResultsTable({ report }: { report: BulkImportReport }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="grid grid-cols-2 gap-3 border-b border-border p-5 sm:grid-cols-4">
        <SummaryStat label="Created" value={report.created} className="text-success" />
        <SummaryStat label="Duplicate" value={report.duplicate} className="text-ink-muted" />
        <SummaryStat label="Invalid" value={report.invalid} className="text-danger" />
        <SummaryStat label="Capacity reached" value={report.capacityReached} className="text-warning" />
      </div>

      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-xs text-ink-muted">
              <th className="px-5 py-2.5 font-medium">Row</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Result</th>
              <th className="px-5 py-2.5 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.rows.map((row) => {
              const style = ROW_STYLE[row.status];
              const Icon = style.icon;
              return (
                <tr key={row.rowNumber}>
                  <td className="px-5 py-2.5 font-mono text-xs tabular-nums text-ink-muted">
                    {row.rowNumber}
                  </td>
                  <td className="px-3 py-2.5 text-ink">{row.email || "—"}</td>
                  <td className={clsx("px-3 py-2.5", style.className)}>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Icon className="h-3.5 w-3.5" />
                      {style.label}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-ink-muted">{row.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className: string;
}) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={clsx("mt-0.5 font-mono text-2xl tabular-nums", className)}>{value}</p>
    </div>
  );
}
