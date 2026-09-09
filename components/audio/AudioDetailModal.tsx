"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  ListMusic,
  Rows3,
  List,
  LayoutGrid,
  Play,
  Pause,
  Heart,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";

import TrackList, { type TrackRow } from "@/components/audio/TrackList";

// The shared audio detail modal — a centered portal overlay opened when the
// user picks a podcast show, an album, an artist or a playlist. Same surface
// for all three Audio tabs: header (art + title + subtitle + meta + an optional
// action button), a fixed band with description + search + three layout modes
// (+ an optional date sort), a scrolling row list and a pinned pagination
// footer. The audio analogue of Anime's TitleDetail overlay.
export type ModalRow = TrackRow & {
  /** Raw published epoch (ms) for the date sort; null sinks to the bottom. */
  publishedAt?: number | null;
};

type Header = {
  title: string;
  subtitle: string | null;
  image: string | null;
  /** Secondary meta line (e.g. "12 episodes · Latest 3/1/2025"). */
  meta?: string | null;
  description?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  header: Header | null;
  /** Icon shown when art is missing (header + grid/compact rows). */
  fallbackIcon: ReactNode;
  /** Trailing header control (Subscribe / Follow / Play all). */
  action?: ReactNode;
  loading?: boolean;
  rows: ModalRow[];
  kind: "podcast" | "music";
  /** Heading above the row list ("Episodes" / "Tracks"). */
  listTitle: string;
  searchPlaceholder?: string;
  /** Show the newest/oldest date sort toggle (needs `publishedAt`). */
  dateSort?: boolean;
  /** Keep the favorite heart visible at rest. */
  favoritesAlwaysVisible?: boolean;
  /** localStorage key for view-mode persistence (per tab). */
  viewKey: string;
  /** Stable identity for the open item; changing it resets search/sort/page.
      Defaults to the header title. */
  resetKey?: string | null;
};

type SortDir = "newest" | "oldest";
type ViewMode = "list" | "compact" | "grid";

const PAGE_SIZE = 10;
const VIEWS: { id: ViewMode; icon: typeof Rows3; label: string }[] = [
  { id: "list", icon: Rows3, label: "List" },
  { id: "compact", icon: List, label: "Compact" },
  { id: "grid", icon: LayoutGrid, label: "Grid" },
];

// The favorite (heart) toggle — always visible so the affordance is obvious.
function HeartButton({ row, floating = false }: { row: ModalRow; floating?: boolean }) {
  if (!row.onToggleFavorite) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        row.onToggleFavorite?.();
      }}
      aria-label={row.favorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={row.favorite}
      className={clsx(
        "grid place-items-center rounded-lg transition-colors",
        floating
          ? "absolute right-1.5 top-1.5 z-10 w-7 h-7 backdrop-blur"
          : "shrink-0 w-8 h-8",
        row.favorite
          ? floating
            ? "bg-rose-500/90 text-white"
            : "text-rose-400 hover:text-rose-300"
          : floating
            ? "bg-black/50 text-white/85 hover:bg-black/70"
            : "text-neutral-400 hover:text-neutral-200",
      )}
    >
      <Heart size={floating ? 14 : 15} fill={row.favorite ? "currentColor" : "none"} />
    </button>
  );
}

// Build a compact page-number sequence with ellipses: 1 … 4 5 [6] 7 8 … 20.
function pageSequence(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}

