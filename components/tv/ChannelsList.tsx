"use client";
import { useEffect, useRef } from "react";
import { Tv, Radio, Heart } from "lucide-react";
import clsx from "clsx";
import type { TvCategory, TvChannel } from "@/lib/tv/types";

type Group = [string, TvChannel[]];

type Props = {
  groups: Group[];
  categoriesByName: Map<string, TvCategory>;
  countryFlags: Map<string, string>;
  activeChannelId: string | null;
  /** Which group's row currently owns the active highlight — picked-from
   * group key (e.g. "favorites", "results", or a category id). null means no
   * row highlights, but the channel is still playing. */
  activeGroupId: string | null;
  favorites: Set<string>;
  onPick: (channel: TvChannel, groupId: string) => void;
  onToggleFavorite: (id: string) => void;
};

export default function ChannelsList({
  groups,
  categoriesByName,
  countryFlags,
  activeChannelId,
  activeGroupId,
  favorites,
  onPick,
  onToggleFavorite,
}: Props) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  // Keep the playing row in view when it changes (e.g. clicking Next). Scroll
  // only the nearest scroll container — never the document — so the rest of
  // the page doesn't lurch when the user clicks Next.
  useEffect(() => {
    const row = activeRef.current;
    if (!row) return;
    let scroller: HTMLElement | null = row.parentElement;
    while (scroller) {
      const oy = getComputedStyle(scroller).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const rowRect = row.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    if (rowRect.top < scRect.top) {
      scroller.scrollTop += rowRect.top - scRect.top - 8;
    } else if (rowRect.bottom > scRect.bottom) {
      scroller.scrollTop += rowRect.bottom - scRect.bottom + 8;
    }
  }, [activeChannelId]);

  return (
    <div className="py-1">
      {groups.map(([catId, items]) => {
        const meta = categoriesByName.get(catId);
        const title =
          catId === "favorites"
            ? "Favorites"
            : meta?.name ?? catId.charAt(0).toUpperCase() + catId.slice(1);
        const groupIsActive = catId === activeGroupId;
        return (
          <div key={catId} className="mb-1">
            <h3 className="sticky top-0 z-10 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-neutral-500 font-semibold bg-[var(--background)]/95 backdrop-blur flex items-center gap-1.5">
              {catId === "favorites" && (
                <Heart size={10} className="text-rose-400" fill="currentColor" />
              )}
              <span>{title}</span>
              <span className="ml-1 text-neutral-600 normal-case tracking-normal font-normal">
                {items.length}
              </span>
            </h3>
            {items.map((c) => {
              const active = groupIsActive && c.id === activeChannelId;
              const flag = countryFlags.get(c.country);
              const isFav = favorites.has(c.id);
              // Row is a div, not a button, so the favorite toggle (a real
              // <button>) can nest inside without invalid HTML.
              return (
                <div
                  key={c.id}
                  ref={active ? activeRef : undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(c, catId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(c, catId);
                    }
                  }}
                  className={clsx(
                    "w-full px-3 py-1.5 flex items-center gap-2.5 text-left transition-colors group/row cursor-pointer outline-none focus-visible:bg-white/[0.06]",
                    active
                      ? "bg-white/[0.08] text-white"
                      : "text-neutral-300 hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  <div className="w-8 h-8 rounded-md bg-black/40 border border-white/5 grid place-items-center overflow-hidden shrink-0">
                    {c.logo ? (
                      <img
                        src={c.logo}
                        alt=""
                        className="max-w-[78%] max-h-[78%] object-contain"
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
                      <Tv size={14} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium leading-tight truncate">
                      {c.name}
                    </div>
                    <div className="text-[10.5px] text-neutral-500 leading-tight truncate flex items-center gap-1">
                      {flag && <span aria-hidden>{flag}</span>}
                      <span>{c.country}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(c.id);
                    }}
                    aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={isFav}
                    className={clsx(
                      "p-1 rounded-md transition-all shrink-0",
                      isFav
                        ? "text-rose-400 opacity-100"
                        : "text-neutral-500 opacity-0 group-hover/row:opacity-100 hover:text-rose-300",
                    )}
                  >
                    <Heart
                      size={13}
                      strokeWidth={2}
                      fill={isFav ? "currentColor" : "none"}
                    />
                  </button>
                  {active && (
                    <Radio
                      size={13}
                      className="text-rose-400 animate-pulse shrink-0"
                      aria-label="Now playing"
                    />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
