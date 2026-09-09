"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtAmount, madToBase, type FxTable } from "@/lib/format";
import Sensitive from "@/components/Sensitive";

function CustomTooltip({
  active,
  payload,
  label,
  base,
  fx,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string; payload?: { total?: number } }>;
  label?: string;
  base: string;
  fx: FxTable;
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.payload?.total ?? payload[0]?.value ?? 0;
  const mad = Number(raw);
  const v = madToBase(mad, base, fx);
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs">
      <div className="text-neutral-400">{label}</div>
      <div className="font-semibold tabular-nums">
        <Sensitive>{fmtAmount(v, base, 0)}</Sensitive>
      </div>
    </div>
  );
}

export default function NetWorthChart({
  data,
  base,
  fx,
}: {
  data: { date: string; total: number }[];
  base: string;
  fx: FxTable;
}) {
  const yTickFormatter = (v: number) => {
    const converted = madToBase(v, base, fx);
    return converted >= 1000
      ? `${(converted / 1000).toFixed(0)}k`
      : converted.toFixed(0);
  };
  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="nwStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#c4b5fd" />
              <stop offset="50%" stopColor="#f0abfc" />
              <stop offset="100%" stopColor="#67e8f9" />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.06)"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            fontSize={11}
            stroke="rgba(255,255,255,0.3)"
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => v?.slice(0, 10) ?? ""}
            minTickGap={40}
          />
          <YAxis
            fontSize={11}
            stroke="rgba(255,255,255,0.3)"
            tickLine={false}
            axisLine={false}
            tickFormatter={yTickFormatter}
          />
          <Tooltip
            content={<CustomTooltip base={base} fx={fx} />}
            cursor={{ stroke: "rgba(255,255,255,0.1)" }}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="url(#nwStroke)"
            strokeWidth={2.5}
            fill="url(#nwFill)"
            dot={false}
            activeDot={{
              r: 4,
              fill: "#f0abfc",
              stroke: "rgba(255,255,255,0.4)",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
