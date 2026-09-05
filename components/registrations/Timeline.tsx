// components/registrations/Timeline.tsx

import { Fragment } from "react";
import { ArrowRight, User, Cog } from "lucide-react";
import type { RegistrationDetail } from "@/src/services/registrationService";
import { StatusBadge } from "@/components/registrations/StatusBadge";

function formatTimestamp(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));
}

/**
 * Read-only by construction: this component only ever receives data already
 * loaded from RegistrationTimeline (append-only at the DB level — see
 * prisma/migrations_manual/001_extra_constraints.sql) and renders it. There
 * is no edit/delete affordance here on purpose.
 */
export function Timeline({ entries }: { entries: RegistrationDetail["timeline"] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">No history yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              {entry.oldStatus ? (
                <Fragment>
                  <StatusBadge status={entry.oldStatus} />
                  <ArrowRight className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                </Fragment>
              ) : (
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Created
                </span>
              )}
              <StatusBadge status={entry.newStatus} />
            </div>
            <time className="font-mono text-xs text-ink-muted">{formatTimestamp(entry.timestamp)}</time>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
            {entry.actorName ? (
              <>
                <User className="h-3 w-3" aria-hidden />
                <span>{entry.actorName}</span>
              </>
            ) : (
              <>
                <Cog className="h-3 w-3" aria-hidden />
                <span>System</span>
              </>
            )}
          </div>

          {entry.note && <p className="mt-2 text-sm text-ink">{entry.note}</p>}
        </li>
      ))}
    </ol>
  );
}
