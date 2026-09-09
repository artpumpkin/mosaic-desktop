"use client";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildChartSeries, type WeightPoint } from "@/lib/health/stats";
import { kgToLb } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";

export function WeightChart({
  entries,
  unitsPref,
  rangeDays = null,
  heightClass = "h-72",
}: {
  entries: WeightPoint[];
  unitsPref: UnitsPreference;
  rangeDays?: number | null;
  heightClass?: string;
}) {
  const data = useMemo(() => {
    const series = buildChartSeries(entries, rangeDays);
    if (unitsPref === "metric") return series;
    // Convert kg → lb for display only; the series itself was computed in kg.
    return series.map((p) => ({
      ...p,
      weight: p.weight == null ? null : kgToLb(p.weight),
      ma5: p.ma5 == null ? null : kgToLb(p.ma5),
      ma10: p.ma10 == null ? null : kgToLb(p.ma10),
    }));
  }, [entries, rangeDays, unitsPref]);

  if (data.length === 0) {
    return (
      <div className={`${heightClass} grid place-items-center text-sm text-neutral-500`}>
        No data yet — log a weight to see the chart.
      </div>
    );
  }

  const allVals = data.flatMap((p) => [p.weight, p.ma5, p.ma10]).filter(
    (v): v is number => typeof v === "number",
  );
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const pad = Math.max(0.5, (max - min) * 0.08);

  return (
    <div className={heightClass}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis
            dataKey="date"
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
            tickFormatter={(d) => d.slice(5)}
            minTickGap={20}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
            tickFormatter={(v) => v.toFixed(1)}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(10,10,15,0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => {
              if (value == null) return "—";
              const n = Number(value);
              if (!Number.isFinite(n)) return "—";
              return `${n.toFixed(1)} ${unitsPref === "imperial" ? "lb" : "kg"}`;
            }}
          />
          <Line
            type="monotone"
            dataKey="weight"
            stroke="#10b981"
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: "#10b981" }}
            connectNulls={false}
            name="Daily"
          />
          <Line
            type="monotone"
            dataKey="ma5"
            stroke="#a855f7"
            strokeWidth={2}
            dot={false}
            connectNulls
            name="5-day avg"
          />
          <Line
            type="monotone"
            dataKey="ma10"
            stroke="#06b6d4"
            strokeWidth={2}
            dot={false}
            connectNulls
            name="10-day avg"
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-400 justify-center">
        <Legend color="#10b981" label="Daily" />
        <Legend color="#a855f7" label="5-day avg" />
        <Legend color="#06b6d4" label="10-day avg" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block w-3 h-[2px] rounded"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
