"use client";
import clsx from "clsx";
import { SORT_OPTIONS, type BrowseSort } from "@/lib/manga/genres";

type Props = {
  sort: BrowseSort;
  onSort: (s: BrowseSort) => void;
  genre: string | null;
  onGenre: (id: string | null) => void;
  genres: { label: string; id: string }[];
  showGenres: boolean;
};

export default function MangaFilterBar({
  sort,
  onSort,
  genre,
  onGenre,
  genres,
  showGenres,
}: Props) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {/* Sort segmented control */}
      <div className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-white/[0.05] border border-white/10 p-0.5">
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onSort(o.id)}
            className={clsx(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors whitespace-nowrap",
              sort === o.id
                ? "bg-violet-500 text-white shadow-sm shadow-violet-500/30"
                : "text-neutral-400 hover:text-white",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {showGenres && (
        <>
          <div className="shrink-0 w-px h-5 bg-white/10 mx-1" />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onGenre(null)}
              className={clsx(
                "shrink-0 rounded-full px-3 py-1 text-[12px] font-medium border transition-colors whitespace-nowrap",
                genre === null
                  ? "bg-white/15 border-white/20 text-white"
                  : "bg-transparent border-white/10 text-neutral-400 hover:text-white hover:border-white/20",
              )}
            >
              All
            </button>
            {genres.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onGenre(genre === g.id ? null : g.id)}
                className={clsx(
                  "shrink-0 rounded-full px-3 py-1 text-[12px] font-medium border transition-colors whitespace-nowrap",
                  genre === g.id
                    ? "bg-violet-500/20 border-violet-400/50 text-violet-100"
                    : "bg-transparent border-white/10 text-neutral-400 hover:text-white hover:border-white/20",
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
