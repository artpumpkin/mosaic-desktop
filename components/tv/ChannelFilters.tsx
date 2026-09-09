"use client";
import { useMemo } from "react";
import { Search, X } from "lucide-react";
import Combobox, { type ComboboxOption } from "@/components/Combobox";
import type { TvCategory, TvCountry } from "@/lib/tv/types";
import type { TvFilters } from "./TopToolbar";

type Props = {
  filters: TvFilters;
  onChange: (next: Partial<TvFilters>) => void;
  countries: TvCountry[];
  categories: TvCategory[];
  /** Noun for the search placeholder — "channels" (TV) or "stations" (radio). */
  searchNoun?: string;
};

/**
 * Compact search + country + genre filters that live at the top of the channel
 * browse pane (the "A" column) instead of the page toolbar — they sit right
 * above the list they filter, which reads cleaner and frees the top bar.
 * Countries are multi-select; genre is single-select.
 */
export default function ChannelFilters({
  filters,
  onChange,
  countries,
  categories,
  searchNoun = "channels",
}: Props) {
  const countryOptions = useMemo<ComboboxOption[]>(
    () =>
      countries.map((c) => ({
        value: c.code,
        label: c.name,
        prefix: c.flag,
        hint: c.code,
      })),
    [countries],
  );
  const genreOptions = useMemo<ComboboxOption[]>(
    () => categories.map((c) => ({ value: c.id, label: c.name })),
    [categories],
  );

  return (
    <div className="shrink-0 p-2 border-b border-white/5 space-y-2 bg-[var(--background)]/95">
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500">
          <Search size={14} />
        </span>
        <input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder={`Search ${searchNoun}…`}
          className="w-full h-8 bg-white/[0.04] border border-white/10 rounded-lg !pl-8 !pr-7 !py-0 text-[12.5px] placeholder:text-neutral-600 focus:outline-none focus:bg-white/[0.06] focus:border-white/20 transition-colors"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => onChange({ search: "" })}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-neutral-500 hover:text-white hover:bg-white/10"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Combobox
          multiple
          multiLabel="countries"
          values={filters.countries}
          onValuesChange={(v) => onChange({ countries: v })}
          options={countryOptions}
          placeholder="All countries"
          className="flex-1 min-w-0"
        />
        <Combobox
          value={filters.genre}
          onChange={(v) => onChange({ genre: v })}
          options={genreOptions}
          placeholder="All genres"
          className="flex-1 min-w-0"
        />
      </div>
    </div>
  );
}
