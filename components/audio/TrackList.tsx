"use client";
import { Loader2, Mic, Music2, Heart, Play, Pause } from "lucide-react";
import clsx from "clsx";

// A simple chronological list of playable items (episodes or tracks) shown
// below the browse grid once the user opens a podcast / album / artist — the
// audio analogue of the Movies "episode list" inside a title. Shared by all
// three Audio tabs.

export type TrackRow = {
  id: string;
  title: string;
  meta: string;
  art: string | null;
  active: boolean;
  onPlay: () => void;
  /** True while this row is the one currently playing (not just selected). */
  playing?: boolean;
  /** Optional favorite (star) toggle shown on the right. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
};

// Three animated bars — the now-playing equalizer on the active row.
function Equalizer() {
  return (
    <span className="flex items-end gap-[2px] h-3.5 shrink-0" aria-hidden>
      <span className="w-[2px] origin-bottom bg-rose-400 animate-[eqbar_0.9s_ease-in-out_infinite] h-2" />
      <span className="w-[2px] origin-bottom bg-rose-400 animate-[eqbar_0.9s_ease-in-out_infinite_0.2s] h-3.5" />
      <span className="w-[2px] origin-bottom bg-rose-400 animate-[eqbar_0.9s_ease-in-out_infinite_0.4s] h-2.5" />
    </span>
  );
}

export function fmtDuration(sec: number | null): string | null {
  if (sec == null) return null;
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60)
    .toString()
    .padStart(2, "0")}`;
}

export default function TrackList({
  title,
  subtitle,
  rows,
  loading,
  kind,
  action,
  favoritesAlwaysVisible = false,
}: {
  title: string;
  subtitle?: string | null;
  rows: TrackRow[];
  loading?: boolean;
  kind: "podcast" | "music";
  /** Optional trailing control in the header (e.g. a Follow button). */
  action?: React.ReactNode;
  /** Keep the favorite heart visible at rest instead of revealing on hover. */
  favoritesAlwaysVisible?: boolean;
}) {
  const KindIcon = kind === "podcast" ? Mic : Music2;
  return (
    <section>
      <h2 className="text-sm font-semibold tracking-tight text-neutral-100 mb-2 px-1 flex items-center gap-2">
        {title}
        {subtitle && (
          <span className="text-[11px] font-normal text-neutral-500">{subtitle}</span>
        )}
        {loading && <Loader2 size={13} className="animate-spin text-neutral-400" />}
        {action && <span className="ml-auto">{action}</span>}
      </h2>
      <div className="space-y-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className={clsx(
              "group/track w-full flex items-center gap-3 p-2 rounded-lg border transition-colors",
              row.active
                ? "bg-rose-500/15 border-rose-400/40"
                : "bg-white/[0.02] border-white/5 hover:bg-white/[0.06]",
            )}
          >
            <button
              type="button"
              onClick={row.onPlay}
              className="relative w-10 h-10 rounded-lg overflow-hidden bg-white/[0.05] border border-white/10 shrink-0 grid place-items-center"
              aria-label={`Play ${row.title}`}
            >
              {row.art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.art} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <KindIcon size={15} className="text-neutral-600" />
              )}
              {/* Hover play / now-playing overlay */}
              <span
                className={clsx(
                  "absolute inset-0 grid place-items-center bg-black/55 transition-opacity",
                  row.active ? "opacity-100" : "opacity-0 group-hover/track:opacity-100",
                )}
              >
                {row.active ? (
                  row.playing ? (
                    <Pause size={15} className="text-white" fill="currentColor" />
                  ) : (
                    <Play size={15} className="text-white" fill="currentColor" />
                  )
                ) : (
                  <Play size={15} className="text-white" fill="currentColor" />
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={row.onPlay}
              className="min-w-0 flex-1 text-left"
            >
              <div
                className={clsx(
                  "text-[13px] truncate flex items-center gap-2",
                  row.active ? "text-rose-200" : "text-neutral-100",
                )}
              >
                {row.active && row.playing && <Equalizer />}
                <span className="truncate">{row.title}</span>
              </div>
              {row.meta && (
                <div className="text-[11px] text-neutral-500 truncate">{row.meta}</div>
              )}
            </button>

            {row.onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  row.onToggleFavorite?.();
                }}
                aria-label={row.favorite ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={row.favorite}
                className={clsx(
                  "shrink-0 grid place-items-center w-8 h-8 rounded-lg transition-colors",
                  row.favorite
                    ? "text-rose-400 hover:text-rose-300"
                    : favoritesAlwaysVisible
                      ? "text-neutral-400 hover:text-neutral-200"
                      : "text-neutral-500 opacity-0 group-hover/track:opacity-100 hover:text-neutral-200",
                )}
              >
                <Heart size={15} fill={row.favorite ? "currentColor" : "none"} />
              </button>
            )}
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-neutral-500 px-1 py-4">Nothing here yet.</p>
        )}
      </div>
    </section>
  );
}
