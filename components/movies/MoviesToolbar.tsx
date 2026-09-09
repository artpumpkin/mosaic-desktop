"use client";
import {
  LayoutGrid,
  Film,
  Tv2,
  Maximize2,
  Minimize2,
  Info,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import BrowseToolbar from "@/components/browse/BrowseToolbar";
import SegmentedTabs from "@/components/browse/SegmentedTabs";
import SearchInput from "@/components/browse/SearchInput";

// "all" surfaces both movies and series interleaved (mirrors the Anime
// section). The page fans the fetch out to both Cinemeta types and merges.
export type MovieType = "all" | "movie" | "series";

export type MoviesFilters = {
  type: MovieType;
  catalogId: string; // "top" | "year" | "imdbRating" — doubles as the sort
  genre: string | null;
  search: string;
};

// The default catalog ("Popular") is the section's resting state — selecting it
// plus no genre means the multi-rail home, not a single browse grid.
export const DEFAULT_MOVIES_CATALOG = "top";

type Props = {
  filters: MoviesFilters;
  onChange: (next: Partial<MoviesFilters>) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onOpenSettings: () => void;
  resultCount?: number;
  // True when no RD token is set — surface the "torrent fallback" banner.
  torrentFallback?: boolean;
  /** When any browse filter is active, surface a quick "Clear" affordance. */
  onClear?: () => void;
  filtersActive?: boolean;
};

export default function MoviesToolbar({
  filters,
  onChange,
  focusMode,
  onToggleFocus,
  onOpenSettings,
  resultCount,
  torrentFallback,
  onClear,
  filtersActive,
}: Props) {
  return (
    <BrowseToolbar>
      {/* All | Movies | Series segmented control */}
      <SegmentedTabs
        value={filters.type}
        onChange={(type) => onChange({ type })}
        tabs={[
          { value: "all", label: "All", icon: <LayoutGrid size={13} /> },
          { value: "movie", label: "Movies", icon: <Film size={13} /> },
          { value: "series", label: "Series", icon: <Tv2 size={13} /> },
        ]}
      />

      {/* Genre + sort are no longer toolbar dropdowns: genres are picked from
          the "Browse by genre" card grid on the home view, and sort is carried
          by the catalog rails (Popular / By year / Top rated). */}

      <SearchInput
        value={filters.search}
        onChange={(search) => onChange({ search })}
        placeholder={
          filters.type === "movie"
            ? "Search movies…"
            : filters.type === "series"
              ? "Search series…"
              : "Search…"
        }
      />

      <div className="flex-1" />

      {filtersActive && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[12px] text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          Clear filters
        </button>
      )}

      {torrentFallback && (
        <div className="relative group/rd">
          <a
            href="/settings"
            className="grid place-items-center p-1.5 rounded-lg border bg-amber-500/10 border-amber-400/30 text-amber-200/90 hover:bg-amber-500/20 hover:text-amber-100 transition-colors"
            aria-label="Streaming via built-in torrent engine. Click to add a Real-Debrid token in Settings."
          >
            <Info size={14} />
          </a>
          <div
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full mt-1.5 w-64 px-3 py-2 rounded-lg bg-neutral-900/95 border border-white/10 shadow-xl shadow-black/40 text-[11.5px] leading-relaxed text-amber-100/90 opacity-0 translate-y-1 group-hover/rd:opacity-100 group-hover/rd:translate-y-0 group-focus-within/rd:opacity-100 group-focus-within/rd:translate-y-0 transition z-40"
          >
            Streaming via the built-in torrent engine. Add a Real-Debrid
            token in <span className="underline decoration-amber-300/40">Settings</span> for instant playback.
          </div>
        </div>
      )}

      {typeof resultCount === "number" && (
        <span className="text-[11px] text-neutral-500 hidden sm:inline tabular-nums">
          {resultCount.toLocaleString()} {resultCount === 1 ? "title" : "titles"}
        </span>
      )}

      <button
        type="button"
        onClick={onToggleFocus}
        className={clsx(
          "p-1.5 rounded-lg border transition-colors",
          focusMode
            ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
            : "bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10",
        )}
        title={focusMode ? "Exit focus mode" : "Focus mode"}
        aria-pressed={focusMode}
        aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
      >
        {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        className="p-1.5 rounded-lg border bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10 transition-colors"
        title="Movies settings"
        aria-label="Movies settings"
      >
        <Settings size={14} />
      </button>
    </BrowseToolbar>
  );
}
