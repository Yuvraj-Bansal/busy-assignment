// components/dashboard/MetricCard.tsx

import clsx from "clsx";

type Tone = "neutral" | "warning" | "success";

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-l-accent",
  warning: "border-l-warning",
  success: "border-l-success",
};

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div
      className={clsx(
        "rounded border border-border border-l-4 bg-surface px-5 py-4",
        TONE_BORDER[tone]
      )}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1.5 font-mono text-3xl font-medium tabular-nums text-ink">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}
