"use client";
import { useState } from "react";
import GlassCard from "@/components/GlassCard";
import { Sparkles } from "lucide-react";
import { projectedNet } from "@/lib/rentals/math";
import type { RentalSettings } from "@/lib/rentals/types";
import { fmtMad } from "@/lib/format";

export function WhatIfSimulator({
  settings,
  daysInMonth,
}: {
  settings: RentalSettings;
  daysInMonth: number;
}) {
  const [occupancy, setOccupancy] = useState(50);
  const net = projectedNet(occupancy, settings, daysInMonth);
  const nights = Math.round((occupancy / 100) * daysInMonth);
  return (
    <GlassCard>
      <h2 className="font-medium mb-3 flex items-center gap-2">
        <Sparkles size={15} className="text-teal-300" /> What if…
      </h2>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-400">Occupancy</span>
            <span className="font-medium tabular-nums">{occupancy}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={occupancy}
            onChange={(e) => setOccupancy(Number(e.target.value))}
            className="w-full mt-1 accent-teal-400"
            aria-label="Occupancy"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Stat label="Nights" value={`${nights}`} sub={`of ${daysInMonth}`} />
          <Stat
            label="Projected net"
            value={fmtMad(net)}
            highlight={net >= 0}
            negative={net < 0}
          />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-neutral-500 leading-relaxed max-w-prose">
        Assumes ~3-night average stays and your default per-turnover costs from settings.
      </p>
    </GlassCard>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-3 " +
        (highlight
          ? "border-teal-400/30 bg-teal-500/[0.06]"
          : negative
            ? "border-rose-400/30 bg-rose-500/[0.06]"
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
