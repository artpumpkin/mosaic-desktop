"use client";
import {
  Compass,
  Library,
  Search,
  Maximize2,
  Minimize2,
  X,
  ArrowDownUp,
  Settings,
  Bug,
} from "lucide-react";
import clsx from "clsx";
import Combobox from "@/components/Combobox";
import { BOOK_GENRES, BOOK_SORTS, type BookSort } from "@/lib/books/openlibrary";

export type BookTab = "discover" | "library";

export type BookFilters = {
  tab: BookTab;
  genre: string | null;
  sort: BookSort;
  search: string;
};

export const DEFAULT_BOOK_FILTERS: BookFilters = {
  tab: "discover",
  genre: null,
  sort: "featured",
  search: "",
};

const TAB_OPTIONS: { value: BookTab; label: string; icon: typeof Compass }[] = [
  { value: "discover", label: "Discover", icon: Compass },
  { value: "library", label: "My Library", icon: Library },
];

type Props = {
  filters: BookFilters;
  onChange: (next: Partial<BookFilters>) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onOpenSettings: () => void;
  onCopyLogs?: () => void;
  resultCount?: number;
  onClear?: () => void;
  filtersActive?: boolean;
};

export default function BookToolbar({
  filters,
  onChange,
  focusMode,
  onToggleFocus,
  onOpenSettings,
  onCopyLogs,
  resultCount,
  onClear,
  filtersActive,
}: Props) {
  return (
    <div className="sticky top-0 z-30 bg-[var(--background)]/85 backdrop-blur-xl border-b border-white/5">
      <div className="px-3 md:px-5 py-2.5 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center h-9 bg-white/[0.04] border border-white/10 rounded-lg p-0.5 text-[12.5px]">
          {TAB_OPTIONS.map((t) => {
            const Icon = t.icon;
            const active = filters.tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange({ tab: t.value })}
                className={clsx(
                  "px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors",
                  active
                    ? "bg-white/[0.12] text-white"
                    : "text-neutral-400 hover:text-white",
                )}
                aria-pressed={active}
              >
                <Icon size={13} />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            );
          })}
        </div>

        {filters.tab === "discover" && (
          <>
            <Combobox
              value={filters.genre}
              onChange={(v) => onChange({ genre: v })}
              placeholder="All genres"
              className="min-w-[140px]"
              options={BOOK_GENRES.map((g) => ({ value: g.slug, label: g.label }))}
            />

            <Combobox
              value={filters.sort}
              onChange={(v) => onChange({ sort: (v as BookSort) ?? "featured" })}
              placeholder="Featured"
              searchable={false}
              clearable={false}
              className="min-w-[150px]"
              leadingIcon={<ArrowDownUp size={13} />}
              options={BOOK_SORTS}
            />
          </>
        )}

        <div className="relative flex-1 min-w-[180px] max-w-[420px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={
              filters.tab === "library" ? "Search your library…" : "Search books…"
            }
            className="w-full !h-9 !pl-9 !pr-9 !py-0 text-[12.5px] bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-400/30 focus:border-sky-400/40 placeholder:text-neutral-500"
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
            {resultCount.toLocaleString()} {resultCount === 1 ? "book" : "books"}
          </span>
        )}

        <button
          type="button"
          onClick={onToggleFocus}
          className={clsx(
            "p-1.5 rounded-lg border transition-colors",
            focusMode
              ? "bg-sky-500/20 border-sky-400/40 text-sky-100"
              : "bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10",
          )}
          title={focusMode ? "Exit focus mode" : "Focus mode"}
          aria-pressed={focusMode}
        >
          {focusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {onCopyLogs && (
          <button
            type="button"
            onClick={onCopyLogs}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 text-[11px] text-amber-200 hover:bg-amber-500/25 transition-colors"
            title="Copy Books debug logs"
            aria-label="Copy debug logs"
          >
            <Bug size={13} />
            Logs
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg border bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10 transition-colors"
          title="Books settings"
          aria-label="Books settings"
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