// Animated placeholder rows shown while the row list loads.
function RowSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/5"
        >
          <div className="w-10 h-10 rounded-lg bg-white/[0.06] animate-pulse shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div
              className="h-3 rounded bg-white/[0.06] animate-pulse"
              style={{ width: `${70 - (i % 4) * 12}%` }}
            />
            <div className="h-2.5 w-1/3 rounded bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AudioDetailModal({
  open,
  onClose,
  header,
  fallbackIcon,
  action,
  loading = false,
  rows,
  kind,
  listTitle,
  searchPlaceholder = "Search…",
  dateSort = false,
  favoritesAlwaysVisible = false,
  viewKey,
  resetKey,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortDir>("newest");
  const [view, setView] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);

  useEffect(() => setMounted(true), []);

  // Restore the persisted layout once.
  useEffect(() => {
    try {
      const v = localStorage.getItem(viewKey) as ViewMode | null;
      if (v === "list" || v === "compact" || v === "grid") setView(v);
    } catch {
      /* ignore */
    }
  }, [viewKey]);

  const pickView = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem(viewKey, v);
    } catch {
      /* ignore */
    }
  };

  // Reset the search/sort/page when a different item opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSort("newest");
      setPage(1);
    }
  }, [open, resetKey ?? header?.title]);

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [query, sort]);

  // Escape closes; lock body scroll while open (mirrors the Anime detail modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows.slice();
    if (dateSort) {
      list.sort((a, b) => {
        const av = a.publishedAt ?? -Infinity;
        const bv = b.publishedAt ?? -Infinity;
        return sort === "newest" ? bv - av : av - bv;
      });
    }
    return list;
  }, [rows, query, sort, dateSort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  // The row scroll container — reset to top whenever the page changes.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollEl?.scrollTo({ top: 0 });
  }, [safePage, view, scrollEl]);

  if (!mounted || !open) return null;

  const title = header?.title ?? "Loading…";
  const subtitle = header?.subtitle ?? null;
  const image = header?.image ?? null;
  const meta = header?.meta ?? null;
  const description = header?.description ?? null;

  const goto = (p: number) => setPage(Math.min(pageCount, Math.max(1, p)));

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md grid place-items-center p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl h-[90vh] overflow-hidden rounded-2xl flex flex-col bg-[var(--background)] border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid place-items-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/10 backdrop-blur"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 p-5 md:p-6 border-b border-white/5">
          <div className="w-24 h-24 md:w-28 md:h-28 rounded-xl overflow-hidden bg-white/[0.05] border border-white/10 shrink-0 grid place-items-center text-neutral-600">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="w-full h-full object-cover" />
            ) : (
              fallbackIcon
            )}
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <h2 className="text-lg md:text-xl font-bold tracking-tight text-white line-clamp-2">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[13px] text-neutral-400 truncate">{subtitle}</p>
            )}
            {meta && <p className="mt-1 text-[11.5px] text-neutral-500">{meta}</p>}
            {action && <div className="mt-3">{action}</div>}
          </div>
        </div>

        {/* Fixed band: description + search/view/sort — stays put while the
            list below scrolls. */}
        <div className="shrink-0 px-5 md:px-6 pt-4 md:pt-5">
          {description && (
            <p className="mb-4 text-[12.5px] leading-relaxed text-neutral-400 line-clamp-3">
              {description}
            </p>
          )}

          {/* Search + view + sort controls — all h-9 so they align. */}
          {rows.length > 0 && (
            <div className="flex items-center gap-2 pb-3">
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full !h-9 !pl-9 !pr-3 !py-0 rounded-lg bg-white/[0.04] border border-white/10 text-[12.5px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-white/25"
                />
              </div>

              {/* Layout switcher (3 views) */}
              <div className="flex items-center h-9 gap-0.5 px-1 rounded-lg bg-white/[0.04] border border-white/10">
                {VIEWS.map((v) => {
                  const Icon = v.icon;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickView(v.id)}
                      aria-pressed={view === v.id}
                      title={`${v.label} view`}
                      className={clsx(
                        "grid place-items-center w-7 h-7 rounded-md transition-colors",
                        view === v.id
                          ? "bg-white/15 text-white"
                          : "text-neutral-400 hover:text-neutral-200",
                      )}
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
              </div>

              {dateSort && (
                <button
                  type="button"
                  onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
                  className="inline-flex items-center h-9 gap-1.5 px-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-[12px] text-neutral-300 hover:bg-white/[0.08]"
                  title={sort === "newest" ? "Newest first" : "Oldest first"}
                >
                  {sort === "newest" ? (
                    <ArrowDownWideNarrow size={14} />
                  ) : (
                    <ArrowUpWideNarrow size={14} />
                  )}
                  {sort === "newest" ? "Newest" : "Oldest"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Rows (scrolls) */}
        <div
          ref={setScrollEl}
          className="flex-1 min-h-0 overflow-y-auto px-5 md:px-6 pb-5 md:pb-6"
        >
          {loading && rows.length === 0 ? (
            <RowSkeleton />
          ) : filtered.length === 0 && query ? (
            <div className="flex flex-col items-center gap-2 py-10 text-neutral-500 text-[13px]">
              <ListMusic size={22} />
              No results match “{query.trim()}”.
            </div>
          ) : view === "list" ? (
            <TrackList
              title={listTitle}
              rows={pageItems}
              kind={kind}
              favoritesAlwaysVisible={favoritesAlwaysVisible}
            />
          ) : view === "compact" ? (
            <section>
              <h2 className="text-sm font-semibold tracking-tight text-neutral-100 mb-2 px-1">
                {listTitle}
              </h2>
              <div className="divide-y divide-white/5">
                {pageItems.map((row) => (
                  <div
                    key={row.id}
                    className={clsx(
                      "group/track flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors",
                      row.active ? "bg-rose-500/15" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={row.onPlay}
                      className={clsx(
                        "shrink-0 grid place-items-center w-6 h-6 rounded transition-colors",
                        row.active ? "text-rose-300" : "text-neutral-400 hover:text-white",
                      )}
                      aria-label={`Play ${row.title}`}
                    >
                      {row.active && row.playing ? (
                        <Pause size={13} fill="currentColor" />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={row.onPlay}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span
                        className={clsx(
                          "block truncate text-[12.5px]",
                          row.active ? "text-rose-200" : "text-neutral-100",
                        )}
                      >
                        {row.title}
                      </span>
                    </button>
                    {row.meta && (
                      <span className="shrink-0 hidden sm:block text-[11px] text-neutral-500">
                        {row.meta}
                      </span>
                    )}
                    <HeartButton row={row} />
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section>
              <h2 className="text-sm font-semibold tracking-tight text-neutral-100 mb-2 px-1">
                {listTitle}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {pageItems.map((row) => (
                  <div key={row.id} className="group/track relative">
                    <button
                      type="button"
                      onClick={row.onPlay}
                      className={clsx(
                        "relative block w-full aspect-square rounded-lg overflow-hidden border bg-white/[0.04] grid place-items-center text-neutral-600",
                        row.active ? "border-rose-400/50" : "border-white/10",
                      )}
                      aria-label={`Play ${row.title}`}
                    >
                      {row.art ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.art}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        fallbackIcon
                      )}
                      <span
                        className={clsx(
                          "absolute inset-0 grid place-items-center bg-black/55 transition-opacity",
                          row.active
                            ? "opacity-100"
                            : "opacity-0 group-hover/track:opacity-100",
                        )}
                      >
                        {row.active && row.playing ? (
                          <Pause size={20} className="text-white" fill="currentColor" />
                        ) : (
                          <Play size={20} className="text-white" fill="currentColor" />
                        )}
                      </span>
                    </button>
                    <HeartButton row={row} floating />
                    <p
                      className={clsx(
                        "mt-1.5 text-[12px] leading-snug line-clamp-2",
                        row.active ? "text-rose-200" : "text-neutral-100",
                      )}
                    >
                      {row.title}
                    </p>
                    {row.meta && (
                      <p className="text-[10.5px] text-neutral-500 truncate">{row.meta}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Pagination — pinned footer so it's always reachable without
            scrolling past a full page of rows. */}
        {!loading && pageCount > 1 && (
          <div className="shrink-0 border-t border-white/5 bg-[var(--background)] px-5 md:px-6 py-3 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-neutral-500 tabular-nums hidden sm:block">
              Page {safePage} of {pageCount} · {filtered.length} items
            </span>
            <div className="flex items-center gap-1 mx-auto sm:mx-0">
              <button
                type="button"
                onClick={() => goto(safePage - 1)}
                disabled={safePage === 1}
                className="grid place-items-center w-8 h-8 rounded-lg border border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              {pageSequence(safePage, pageCount).map((p, i) =>
                p === "…" ? (
                  <span
                    key={`gap-${i}`}
                    className="grid place-items-center w-8 h-8 text-[12px] text-neutral-600"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => goto(p)}
                    aria-current={p === safePage}
                    className={clsx(
                      "grid place-items-center min-w-8 h-8 px-2 rounded-lg border text-[12px] tabular-nums transition-colors",
                      p === safePage
                        ? "bg-white/15 border-white/20 text-white"
                        : "border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]",
                    )}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => goto(safePage + 1)}
                disabled={safePage === pageCount}
                className="grid place-items-center w-8 h-8 rounded-lg border border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08] disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
