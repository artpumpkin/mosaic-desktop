"use client";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CostBreakdown } from "@/lib/rentals/math";
import { fmtMad } from "@/lib/format";
import Sensitive from "@/components/Sensitive";

const COLORS: Record<string, string> = {
  Cleaner: "#22d3ee",
  Fuel: "#f59e0b",
  Sweets: "#f472b6",
  Other: "#a78bfa",
};

export function CostBreakdownChart({ costs }: { costs: CostBreakdown }) {
  const data = [
    { name: "Cleaner", value: costs.cleaner },
    { name: "Fuel", value: costs.fuel },
    { name: "Sweets", value: costs.sweets },
    { name: "Other", value: costs.other },
  ];
  if (costs.total === 0) {
    return (
      <div className="h-56 sm:h-64 lg:h-72 grid place-items-center text-sm text-neutral-500">
        No costs logged this month yet.
      </div>
    );
  }
  return (
    <div className="h-56 sm:h-64 lg:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#737373", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#737373", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{
              background: "rgba(20,20,20,0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v) => (
              <Sensitive>{fmtMad(typeof v === "number" ? v : Number(v) || 0)}</Sensitive>
            )}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={COLORS[d.name]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
