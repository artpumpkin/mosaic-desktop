"use client";
import clsx from "clsx";

/**
 * Premium centered loading indicator — two counter-rotating gradient arcs over a
 * soft glow with a pulsing core. Used for detail/streams loading where a full
 * skeleton doesn't fit. Honors `prefers-reduced-motion` via Tailwind's motion
 * utilities falling back to a static ring.
 */
export default function MediaLoader({
  label,
  className,
  size = 48,
}: {
  label?: string;
  className?: string;
  size?: number;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-3.5 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="relative" style={{ width: size, height: size }}>
        {/* soft glow */}
        <div className="absolute inset-0 rounded-full bg-violet-500/25 blur-2xl animate-pulse" />
        {/* outer gradient arc */}
        <div className="media-loader-arc absolute inset-0 rounded-full border-[2.5px] border-white/10 border-t-violet-400 border-r-violet-400/50" />
        {/* inner counter-rotating arc */}
        <div className="media-loader-arc-rev absolute inset-[7px] rounded-full border-[2.5px] border-white/[0.06] border-b-fuchsia-300" />
        {/* pulsing core */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-white/80 animate-pulse shadow-[0_0_8px_2px_rgba(167,139,250,0.6)]" />
        </div>
      </div>
      {label && (
        <div className="text-[12.5px] text-neutral-400 tracking-wide animate-pulse">
          {label}
        </div>
      )}
    </div>
  );
}
