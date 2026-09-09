"use client";
import { Play, Pause, SkipBack, SkipForward, Music2, Mic } from "lucide-react";
import type { AudioItem } from "./useAudioPlayer";

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  current: AudioItem | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onNext: () => void;
  onPrev: () => void;
};

export default function NowPlayingBar({
  current,
  isPlaying,
  position,
  duration,
  onToggle,
  onSeek,
  onNext,
  onPrev,
}: Props) {
  if (!current) return null;
  const KindIcon = current.kind === "podcast" ? Mic : Music2;

  return (
    <div className="shrink-0 border-b border-white/10 bg-[var(--background)]/95 backdrop-blur-xl px-4 md:px-6 py-3">
      <div className="flex items-center gap-3">
        {/* Art */}
        <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-white/[0.05] border border-white/10 shrink-0 grid place-items-center">
          {current.art ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.art} alt="" className="w-full h-full object-cover" />
          ) : (
            <KindIcon size={18} className="text-neutral-500" />
          )}
        </div>

        {/* Title + transport + scrubber */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-neutral-100 truncate">
                {current.title}
              </div>
              {current.subtitle && (
                <div className="text-[11px] text-neutral-500 truncate">
                  {current.subtitle}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onPrev}
                className="grid place-items-center w-8 h-8 rounded-full text-neutral-300 hover:bg-white/10"
                aria-label="Previous"
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="grid place-items-center w-9 h-9 rounded-full bg-white text-black hover:bg-white/90"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="translate-x-0.5" />}
              </button>
              <button
                type="button"
                onClick={onNext}
                className="grid place-items-center w-8 h-8 rounded-full text-neutral-300 hover:bg-white/10"
                aria-label="Next"
              >
                <SkipForward size={16} />
              </button>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10.5px] tabular-nums text-neutral-500 w-9 text-right">
              {fmt(position)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1}
              value={Math.min(position, duration || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="flex-1 h-1 accent-rose-400 cursor-pointer"
              aria-label="Seek"
            />
            <span className="text-[10.5px] tabular-nums text-neutral-500 w-9">
              {fmt(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
