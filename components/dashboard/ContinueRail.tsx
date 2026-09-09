"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Clapperboard,
  BookOpen,
  Tv,
  Sparkles,
  Library,
  Music2,
  Play,
} from "lucide-react";
import clsx from "clsx";
import {
  loadContinueQueue,
  type ContinueItem,
  type ContinueKind,
} from "@/lib/continue/aggregate";

const KIND_ICON: Record<ContinueKind, typeof Film> = {
  movie: Film,
  series: Clapperboard,
  manga: BookOpen,
  book: Library,
  tv: Tv,
  anime: Sparkles,
  audio: Music2,
};

const KIND_TINT: Record<ContinueKind, string> = {
  movie: "text-rose-300",
  series: "text-rose-300",
  manga: "text-amber-300",
  book: "text-sky-300",
  tv: "text-violet-300",
  anime: "text-pink-300",
  audio: "text-teal-300",
};

export default function ContinueRail() {
  // null until hydrated so SSR markup (nothing) matches the first client paint.
  const [items, setItems] = useState<ContinueItem[] | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    setItems(loadContinueQueue());
  }, []);

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
  }, [items]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };

  if (!items || items.length === 0) return null;

  return (
    <section className="relative group/rail">
      <header className="flex items-center gap-2 px-1 mb-2 text-xs uppercase tracking-[0.22em] text-violet-300/80">
        <Play size={13} />
        Up next
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
          className="flex gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x"
        >
          {items.map((it) => (
            <ContinueCard key={it.key} item={it} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ContinueCard({ item }: { item: ContinueItem }) {
  const Icon = KIND_ICON[item.kind];
  // Live TV logos are wide + often transparent; everything else is a portrait
  // poster/cover. Contain TV logos on a dark tile, cover the rest.
  const isTv = item.kind === "tv";
  // Track logos that fail to load so we can drop back to the kind icon instead
  // of showing a blank/broken tile (common for channel logos).
  const [broken, setBroken] = useState(false);
  const showCover = item.cover != null && !broken;
  return (
    <Link
      href={item.href}
      className="group/card relative shrink-0 w-[132px] snap-start"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/5 bg-white/[0.03]">
        {showCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.cover!}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className={clsx(
              "w-full h-full transition-transform duration-300 group-hover/card:scale-[1.04]",
              isTv ? "object-contain p-4" : "object-cover",
            )}
          />
        ) : (
          // Cover-less tile (esp. logo-less Live TV channels): show a clearly
          // visible, kind-tinted glyph so the card reads as its medium.
          <div
            className={clsx(
              "w-full h-full grid place-items-center bg-gradient-to-b from-white/[0.04] to-transparent",
              KIND_TINT[item.kind],
            )}
          >
            <Icon size={40} className="opacity-80" />
          </div>
        )}

        {/* Play affordance on hover */}
        <div className="absolute inset-0 grid place-items-center opacity-0 group-hover/card:opacity-100 bg-black/30 transition-opacity">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-white/90 text-black">
            <Play size={18} className="translate-x-0.5" />
          </span>
        </div>

        {/* Kind chip */}
        <span
          className={clsx(
            "absolute top-1.5 left-1.5 grid place-items-center w-6 h-6 rounded-md bg-black/70 backdrop-blur border border-white/10",
            KIND_TINT[item.kind],
          )}
        >
          <Icon size={13} />
        </span>

        {/* Badge (episode / chapter / Live TV) */}
        {item.badge && (
          <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 text-[10.5px] text-neutral-200 border border-white/10">
            {item.badge}
          </span>
        )}

        {/* Progress bar */}
        {item.fraction != null && item.fraction > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div
              className="h-full bg-rose-400"
              style={{ width: `${Math.round(item.fraction * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-1.5 px-0.5 text-[12px] leading-tight text-neutral-300 line-clamp-2 group-hover/card:text-white transition-colors">
        {item.title}
      </div>
    </Link>
  );
}
