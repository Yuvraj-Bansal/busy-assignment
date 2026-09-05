// components/registrations/StatusBadge.tsx
//
// One dedicated hue per status (not just "green good / red bad") so a
// table full of badges scans instantly — Reserved (violet, "in progress")
// reads differently at a glance than Cancelled (red, "stopped") or Expired
// (neutral, "lapsed"), which a two-tone system would blur together.

import type { RegistrationStatus } from "@prisma/client";
import clsx from "clsx";

const STYLES: Record<RegistrationStatus, { label: string; className: string }> = {
  RESERVED: { label: "Reserved", className: "bg-reserved-tint text-reserved" },
  CONFIRMED: { label: "Confirmed", className: "bg-accent-tint text-accent-dark" },
  CHECKED_IN: { label: "Checked in", className: "bg-success-tint text-success" },
  CANCELLED: { label: "Cancelled", className: "bg-danger-tint text-danger" },
  EXPIRED: { label: "Expired", className: "bg-bg text-ink-muted border border-border" },
};

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  const style = STYLES[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-sm font-medium",
        style.className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {style.label}
    </span>
  );
}
