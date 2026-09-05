// components/dashboard/CheckInActivityChart.tsx
"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CheckInActivityPoint } from "@/src/services/dashboardService";

function formatDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CheckInActivityChart({ data }: { data: CheckInActivityPoint[] }) {
  const chartData = data.map((d) => ({ ...d, label: formatDay(d.date) }));

  return (
    <div className="h-72 rounded border border-border bg-surface p-5">
      <p className="text-sm font-medium text-ink">Check-in activity, last 14 days</p>
      <ResponsiveContainer width="100%" height="88%">
        <BarChart data={chartData} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E4EA" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#5B6270" }}
            axisLine={{ stroke: "#E2E4EA" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#5B6270" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            cursor={{ fill: "#F5F6F8" }}
            contentStyle={{
              borderRadius: 6,
              border: "1px solid #E2E4EA",
              fontSize: 12,
              fontFamily: "var(--font-plex-sans)",
            }}
            labelFormatter={(label) => label}
            formatter={(value: number) => [`${value}`, "Checked in"]}
          />
          <Bar dataKey="checkIns" fill="#2F5D9F" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
