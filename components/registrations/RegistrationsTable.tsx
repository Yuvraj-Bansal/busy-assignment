// components/registrations/RegistrationsTable.tsx

import Link from "next/link";
import type { RegistrationWithSession } from "@/src/services/searchService";
import { StatusBadge } from "@/components/registrations/StatusBadge";
import { QuickActionButtons } from "@/components/registrations/QuickActionButtons";

function formatDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function RegistrationsTable({ rows }: { rows: RegistrationWithSession[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <p className="text-sm font-medium text-ink">No registrations match these filters</p>
        <p className="mt-1 text-sm text-ink-muted">Try clearing a filter or broadening your search.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-ink-muted">
            <th className="px-5 py-2.5 font-medium">Attendee</th>
            <th className="px-3 py-2.5 font-medium">Session</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Reserved</th>
            <th className="px-5 py-2.5 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-bg/60">
              <td className="px-5 py-3">
                <Link href={`/registrations/${r.id}`} className="font-medium text-ink hover:text-accent">
                  {r.attendeeName}
                </Link>
                <p className="text-xs text-ink-muted">{r.attendeeEmail}</p>
              </td>
              <td className="px-3 py-3 text-ink-muted">{r.session.title}</td>
              <td className="px-3 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-3 font-mono text-xs tabular-nums text-ink-muted">
                {formatDateTime(new Date(r.reservedAt))}
              </td>
              <td className="px-5 py-3">
                <QuickActionButtons registrationId={r.id} status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
