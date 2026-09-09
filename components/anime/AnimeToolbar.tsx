"use client";
import {
  LayoutGrid,
  Tv2,
  Film,
  Search,
  Maximize2,
  Minimize2,
  X,
  ArrowDownUp,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import Combobox from "@/components/Combobox";
import { ANIME_SORTS, type AnimeSort } from "@/lib/anime/kitsu";

export type AnimeFilters = {
  type: "all" | "movie" | "series";
  genre: string | null; // Kitsu category slug
  sort: AnimeSort;
  search: string;
};

export const DEFAULT_ANIME_FILTERS: AnimeFilters = {
  type: "all",
  genre: null,
  sort: "featured",
  search: "",
};

const TYPE_TABS: { value: AnimeFilters["type"]; label: string; icon: typeof Tv2 }[] = [
  { value: "all", label: "All", icon: LayoutGrid },
  { value: "series", label: "Series", icon: Tv2 },
  { value: "movie", label: "Movies", icon: Film },
];

type Props = {
  filters: AnimeFilters;
  onChange: (next: Partial<AnimeFilters>) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onOpenSettings: () => void;
  resultCount?: number;
  /** When any browse filter is active, surface a quick "Clear" affordance. */
  onClear?: () => void;
  filtersActive?: boolean;
};

export default function AnimeToolbar({
  filters,
  onChange,
  focusMode,
  onToggleFocus,
  onOpenSettings,
  resultCount,
  onClear,
  filtersActive,
}: Props) {
  return (
    <div className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-xl border-b border-white/5">
      <div className="px-3 md:px-5 py-2.5 flex flex-wrap items-center gap-2">
        {/* Type segmented control */}
        <div className="inline-flex items-center h-9 bg-white/[0.04] border border-white/10 rounded-lg p-0.5 text-[12.5px]">
          {TYPE_TABS.map((t) => {
            const Icon = t.icon;
            const active = filters.type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange({ type: t.value })}
                className={clsx(
                  "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors",
                  active
                    ? "bg-white/[0.12] text-white"
                    : "text-neutral-400 hover:text-white",
                )}
                aria-pressed={active}
              >
                <Icon size={13} />
                <span className="hidden xs:inline sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Genre is picked from the "Browse by genre" card row on the home
            view (see AnimePage), not a toolbar dropdown. */}

        {/* Sort picker */}
        <Combobox
          value={filters.sort}
          onChange={(v) => onChange({ sort: (v as AnimeSort) ?? "featured" })}
          placeholder="Featured"
          searchable={false}
          clearable={false}
          className="min-w-[150px]"
          leadingIcon={<ArrowDownUp size={13} />}
          options={ANIME_SORTS}
        />

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[420px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search anime…"
            // h-9 + !pl-9 / !pr-9 / !py-0: match the Combobox trigger height and
            // override globals.css `input { padding: 0.6rem 0.85rem }`.
            className="w-full !h-9 !pl-9 !pr-9 !py-0 text-[12.5px] bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400/40 placeholder:text-neutral-500"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onChange({ search: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded text-neutral-500 hover:text-white hover:bg-white/10"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

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
          title="Anime settings"
          aria-label="Anime settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
