import GlassCard from "@/components/GlassCard";
import { TrendingUp } from "lucide-react";
import { breakEvenNights } from "@/lib/rentals/math";
import { fmtMad } from "@/lib/format";

export function BreakEvenWidget({
  monthlyFixedCosts,
  nightlyRate,
  daysInMonth,
}: {
  monthlyFixedCosts: number;
  nightlyRate: number;
  daysInMonth: number;
}) {
  const nights = breakEvenNights(monthlyFixedCosts, nightlyRate);
  const occupancy = daysInMonth > 0 ? (nights / daysInMonth) * 100 : 0;
  return (
    <GlassCard>
      <h2 className="font-medium mb-3 flex items-center gap-2">
        <TrendingUp size={15} className="text-teal-300" /> Break-even
      </h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Avg monthly costs"
          value={fmtMad(monthlyFixedCosts)}
          sub="from last 3 months"
        />
        <Stat
          label="At your nightly rate"
          value={fmtMad(nightlyRate)}
          sub="per night"
        />
        <Stat
          label="Nights needed"
          value={`${nights}`}
          sub={`${occupancy.toFixed(0)}% occupancy`}
          highlight
        />
      </div>
      <p className="mt-3 text-[11px] text-neutral-500 leading-relaxed max-w-prose">
        How many fully-paid nights you need each month to cover your turnover costs.
        Below this line, you&apos;re paying to host.
      </p>
    </GlassCard>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (highlight
          ? "border-teal-400/30 bg-teal-500/[0.06]"
          : "border-white/5 bg-white/[0.02]")
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="text-xl lg:text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}
