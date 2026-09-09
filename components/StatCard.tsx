import { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import clsx from "clsx";
import GlassCard from "./GlassCard";

const TONE = {
  default: {
    iconBg: "bg-violet-500/15 text-violet-300 border-violet-400/20",
    value: "text-neutral-100",
  },
  positive: {
    iconBg: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
    value: "text-emerald-300",
  },
  negative: {
    iconBg: "bg-rose-500/15 text-rose-300 border-rose-400/20",
    value: "text-rose-300",
  },
  neutral: {
    iconBg: "bg-sky-500/15 text-sky-300 border-sky-400/20",
    value: "text-neutral-100",
  },
} as const;

export default function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <GlassCard hover className="flex items-center gap-3 sm:gap-4">
      <span
        className={clsx(
          "grid place-items-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl border shrink-0",
          t.iconBg
        )}
      >
        <Icon size={18} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-neutral-400 truncate">
          {label}
        </div>
        <div className={clsx("text-base sm:text-lg font-semibold tabular-nums break-words", t.value)}>
          {value}
        </div>
        {hint && (
          <div className="text-[11px] text-neutral-500 mt-0.5 truncate">{hint}</div>
        )}
      </div>
    </GlassCard>
  );
}
