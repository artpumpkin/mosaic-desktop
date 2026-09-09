"use client";
import { BookOpen, Play, Heart, Sparkles } from "lucide-react";
import clsx from "clsx";
import type { Manga, MangaDetail } from "@/lib/manga/types";

type Props = {
  item: Manga;
  detail: MangaDetail | null;
  sourceName: string;
  isFavorite: boolean;
  onOpen: (item: Manga) => void;
  onToggleFavorite: (item: Manga) => void;
};

export default function MangaHero({
  item,
  detail,
  sourceName,
  isFavorite,
  onOpen,
  onToggleFavorite,
}: Props) {
  const cover = detail?.cover ?? item.cover;
  const genres = detail?.tags?.slice(0, 4) ?? [];
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 isolate">
      {/* Blurred cover backdrop */}
      {cover && (
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center scale-110 blur-xl opacity-50"
          style={{ backgroundImage: `url(${cover})` }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-[var(--background)] via-[var(--background)]/85 to-transparent"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-[var(--background)] via-transparent to-transparent"
      />

      <div className="relative flex items-center gap-7 p-8 sm:p-10 min-h-[340px]">
        {/* Floating crisp cover */}
        <div className="hidden sm:block shrink-0 w-48 aspect-[2/3] rounded-2xl overflow-hidden ring-1 ring-white/15 shadow-2xl shadow-black/60 rotate-[-2deg]">
          {cover ? (
            <img src={cover} alt={item.title} className="w-full h-full object-cover" />
          ) : (
            <span className="grid place-items-center w-full h-full bg-black/50 text-neutral-600">
              <BookOpen size={40} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 w-fit px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] font-semibold uppercase tracking-wider text-neutral-100 backdrop-blur-md mb-3">
            <Sparkles size={12} /> Featured · {sourceName}
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-[-0.02em] leading-[1.05] text-white drop-shadow">
            {item.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-neutral-300">
            {item.year != null && <span>{item.year}</span>}
            {item.status && item.status !== "unknown" && (
              <span className="capitalize">· {item.status}</span>
            )}
            {genres.length > 0 && <span className="text-neutral-500">· {genres.join(" · ")}</span>}
          </div>

          {detail?.description && (
            <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-300/90 line-clamp-3 max-w-xl">
              {detail.description}
            </p>
          )}

          <div className="mt-6 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-2 rounded-full bg-white text-black hover:bg-white/90 px-6 py-3 text-[14px] font-semibold shadow-lg transition-colors"
            >
              <Play size={15} fill="currentColor" /> Read now
            </button>
            <button
              type="button"
              onClick={() => onToggleFavorite(item)}
              aria-pressed={isFavorite}
              className={clsx(
                "grid place-items-center w-11 h-11 rounded-full border backdrop-blur transition-colors",
                isFavorite
                  ? "bg-rose-500/90 border-rose-400 text-white"
                  : "bg-white/10 border-white/15 text-white hover:bg-white/20",
              )}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart size={17} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
