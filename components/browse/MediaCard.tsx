"use client";
import type { ReactNode } from "react";
import { Heart, Play, Film } from "lucide-react";
import clsx from "clsx";

/**
 * The single poster card shared by every entertainment section (Movies, TV,
 * Anime, Manga, Audio, YouTube). Sections feed it normalized fields and a few
 * appearance knobs; the markup — hover play overlay, favorite heart, rating
 * pill, progress bar — is identical everywhere so the surfaces stay coherent.
 *
 * Section-specific components (PosterCard, MangaCard, …) are thin adapters
 * that map their domain item onto these props.
 */

export type MediaCardAccent = "rose" | "violet" | "emerald" | "amber";

const ACCENT_BAR: Record<MediaCardAccent, string> = {
  rose: "bg-rose-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
};

export type MediaCardProps = {
  title: string;
  poster?: string | null;
  /** Muted second line — year, artist, genres, … */
  subtitle?: string | null;
  /** Optional rating pill shown top-left, e.g. "8.4" → "★ 8.4". */
  rating?: string | null;
  active?: boolean;
  isFavorite?: boolean;
  onPick: () => void;
  /** When omitted, the favorite heart isn't rendered. */
  onToggleFavorite?: () => void;
  /** "Continue" progress as a 0..1 fraction. */
  progress?: number;
  /** Bottom-left badge, e.g. "S2 · E3" or "Ch. 1054". */
  badge?: string;
  /** Stretch to the parent column instead of the fixed 160px rail width. */
  fluid?: boolean;
  /** Progress bar color. Defaults to rose. */
  accent?: MediaCardAccent;
  /** Poster aspect ratio. Posters are 2/3; audio art is square; video is 16/9. */
  aspect?: "2/3" | "1/1" | "16/9";
  /** Bottom-right duration pill, e.g. "12:04" (video cards). */
  durationBadge?: string;
  /** Shown when there's no poster. Defaults to a film icon. */
  fallbackIcon?: ReactNode;
  /** Centered icon revealed on hover. Defaults to a play glyph. */
  overlayIcon?: ReactNode;
  /** Accessible verb for the favorite toggle ("favorites", "library"). */
  favoriteLabel?: string;
  /**
   * Override the toggle glyph (defaults to a Heart). Use a non-heart icon when
   * the action isn't "favorite" — e.g. Rss for podcast subscribe, Bookmark for
   * watch-later — so a filled heart stays reserved for true favorites.
   */
  favoriteIcon?: ReactNode;
  /** Active-state glyph; falls back to favoriteIcon, then a filled Heart. */
  favoriteActiveIcon?: ReactNode;
};

export default function MediaCard({
  title,
  poster,
  subtitle,
  rating,
  active,
  isFavorite,
  onPick,
  onToggleFavorite,
  progress,
  badge,
  fluid,
  accent = "rose",
  aspect = "2/3",
  durationBadge,
  fallbackIcon,
  overlayIcon,
  favoriteLabel = "favorites",
  favoriteIcon,
  favoriteActiveIcon,
}: MediaCardProps) {
  // Rails use a fixed card width; wide (16:9) cards get more room than posters.
  const railWidth = aspect === "16/9" ? "w-[248px]" : "w-[160px]";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className={clsx(
        "group/poster relative rounded-2xl text-left cursor-pointer overflow-hidden",
        "transition-[transform,box-shadow,background-color,border-color] duration-200 ease-out",
        "hover:-translate-y-1 hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.65)]",
        fluid ? "w-full" : clsx("snap-start shrink-0", railWidth),
        "bg-white/[0.03] hover:bg-white/[0.07] border focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        active
          ? "border-white/25 ring-1 ring-white/30"
          : "border-white/5 hover:border-white/10",
      )}
    >
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={
            isFavorite ? `Remove from ${favoriteLabel}` : `Add to ${favoriteLabel}`
          }
          aria-pressed={isFavorite}
          className={clsx(
            "absolute top-1.5 right-1.5 z-20 grid place-items-center w-6 h-6 rounded-md backdrop-blur transition-all",
            isFavorite
              ? "bg-rose-500/90 text-white opacity-100"
              : "bg-black/60 text-neutral-200 opacity-0 group-hover/poster:opacity-100 hover:bg-black/80",
          )}
        >
          {favoriteIcon ? (
            isFavorite ? (favoriteActiveIcon ?? favoriteIcon) : favoriteIcon
          ) : (
            <Heart
              size={12}
              strokeWidth={2.5}
              fill={isFavorite ? "currentColor" : "none"}
            />
          )}
        </button>
      )}

      <div
        className={clsx(
          "relative w-full bg-black/60 overflow-hidden",
          aspect === "1/1"
            ? "aspect-square"
            : aspect === "16/9"
              ? "aspect-video"
              : "aspect-[2/3]",
        )}
      >
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="w-full h-full object-cover transition-transform group-hover/poster:scale-[1.04]"
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = "none";
              const sib = img.nextElementSibling as HTMLElement | null;
              if (sib) sib.style.display = "grid";
            }}
          />
        ) : null}
        <span
          className="absolute inset-0 grid place-items-center text-neutral-600"
          style={{ display: poster ? "none" : "grid" }}
        >
          {fallbackIcon ?? <Film size={32} />}
        </span>

        {/* Play/read overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 group-hover/poster:opacity-100 transition-opacity grid place-items-center">
          <div className="grid place-items-center w-11 h-11 rounded-full bg-white/90 text-black shadow-lg translate-y-2 group-hover/poster:translate-y-0 transition-transform">
            {overlayIcon ?? <Play size={20} fill="currentColor" />}
          </div>
        </div>

        {badge && (
          <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold tracking-wide text-white bg-black/70 px-1.5 py-0.5 rounded backdrop-blur">
            {badge}
          </span>
        )}

        {rating && (
          <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold text-amber-200 bg-black/70 px-1.5 py-0.5 rounded backdrop-blur">
            ★ {rating}
          </span>
        )}

        {durationBadge && (
          <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium tabular-nums text-white bg-black/80 px-1.5 py-0.5 rounded backdrop-blur">
            {durationBadge}
          </span>
        )}

        {progress != null && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
            <div
              className={clsx("h-full", ACCENT_BAR[accent])}
              style={{
                width: `${Math.min(100, Math.max(0, progress * 100)).toFixed(1)}%`,
              }}
            />
          </div>
        )}
      </div>

      <div className="px-3 py-2.5">
        <div
          className={clsx(
            "text-[13px] font-medium leading-tight tracking-[-0.01em]",
            // Video titles need two lines to be useful; posters stay single-line.
            aspect === "16/9" ? "line-clamp-2 min-h-[2.4em]" : "truncate",
          )}
        >
          {title}
        </div>
        <div className="text-[11px] text-neutral-500 truncate mt-1">
          {subtitle ?? " "}
        </div>
      </div>
    </div>
  );
}
