// components/dashboard/TopBar.tsx
"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import clsx from "clsx";
import type { ActiveAlertSummary } from "@/src/services/registrationService";
import { dismissAlertAction } from "@/app/(dashboard)/registrations/actions";
import { Button } from "@/components/ui/Button";

function titleForPath(pathname: string | null): string {
  if (!pathname) return "";
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/registrations") return "Registrations";
  if (/^\/registrations\/[^/]+$/.test(pathname)) return "Registration detail";
  if (/^\/sessions\/[^/]+\/import$/.test(pathname)) return "Import attendees";
  return "";
}

export function TopBar({ alerts }: { alerts: ActiveAlertSummary[] }) {
  const pathname = usePathname();
  const pageTitle = titleForPath(pathname);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <h1 className="text-lg font-semibold text-ink">{pageTitle}</h1>

      <div className="relative" ref={panelRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${alerts.length} active capacity alert${alerts.length === 1 ? "" : "s"}`}
          className={clsx(
            "relative flex h-9 w-9 items-center justify-center rounded transition-colors",
            open ? "bg-warning-tint" : "hover:bg-bg"
          )}
        >
          <Bell className={clsx("h-5 w-5", alerts.length > 0 ? "text-warning" : "text-ink-muted")} />
          {alerts.length > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white">
              {alerts.length}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-border bg-surface shadow-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink">Capacity alerts</p>
              <p className="text-xs text-ink-muted">
                {alerts.length === 0 ? "All clear" : `${alerts.length} at capacity`}
              </p>
            </div>

            {alerts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">
                No sessions are currently at capacity.
              </p>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {alerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function AlertRow({ alert }: { alert: ActiveAlertSummary }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  function handleDismiss() {
    setError(null);
    startTransition(async () => {
      const result = await dismissAlertAction(alert.id);
      if (result.ok) {
        setDismissed(true);
      } else {
        setError(result.message);
      }
    });
  }

  if (dismissed) return null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{alert.sessionTitle}</p>
          <p className="truncate text-xs text-ink-muted">{alert.eventName}</p>
          <p className="mt-1 font-mono text-xs text-warning">
            {alert.currentCount}/{alert.capacity} seats filled
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
          aria-label="Dismiss alert"
        >
          <X className="h-3.5 w-3.5" />
          {isPending ? "Dismissing…" : "Dismiss"}
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </li>
  );
}
