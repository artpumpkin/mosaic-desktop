"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtAmount, madToBase, type FxTable } from "@/lib/format";
import Sensitive from "@/components/Sensitive";

const COLORS = [
  ["#a78bfa", "#7c3aed"], // violet
  ["#f0abfc", "#c026d3"], // fuchsia
  ["#67e8f9", "#0891b2"], // cyan
  ["#fcd34d", "#d97706"], // amber
  ["#6ee7b7", "#059669"], // emerald
  ["#f9a8d4", "#db2777"], // pink
  ["#93c5fd", "#2563eb"], // blue
];

function CustomTooltip({
  active,
  payload,
  base,
  fx,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string }>;
  base: string;
  fx: FxTable;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const mad = Number(p.value ?? 0);
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs">
      <div className="text-neutral-400">{p.name}</div>
      <div className="font-semibold tabular-nums">
        <Sensitive>{fmtAmount(madToBase(mad, base, fx), base, 0)}</Sensitive>
      </div>
    </div>
  );
}

export default function BreakdownPie({
  data,
  total,
  base,
  fx,
}: {
  data: { name: string; value: number }[];
  total: number;
  base: string;
  fx: FxTable;
}) {
  const fmtBase = (mad: number) => fmtAmount(madToBase(mad, base, fx), base, 0);
  return (
    <div className="w-full">
      <div className="relative w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            {COLORS.map(([light, dark], i) => (
              <linearGradient
                key={i}
                id={`slice-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0%" stopColor={light} stopOpacity={0.95} />
                <stop offset="100%" stopColor={dark} stopOpacity={0.95} />
              </linearGradient>
            ))}
          </defs>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={2}
            stroke="rgba(0,0,0,0.3)"
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#slice-${i % COLORS.length})`} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip base={base} fx={fx} />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Total
          </div>
          <div className="text-lg font-semibold tabular-nums">
            <Sensitive>{fmtBase(total)}</Sensitive>
          </div>
        </div>
      </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-y-1.5 text-xs">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 min-w-0">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background: `linear-gradient(135deg, ${COLORS[i % COLORS.length][0]}, ${COLORS[i % COLORS.length][1]})`,
              }}
            />
            <span className="text-neutral-400 truncate flex-1">{d.name}</span>
            <span className="tabular-nums text-neutral-300">
              <Sensitive>{fmtBase(d.value)}</Sensitive>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
