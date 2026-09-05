// components/dashboard/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, CalendarRange } from "lucide-react";
import clsx from "clsx";
import type { SessionUser } from "@/src/lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/registrations", label: "Registrations", icon: ListChecks },
] as const;

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <CalendarRange className="h-5 w-5 text-accent" aria-hidden />
        <span className="text-[15px] font-semibold tracking-tight">Event Console</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent-tint text-accent-dark"
                  : "text-ink-muted hover:bg-bg hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <p className="truncate text-sm font-medium text-ink">{user.name}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {user.role === "ORGANIZER" ? "Organizer" : "Check-in staff"}
        </p>
      </div>
    </aside>
  );
}
