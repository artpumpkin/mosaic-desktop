"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

/**
 * Horizontal, snap-scrolling rail shared by every section. Owns the scroller,
 * edge gradients, hover arrows, header and optional "See all" affordance.
 * Cards are supplied via a render prop so each section keeps its own typed
 * item + click handlers while the chrome stays identical.
 *
 * Renders nothing when `items` is empty (matches the old PosterRail/MangaRail).
 */
type MediaRailProps<T> = {
  title: string;
  /** Total available count — shown as "N of M" when greater than items.length. */
  count?: number;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onSeeAll?: () => void;
};

export default function MediaRail<T>({
  title,
  count,
  items,
  getKey,
  renderItem,
  onSeeAll,
}: MediaRailProps<T>) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

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
  }, [items.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  if (items.length === 0) return null;

  const countLabel =
    typeof count === "number" && count > items.length ? (
      <span className="text-[12px] font-normal text-neutral-500 tracking-normal">
        {items.length} of {count.toLocaleString()}
      </span>
    ) : null;
  const titleCls =
    "text-[17px] md:text-lg font-bold tracking-[-0.01em] text-neutral-100 truncate";

  return (
    <section className="relative group/rail">
      <header className="flex items-baseline px-1 mb-3">
        {onSeeAll ? (
          <button
            type="button"
            onClick={onSeeAll}
            className="group/seeall inline-flex items-baseline gap-1.5 text-left min-w-0"
          >
            <h2 className={titleCls}>{title}</h2>
            <ChevronRight
              size={19}
              className="self-center shrink-0 text-neutral-500 transition-all group-hover/seeall:translate-x-0.5 group-hover/seeall:text-neutral-200"
            />
            {countLabel}
          </button>
        ) : (
          <h2 className={titleCls}>
            {title}
            {countLabel && <span className="ml-2">{countLabel}</span>}
          </h2>
        )}
      </header>

      <div className="relative">
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
          {items.map((item) => (
            <div key={getKey(item)} className="contents">
              {renderItem(item)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
