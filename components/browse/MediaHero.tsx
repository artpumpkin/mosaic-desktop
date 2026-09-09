"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Play, Info, Star, Heart, Sparkles } from "lucide-react";
import clsx from "clsx";
import type { CatalogItem } from "@/lib/movies/types";

type Props = {
  items: CatalogItem[];
  onPlay: (item: CatalogItem) => void;
  onInfo: (item: CatalogItem) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  /** Badge label in the corner. Defaults to "Featured". */
  badgeLabel?: string;
  /** Primary action label/icon. Defaults to a Play glyph + "Play". */
  primaryLabel?: string;
  primaryIcon?: ReactNode;
  /** Override the favorite glyph (defaults to Heart) — e.g. Rss for subscribe. */
  favoriteIcon?: ReactNode;
  favoriteActiveIcon?: ReactNode;
  /** Accessible verb for the toggle ("favorites", "subscriptions"). */
  favoriteLabel?: string;
};

const ROTATE_MS = 8000;

// A cinematic, auto-rotating spotlight for the top of a browse page. Prefers a
// wide cover (background) image and falls back to the poster. The whole stage
// cross-fades between featured titles every few seconds; the user can jump with
// the dot indicators or pause-on-hover. Shared by the Anime + Movies sections.
export default function MediaHero({
  items,
  onPlay,
  onInfo,
  favorites,
  onToggleFavorite,
  badgeLabel = "Featured",
  primaryLabel = "Play",
  primaryIcon,
  favoriteIcon,
  favoriteActiveIcon,
  favoriteLabel = "favorites",
}: Props) {
  const slides = useMemo(
    () => items.filter((it) => it.background || it.poster).slice(0, 5),
    [items],
  );
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Keep the index in range as the slide set hydrates.
  useEffect(() => {
    if (idx >= slides.length) setIdx(0);
  }, [slides.length, idx]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % slides.length),
      ROTATE_MS,
    );
    return () => clearInterval(t);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;
  const active = slides[Math.min(idx, slides.length - 1)];
  const fav = favorites.has(active.id);

  return (
    <section
      className="relative -mx-4 md:-mx-6 -mt-5 md:-mt-8 mb-2 h-[clamp(380px,56vh,560px)] overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
    >
      {/* Stacked backgrounds, cross-faded */}
      {slides.map((s, i) => (
        <div
          key={s.id}
          aria-hidden={i !== idx}
          className={clsx(
            "absolute inset-0 transition-opacity duration-700 ease-out",
            i === idx ? "opacity-100" : "opacity-0",
          )}
        >
          {(s.background || s.poster) && (
            <img
              src={s.background || s.poster || ""}
              alt=""
              className="w-full h-full object-cover object-center scale-105"
              loading={i === 0 ? "eager" : "lazy"}
            />
          )}
        </div>
      ))}

      {/* Legibility gradients: bottom (text), left (text), subtle top */}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)]/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--background)]/90 via-[var(--background)]/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--background)]/40 to-transparent" />

      {/* Content */}
      <div className="relative h-full flex flex-col justify-end px-6 md:px-12 pb-8 md:pb-12 max-w-3xl">
        <div className="inline-flex items-center gap-1.5 mb-3.5 w-fit px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-semibold uppercase tracking-wider text-neutral-100 backdrop-blur-md">
          <Sparkles size={12} />
          {badgeLabel}
        </div>

        <h1 className="text-4xl md:text-6xl font-bold tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] line-clamp-2">
          {active.name}
        </h1>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-neutral-200">
          {active.imdbRating && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-200">
              <Star size={13} className="fill-amber-300 text-amber-300" />
              {active.imdbRating}
            </span>
          )}
          {active.releaseInfo && <span>{active.releaseInfo}</span>}
          <span className="px-1.5 py-0.5 rounded bg-white/10 border border-white/10 text-[11px] uppercase tracking-wide">
            {active.type === "movie" ? "Movie" : "Series"}
          </span>
          {active.runtime && <span>{active.runtime}</span>}
        </div>

        {active.description && (
          <p className="mt-3 text-[13px] md:text-sm leading-relaxed text-neutral-300/90 line-clamp-2 md:line-clamp-3 max-w-2xl">
            {active.description}
          </p>
        )}

        <div className="mt-6 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onPlay(active)}
            className="inline-flex items-center gap-2 pl-5 pr-6 py-3 rounded-full bg-white text-black font-semibold text-[14px] hover:bg-white/90 active:scale-[0.98] transition shadow-lg shadow-black/30"
          >
            {primaryIcon ?? <Play size={16} fill="currentColor" />}
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={() => onInfo(active)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white/10 text-white font-medium text-[14px] border border-white/15 hover:bg-white/20 backdrop-blur-md transition"
          >
            <Info size={16} />
            Details
          </button>
          <button
            type="button"
            onClick={() => onToggleFavorite(active.id)}
            aria-label={fav ? `Remove from ${favoriteLabel}` : `Add to ${favoriteLabel}`}
            aria-pressed={fav}
            className={clsx(
              "grid place-items-center w-11 h-11 rounded-full border backdrop-blur-md transition active:scale-95",
              fav
                ? "bg-rose-500/90 border-rose-400/50 text-white"
                : "bg-white/10 border-white/15 text-white hover:bg-white/20",
            )}
          >
            {favoriteIcon ? (
              fav ? (favoriteActiveIcon ?? favoriteIcon) : favoriteIcon
            ) : (
              <Heart size={17} fill={fav ? "currentColor" : "none"} />
            )}
          </button>
        </div>
      </div>

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 right-5 md:right-10 flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === idx}
              className={clsx(
                "h-1.5 rounded-full transition-all",
                i === idx
                  ? "w-6 bg-white"
                  : "w-1.5 bg-white/40 hover:bg-white/70",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
