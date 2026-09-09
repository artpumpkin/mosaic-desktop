"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, Loader2 } from "lucide-react";
import { fmtBytes } from "@/lib/format";

export type OrbState = "idle" | "analyzing" | "ready" | "cleaning" | "done";

const SIZE = 240;
const R = 108;
const C = 2 * Math.PI * R;

/** Eased count-up from the previously shown value to `target`. */
function useCountUp(target: number, durationMs = 850): number {
  const [val, setVal] = useState(target);
  const ref = useRef(target);
  useEffect(() => {
    const from = ref.current;
    if (from === target) return;
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      ref.current = v;
      setVal(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

export default function CleanupOrb({
  state,
  bytes,
  filesSeen,
  actionLabel,
  onAction,
  actionDisabled,
  secondaryLabel,
  onSecondary,
}: {
  state: OrbState;
  /** Number shown in the center (reclaimable when ready, freed when done). */
  bytes: number;
  filesSeen?: number;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const working = state === "analyzing" || state === "cleaning";
  const done = state === "done";
  const counted = useCountUp(state === "ready" || done ? bytes : 0);

  // Ring fill: a satisfying full sweep on completion, drains while cleaning.
  const pct =
    state === "ready" || done ? 1 : state === "cleaning" ? 0 : state === "idle" ? 0 : 1;

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* Glow */}
        <div
          className={`absolute inset-4 rounded-full blur-2xl ${
            working ? "cleanup-breathe-fast" : "cleanup-breathe"
          }`}
          style={{
            background: done
              ? "radial-gradient(circle, rgba(52,211,153,0.45), transparent 70%)"
              : "radial-gradient(circle, rgba(168,85,247,0.4), rgba(217,70,239,0.25) 50%, transparent 70%)",
          }}
        />

        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative w-full h-full">
          <defs>
            <linearGradient id="orbGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="55%" stopColor="#d946ef" />
              <stop offset="100%" stopColor="#22d3ee" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={120}
            cy={120}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={10}
          />
          {/* Progress / indeterminate arc */}
          <g
            className={state === "analyzing" ? "cleanup-spin" : ""}
            style={{ transformOrigin: "120px 120px" }}
          >
            <circle
              cx={120}
              cy={120}
              r={R}
              fill="none"
              stroke={done ? "#34d399" : "url(#orbGrad)"}
              strokeWidth={10}
              strokeLinecap="round"
              transform="rotate(-90 120 120)"
              strokeDasharray={
                state === "analyzing" ? `${C * 0.22} ${C * 0.78}` : C
              }
              strokeDashoffset={state === "analyzing" ? 0 : C * (1 - pct)}
              style={{
                transition:
                  state === "analyzing"
                    ? "none"
                    : "stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)",
              }}
            />
          </g>
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 grid place-items-center text-center px-8">
          {done ? (
            <div className="cleanup-pop flex flex-col items-center gap-1">
              <Check size={34} className="text-emerald-300" strokeWidth={3} />
              <span className="text-2xl font-semibold tracking-tight">
                {fmtBytes(counted)}
              </span>
              <span className="text-xs text-neutral-400">freed</span>
            </div>
          ) : state === "analyzing" ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 size={22} className="text-violet-300 animate-spin" />
              <span className="text-sm text-neutral-300">Analyzing…</span>
              {filesSeen != null && (
                <span className="text-[11px] text-neutral-500 tabular-nums">
                  {filesSeen.toLocaleString()} files
                </span>
              )}
            </div>
          ) : state === "cleaning" ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 size={22} className="text-fuchsia-300 animate-spin" />
              <span className="text-sm text-neutral-300">Cleaning…</span>
            </div>
          ) : state === "ready" ? (
            <div className="cleanup-pop flex flex-col items-center gap-0.5">
              <span className="text-3xl font-semibold tracking-tight gradient-text">
                {fmtBytes(counted)}
              </span>
              <span className="text-xs text-neutral-400">
                {bytes > 0 ? "reclaimable" : "all clean"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Sparkles size={30} className="text-violet-300" />
              <span className="text-xs text-neutral-400">Ready to analyze</span>
            </div>
          )}
        </div>
      </div>

      {/* Primary action */}
      <button
        type="button"
        onClick={onAction}
        disabled={actionDisabled || working}
        className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-medium text-white
                   bg-gradient-to-br from-violet-500 via-fuchsia-500 to-violet-500
                   shadow-[0_8px_30px_-6px_rgba(168,85,247,0.6)]
                   transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_36px_-6px_rgba(168,85,247,0.75)]
                   disabled:opacity-50 disabled:translate-y-0 disabled:cursor-not-allowed"
      >
        {working ? (
          <Loader2 size={16} className="animate-spin" />
        ) : done ? (
          <Check size={16} />
        ) : (
          <Sparkles size={16} />
        )}
        {actionLabel}
      </button>

      {secondaryLabel && onSecondary && !working && (
        <button
          type="button"
          onClick={onSecondary}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
