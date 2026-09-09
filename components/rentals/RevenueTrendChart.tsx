"use client";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/rentals/math";
import { fmtMad } from "@/lib/format";
import Sensitive from "@/components/Sensitive";

export function RevenueTrendChart({ data }: { data: TrendPoint[] }) {
  const empty = data.every((p) => p.gross === 0 && p.net === 0);
  if (empty) {
    return (
      <div className="h-56 sm:h-64 lg:h-72 grid place-items-center text-sm text-neutral-500">
        No revenue yet — log a few bookings to see the trend.
      </div>
    );
  }
  return (
    <div className="h-56 sm:h-64 lg:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="rentalsGross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(45,212,191,0.55)" />
              <stop offset="100%" stopColor="rgba(45,212,191,0)" />
            </linearGradient>
            <linearGradient id="rentalsNet" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16,185,129,0.45)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0)" />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: "#737373", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#737373", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(v) => (typeof v === "number" ? Math.round(v).toString() : v)}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.08)" }}
            contentStyle={{
              background: "rgba(20,20,20,0.92)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "#a3a3a3" }}
            formatter={(v) => (
              <Sensitive>{fmtMad(typeof v === "number" ? v : Number(v) || 0)}</Sensitive>
            )}
          />
          <Area
            type="monotone"
            dataKey="gross"
            name="Gross"
            stroke="#2dd4bf"
            strokeWidth={2}
            fill="url(#rentalsGross)"
          />
          <Area
            type="monotone"
            dataKey="net"
            name="Net"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#rentalsNet)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
