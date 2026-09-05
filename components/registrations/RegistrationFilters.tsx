// components/registrations/RegistrationFilters.tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import clsx from "clsx";
import type { RegistrationStatus } from "@prisma/client";

const STATUS_OPTIONS: { value: RegistrationStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "RESERVED", label: "Reserved" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "CHECKED_IN", label: "Checked in" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "EXPIRED", label: "Expired" },
];

const SORT_OPTIONS = [
  { value: "reservedTime", label: "Reserved time" },
  { value: "status", label: "Status" },
  { value: "sessionTitle", label: "Session" },
] as const;

type EventOption = { id: string; name: string };
type SessionOption = { id: string; title: string; eventId: string };

export function RegistrationFilters({
  events,
  sessions,
}: {
  events: EventOption[];
  sessions: SessionOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const eventId = searchParams.get("eventId") ?? "";
  const sessionId = searchParams.get("sessionId") ?? "";
  const status = (searchParams.get("status") ?? "") as RegistrationStatus | "";
  const sortBy = searchParams.get("sortBy") ?? "reservedTime";
  const sortDir = searchParams.get("sortDir") ?? "desc";

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.set("page", "1"); // any filter change resets to page 1
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  // Debounce the free-text search so we don't push a route change per keystroke.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchInput !== (searchParams.get("q") ?? "")) {
        updateParams({ q: searchInput });
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const sessionsForEvent = eventId ? sessions.filter((s) => s.eventId === eventId) : sessions;

  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search name or email"
          className="w-full rounded border border-border-strong bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-faint"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={eventId}
          onChange={(e) => updateParams({ eventId: e.target.value, sessionId: "" })}
          className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">All events</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>

        <select
          value={sessionId}
          onChange={(e) => updateParams({ sessionId: e.target.value })}
          className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          <option value="">All sessions</option>
          {sessionsForEvent.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(e) => updateParams({ status: e.target.value })}
          className="rounded border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded border border-border-strong bg-surface pl-1">
          <select
            value={sortBy}
            onChange={(e) => updateParams({ sortBy: e.target.value })}
            className="bg-transparent py-1.5 pr-1 text-sm text-ink"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => updateParams({ sortDir: sortDir === "asc" ? "desc" : "asc" })}
            className="flex h-8 w-8 items-center justify-center rounded-r text-ink-muted hover:bg-bg hover:text-ink"
            aria-label={`Sort ${sortDir === "asc" ? "descending" : "ascending"}`}
          >
            {sortDir === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <span
          className={clsx(
            "flex items-center gap-1 text-xs text-ink-faint transition-opacity",
            isPending ? "opacity-100" : "opacity-0"
          )}
        >
          <ArrowUpDown className="h-3 w-3 animate-pulse" />
          Updating…
        </span>
      </div>
    </div>
  );
}
