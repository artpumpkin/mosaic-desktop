"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Tv, Heart } from "lucide-react";
import clsx from "clsx";
import type { TvChannel } from "@/lib/tv/types";

type Props = {
  title: string;
  /** Stable identifier for this rail — used to scope the active-channel
   * highlight so the same channel appearing in multiple rails (e.g. Favorites
   * + News) only lights up in the rail the user picked from. */
  railKey: string;
  /** The rail key the active channel was picked from; null = no rail
   * highlight (e.g. initial load, "all" navigation mode). */
  activeRailKey: string | null;
  count?: number;
  channels: TvChannel[];
  countryFlags: Map<string, string>;
  activeChannelId: string | null;
  favorites: Set<string>;
  onPick: (channel: TvChannel) => void;
  onToggleFavorite: (id: string) => void;
};

export default function ChannelRail({
  title,
  railKey,
  activeRailKey,
  count,
  channels,
  countryFlags,
  activeChannelId,
  favorites,
  onPick,
  onToggleFavorite,
}: Props) {
  const railIsActive = railKey === activeRailKey;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Track scroll position so we can dim/hide the arrow buttons at the ends.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [channels.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  if (channels.length === 0) return null;

  return (
    <section className="relative group/rail">
      <header className="flex items-baseline px-1 mb-3">
        <h2 className="text-[17px] md:text-lg font-bold tracking-[-0.01em] text-neutral-100">
          {title}
          {typeof count === "number" && count > channels.length && (
            <span className="ml-2 text-[12px] font-normal text-neutral-500">
              {channels.length} of {count.toLocaleString()}
            </span>
          )}
        </h2>
      </header>

      <div className="relative">
        {/* Edge fades */}
        <div
          aria-hidden
          className={clsx(
            "pointer-events-none absolute inset-y-0 left-0 w-12 z-10 bg-gradient-to-r from-[var(--background)] to-transparent transition-opacity",
            canLeft ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden
          className={clsx(
            "pointer-events-none absolute inset-y-0 right-0 w-12 z-10 bg-gradient-to-l from-[var(--background)] to-transparent transition-opacity",
            canRight ? "opacity-100" : "opacity-0",
          )}
        />

        {/* Scroll buttons (desktop only, visible on rail hover) */}
        {canLeft && (
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            className="hidden md:grid place-items-center absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white opacity-0 group-hover/rail:opacity-100 transition-opacity"
            aria-label="Scroll left"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {canRight && (
          <button
            type="button"
            onClick={() => scrollBy(1)}
            className="hidden md:grid place-items-center absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white opacity-0 group-hover/rail:opacity-100 transition-opacity"
            aria-label="Scroll right"
          >
            <ChevronRight size={18} />
          </button>
        )}

        <div
          ref={scrollerRef}
          className="flex gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x"
        >
          {channels.map((c) => {
            const active = railIsActive && c.id === activeChannelId;
            const flag = countryFlags.get(c.country);
            const isFav = favorites.has(c.id);
            // Card is a div, not a button, so the favorite toggle (a real
            // <button>) can nest inside it without invalid HTML.
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => onPick(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(c);
                  }
                }}
                className={clsx(
                  "group/card relative snap-start shrink-0 w-[160px] rounded-2xl text-left cursor-pointer overflow-hidden",
                  "transition-[transform,box-shadow,background-color,border-color] duration-200 ease-out",
                  "hover:-translate-y-1 hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.65)]",
                  "bg-white/[0.03] hover:bg-white/[0.07] border focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
                  active
                    ? "border-white/25 ring-1 ring-white/30"
                    : "border-white/5 hover:border-white/10",
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(c.id);
                  }}
                  aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                  aria-pressed={isFav}
                  className={clsx(
                    "absolute top-1.5 right-1.5 z-10 grid place-items-center w-6 h-6 rounded-md backdrop-blur transition-all",
                    isFav
                      ? "bg-rose-500/90 text-white opacity-100"
                      : "bg-black/60 text-neutral-200 opacity-0 group-hover/card:opacity-100 hover:bg-black/80",
                  )}
                >
                  <Heart
                    size={12}
                    strokeWidth={2.5}
                    fill={isFav ? "currentColor" : "none"}
                  />
                </button>

                <div className="w-full aspect-video bg-black/50 grid place-items-center overflow-hidden">
                  {c.logo ? (
                    <img
                      src={c.logo}
                      alt=""
                      className="max-w-[78%] max-h-[78%] object-contain transition-transform group-hover/card:scale-[1.04]"
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
                    className="text-neutral-600"
                    style={{ display: c.logo ? "none" : "grid" }}
                  >
                    <Tv size={26} />
                  </span>
                </div>
                <div className="px-3 py-2.5">
                  <div className="text-[13px] font-medium leading-tight tracking-[-0.01em] truncate">
                    {c.name}
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate flex items-center gap-1 mt-1">
                    {flag && <span aria-hidden>{flag}</span>}
                    <span>{c.country}</span>
                    {c.categories[0] && (
                      <>
                        <span className="opacity-50">·</span>
                        <span className="truncate">{c.categories[0]}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
