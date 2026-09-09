import GlassCard from "@/components/GlassCard";
import Sensitive from "@/components/Sensitive";
import { fmtMad } from "@/lib/format";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
  tone = "teal",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  highlight?: boolean;
  tone?: "teal" | "rose" | "emerald" | "amber";
}) {
  const ring = {
    teal: "border-teal-400/30 bg-gradient-to-br from-teal-500/10 to-transparent",
    rose: "border-rose-400/30 bg-gradient-to-br from-rose-500/10 to-transparent",
    emerald: "border-emerald-400/30 bg-gradient-to-br from-emerald-500/10 to-transparent",
    amber: "border-amber-400/30 bg-gradient-to-br from-amber-500/10 to-transparent",
  }[tone];
  return (
    <div
      className={clsx(
        "rounded-2xl border p-4",
        highlight ? ring : "border-white/5 bg-white/[0.02]",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-neutral-400">
        {Icon && <Icon size={14} />} {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

export function MonthlyKpis({
  nightsBooked,
  totalNights,
  occupancy,
  gross,
  costs,
  net,
}: {
  nightsBooked: number;
  totalNights: number;
  occupancy: number;
  gross: number;
  costs: number;
  net: number;
}) {
  return (
    <GlassCard>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Nights"
          value={`${nightsBooked} / ${totalNights}`}
          sub="booked this month"
        />
        <KpiCard
          label="Occupancy"
          value={`${occupancy.toFixed(1)}%`}
          tone="teal"
          highlight
        />
        <KpiCard
          label="Gross"
          value={<Sensitive>{fmtMad(gross)}</Sensitive>}
          tone="emerald"
        />
        <KpiCard
          label="Costs"
          value={<Sensitive>{fmtMad(costs)}</Sensitive>}
          tone="rose"
        />
        <KpiCard
          label="Net"
          value={<Sensitive>{fmtMad(net)}</Sensitive>}
          tone={net >= 0 ? "emerald" : "rose"}
          highlight
        />
      </div>
    </GlassCard>
  );
}
