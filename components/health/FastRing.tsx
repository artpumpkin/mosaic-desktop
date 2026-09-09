"use client";
import clsx from "clsx";
import {
  FAST_STAGES,
  type FastStage,
  type FastType,
  FAST_TYPE_LABEL,
  defaultTargetHours,
  formatClock,
  formatDurationShort,
  nextStageAfter,
  stageForHours,
} from "@/lib/health/fasting";

type Props = {
  type: FastType;
  elapsedH: number;
  targetH: number | null;
  size?: number;
  stroke?: number;
};

export function FastRing({ type, elapsedH, targetH, size = 300, stroke = 16 }: Props) {
  const target = targetH ?? defaultTargetHours(type);
  const ratio = target && target > 0 ? Math.min(1, elapsedH / target) : 0;
  const reached = target ? elapsedH >= target : false;

  const stage = stageForHours(elapsedH);
  const next = nextStageAfter(elapsedH);

  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const dash = ratio * c;

  // Stage tick marks: only stages that begin within (0, target]
  const markers = target
    ? FAST_STAGES.filter((s) => s.startH > 0 && s.startH <= target).map((s) => ({
        stage: s,
        ratio: s.startH / target,
        reached: elapsedH >= s.startH,
      }))
    : [];

  const cx = size / 2;
  const cy = size / 2;

  // Position of the "head" of the progress arc — for a pulsing dot
  // SVG is rotated -90deg, so angle 0 = top, increasing clockwise
  const headAngle = ratio * 2 * Math.PI - Math.PI / 2;
  const headX = cx + radius * Math.cos(headAngle);
  const headY = cy + radius * Math.sin(headAngle);

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="block">
          <defs>
            <linearGradient id="fastRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={stage.ringColor} stopOpacity="0.95" />
              <stop offset="100%" stopColor={stage.ringColor} stopOpacity="0.65" />
            </linearGradient>
            <filter id="fastRingGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={`rotate(-90 ${cx} ${cy})`}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              stroke="url(#fastRingGrad)"
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dash} ${c}`}
              strokeLinecap="round"
              filter="url(#fastRingGlow)"
              style={{ transition: "stroke-dasharray 600ms cubic-bezier(0.16,1,0.3,1)" }}
            />

            {markers.map((m) => {
              const a = m.ratio * 2 * Math.PI;
              const inner = radius - stroke / 2 - 4;
              const outer = radius + stroke / 2 + 4;
              const x1 = cx + inner * Math.cos(a);
              const y1 = cy + inner * Math.sin(a);
              const x2 = cx + outer * Math.cos(a);
              const y2 = cy + outer * Math.sin(a);
              return (
                <line
                  key={m.stage.key}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={m.reached ? m.stage.ringColor : "rgba(255,255,255,0.18)"}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={m.reached ? 0.85 : 0.6}
                />
              );
            })}
          </g>

          {ratio > 0 && ratio < 1 && (
            <circle
              cx={headX}
              cy={headY}
              r={stroke / 2 + 1}
              fill={stage.ringColor}
              className="pulse-dot"
              style={{
                filter: `drop-shadow(0 0 8px ${stage.ringColor})`,
              }}
            />
          )}
        </svg>

        {/* Stage markers around outer edge with emoji */}
        {markers.map((m) => {
          const a = m.ratio * 2 * Math.PI - Math.PI / 2;
          const r = radius + stroke / 2 + 18;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          return (
            <span
              key={m.stage.key}
              className={clsx(
                "absolute text-[13px] leading-none select-none pointer-events-none transition-opacity",
                m.reached ? "opacity-100" : "opacity-30 grayscale",
              )}
              style={{
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
              }}
              title={`${m.stage.label} · ${m.stage.startH}h`}
            >
              {m.stage.emoji}
            </span>
          );
        })}

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-4xl mb-1 select-none" aria-hidden>
            {stage.emoji}
          </div>
          <div className="text-4xl sm:text-5xl font-semibold tabular-nums tracking-tight">
            {formatClock(elapsedH)}
          </div>
          <div
            className={clsx(
              "mt-1 text-[10px] uppercase tracking-[0.22em] font-medium",
              stage.textColor,
            )}
          >
            {stage.label}
          </div>
          {target && (
            <div className="mt-1.5 text-[11px] text-neutral-500 tabular-nums">
              {reached ? (
                <span className="text-emerald-300">
                  +{formatDurationShort(elapsedH - target)} past goal
                </span>
              ) : (
                <>
                  {(ratio * 100).toFixed(1)}% · {formatDurationShort(target - elapsedH)} to go
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stage description + next stage callout */}
      <div className="mt-4 max-w-md text-center space-y-2 px-3">
        <p className="text-sm text-neutral-300 leading-snug">{stage.description}</p>
        {next && (
          <p className="text-xs text-neutral-500">
            Next: <span className={clsx("font-medium", next.textColor)}>{next.emoji} {next.label}</span>
            {" "}in {formatDurationShort(next.startH - elapsedH)}
          </p>
        )}
        <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">
          {FAST_TYPE_LABEL[type]}
          {target ? ` · ${target}h goal` : null}
        </p>
      </div>
    </div>
  );
}

export function StagePill({ stage }: { stage: FastStage }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        stage.bgColor,
        stage.textColor,
      )}
    >
      <span aria-hidden>{stage.emoji}</span>
      {stage.label}
    </span>
  );
}
