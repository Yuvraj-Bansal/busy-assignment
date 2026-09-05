// app/(dashboard)/registrations/[id]/page.tsx

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, Phone, Clock } from "lucide-react";
import { requireUser } from "@/src/lib/auth";
import { getRegistrationById } from "@/src/services/registrationService";
import { NotFoundError } from "@/src/lib/errors";
import { StatusBadge } from "@/components/registrations/StatusBadge";
import { QuickActionButtons } from "@/components/registrations/QuickActionButtons";
import { Timeline } from "@/components/registrations/Timeline";

export const dynamic = "force-dynamic";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(d)
  );
}

export default async function RegistrationDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  let registration;
  try {
    registration = await getRegistrationById(params.id, user);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/registrations"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to registrations
      </Link>

      <div className="rounded border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">{registration.attendeeName}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {registration.session.title} · {registration.session.eventName}
            </p>
          </div>
          <StatusBadge status={registration.status} />
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-5 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-ink-faint" />
            <dd>{registration.attendeeEmail}</dd>
          </div>
          {registration.attendeePhone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-ink-faint" />
              <dd>{registration.attendeePhone}</dd>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-ink-faint" />
            <dd>Reserved {formatDateTime(registration.reservedAt)}</dd>
          </div>
          {registration.expiresAt && registration.status === "RESERVED" && (
            <div className="flex items-center gap-2 text-warning">
              <Clock className="h-4 w-4" />
              <dd>Expires {formatDateTime(registration.expiresAt)}</dd>
            </div>
          )}
        </dl>

        <div className="mt-5 border-t border-border pt-5">
          <QuickActionButtons
            registrationId={registration.id}
            status={registration.status}
            size="md"
          />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-medium text-ink">History</h3>
        <Timeline entries={registration.timeline} />
      </div>
    </div>
  );
}
