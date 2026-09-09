"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

/**
 * Full-page responsive grid shared by the "See all" / browse views. Supports
 * two modes that the old CatalogGridView (Movies/Anime) and MangaGridView
 * needed:
 *
 *  - infinite scroll: pass `onLoadMore` + `hasMore` + `loadingMore`. A sentinel
 *    near the bottom triggers the next page (scroll/resize listener rather than
 *    IntersectionObserver, which misfires in some embedded webviews).
 *  - simple grid: omit the load-more props and pass `loading` for a spinner.
 *
 * Cards come from a render prop so each section keeps its typed item.
 */
type MediaGridViewProps<T> = {
  title: string;
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onBack?: () => void;
  /** Sticky header that clears a top-0 toolbar (Movies/Anime "See all"). */
  sticky?: boolean;
  /** Minimum card column width in px. Defaults to 150. */
  minColWidth?: number;
  /** Simple-mode loading spinner in the header. */
  loading?: boolean;
  /** Empty-state copy when there are no items and not loading. */
  emptyLabel?: string;
  // Infinite-scroll plumbing (optional).
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export default function MediaGridView<T>({
  title,
  items,
  getKey,
  renderItem,
  onBack,
  sticky,
  minColWidth = 150,
  loading,
  emptyLabel = "No results.",
  hasMore,
  loadingMore,
  onLoadMore,
}: MediaGridViewProps<T>) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  const infinite = !!onLoadMore;

  // Auto-fetch the next page when the sentinel is within ~600px of the
  // viewport. Scroll/resize listener instead of IntersectionObserver because
  // the latter doesn't fire reliably in embedded webviews during fast scrolls.
  useEffect(() => {
    if (!infinite || !hasMore) return;
    const check = () => {
      const el = sentinelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 600) {
        onLoadMoreRef.current?.();
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true, capture: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("resize", check);
    };
  }, [infinite, hasMore, items.length, loadingMore]);

  return (
    <section className="space-y-4">
      <header
        className={
          sticky
            ? "sticky top-[57px] z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-2.5 bg-[var(--background)]/90 backdrop-blur-md border-b border-white/5 flex items-center gap-3"
            : "flex items-center gap-3 px-1"
        }
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={
              sticky
                ? "inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-neutral-300 hover:bg-white/10 hover:text-white text-[12px]"
                : "grid place-items-center w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300"
            }
            aria-label="Back"
          >
            <ArrowLeft size={sticky ? 13 : 15} />
            {sticky && "Back"}
          </button>
        )}
        <h2
          className={
            sticky
              ? "text-lg font-bold tracking-[-0.01em] text-neutral-100"
              : "text-[17px] md:text-lg font-bold tracking-[-0.01em] text-neutral-100"
          }
        >
          {title}
        </h2>
        {sticky ? (
          <span className="text-[11.5px] text-neutral-500">
            {items.length.toLocaleString()}
          </span>
        ) : (
          loading && <Loader2 size={14} className="animate-spin text-neutral-400" />
        )}
      </header>

      {items.length === 0 && !loading && !loadingMore ? (
        <div className="text-sm text-neutral-500 px-1 py-8 text-center">
          {emptyLabel}
        </div>
      ) : (
        <div
          className="grid gap-5 md:gap-6"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`,
          }}
        >
          {items.map((item) => (
            <div key={getKey(item)} className="contents">
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}

      {infinite && (
        <>
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-4 text-neutral-400 text-[12px]">
              <Loader2 size={14} className="animate-spin" />
              Loading more…
            </div>
          )}
          {!hasMore && items.length > 0 && (
            <div className="text-center text-[11.5px] text-neutral-500 py-4">
              End of catalog.
            </div>
          )}
        </>
      )}
    </section>
  );
}
