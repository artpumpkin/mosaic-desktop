"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Book,
  Rows3,
  Columns2,
  Square,
  Gauge,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { getConnectorFor } from "@/lib/manga/connectors";
import { seriesKey } from "@/lib/manga/types";
import type {
  MangaSource,
  Manga,
  Chapter,
  ReaderPage,
  MangaReadProgress,
} from "@/lib/manga/types";

type ReadMode = "rtl" | "ltr" | "vertical";

const MODE_KEY = "mosaic.manga.reader.mode";
const SAVER_KEY = "mosaic.manga.reader.datasaver";
const SPREAD_KEY = "mosaic.manga.reader.spread";

type Props = {
  source: MangaSource;
  manga: Manga;
  chapters: Chapter[]; // ascending order
  initialChapterId: string;
  initialPageIndex?: number;
  onClose: () => void;
  onProgress: (p: MangaReadProgress) => void;
  onChapterRead: (chapterId: string) => void;
};

export default function Reader({
  source,
  manga,
  chapters,
  initialChapterId,
  initialPageIndex = 0,
  onClose,
  onProgress,
  onChapterRead,
}: Props) {
  const [chapterId, setChapterId] = useState(initialChapterId);
  const [pages, setPages] = useState<ReaderPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(initialPageIndex);

  const [mode, setMode] = useState<ReadMode>("rtl");
  const [dataSaver, setDataSaver] = useState(false);
  const [chrome, setChrome] = useState(true);
  // Book spread (two pages side-by-side) for paged modes on wide screens.
  const [spread, setSpread] = useState(true);
  const [wide, setWide] = useState(true);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const imgRefs = useRef<(HTMLImageElement | null)[]>([]);
  // When navigating to the *previous* chapter we want to land on its last page.
  const jumpToLastRef = useRef(false);
  const chromeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chapterIdx = useMemo(
    () => chapters.findIndex((c) => c.id === chapterId),
    [chapters, chapterId],
  );
  const chapter = chapterIdx >= 0 ? chapters[chapterIdx] : null;
  const hasPrev = chapterIdx > 0;
  const hasNext = chapterIdx >= 0 && chapterIdx < chapters.length - 1;

  // Hydrate persisted reader prefs.
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "rtl" || m === "ltr" || m === "vertical") setMode(m);
      setDataSaver(localStorage.getItem(SAVER_KEY) === "1");
      setSpread(localStorage.getItem(SPREAD_KEY) !== "0");
    } catch {
      /* ignore */
    }
  }, []);

  // Track viewport width so the two-page spread only kicks in when there's
  // room for it.
  useEffect(() => {
    const update = () => setWide(window.innerWidth >= 1024);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const toggleSpread = useCallback(() => {
    setSpread((v) => {
      const next = !v;
      try {
        localStorage.setItem(SPREAD_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cycleMode = useCallback(() => {
    setMode((prev) => {
      const next: ReadMode =
        prev === "rtl" ? "ltr" : prev === "ltr" ? "vertical" : "rtl";
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleSaver = useCallback(() => {
    setDataSaver((v) => {
      const next = !v;
      try {
        localStorage.setItem(SAVER_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Load pages whenever the chapter changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    (async () => {
      try {
        const result = await getConnectorFor(source).getPages(source, chapterId);
        if (cancelled) return;
        setPages(result);
        const target = jumpToLastRef.current
          ? Math.max(0, result.length - 1)
          : initialChapterId === chapterId
            ? Math.min(initialPageIndex, Math.max(0, result.length - 1))
            : 0;
        jumpToLastRef.current = false;
        setPageIndex(target);
        // Scroll vertical mode to the right place after paint.
        requestAnimationFrame(() => {
          const el = imgRefs.current[target];
          if (el && scrollerRef.current) el.scrollIntoView({ block: "start" });
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load pages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, source]);

  // Report progress on page / chapter change; mark read at the last page.
  useEffect(() => {
    if (loading || pages.length === 0 || !chapter) return;
    onProgress({
      key: seriesKey(source.id, manga.id),
      sourceId: source.id,
      mangaId: manga.id,
      chapterId,
      chapterNumber: chapter.number,
      pageIndex,
      pageCount: pages.length,
      updatedAt: Date.now(),
      title: manga.title,
      cover: manga.cover ?? null,
    });
    if (pageIndex >= pages.length - 1) onChapterRead(chapterId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, chapterId, loading, pages.length]);

  // Preload the next couple of page images.
  useEffect(() => {
    if (!pages.length) return;
    for (let i = pageIndex + 1; i <= pageIndex + 2 && i < pages.length; i++) {
      const p = pages[i];
      const img = new Image();
      img.src = dataSaver ? p.urlDataSaver ?? p.url : p.url;
    }
  }, [pageIndex, pages, dataSaver]);

  const goPrevChapter = useCallback(
    (toLast = false) => {
      if (!hasPrev) return;
      jumpToLastRef.current = toLast;
      setChapterId(chapters[chapterIdx - 1].id);
    },
    [hasPrev, chapters, chapterIdx],
  );
  const goNextChapter = useCallback(() => {
    if (!hasNext) return;
    setChapterId(chapters[chapterIdx + 1].id);
  }, [hasNext, chapters, chapterIdx]);

  // Two pages at once only when enabled, screen is wide, and we're paged.
  const useSpread = spread && wide && mode !== "vertical";
  const step = useSpread ? 2 : 1;

  const nextPage = useCallback(() => {
    setPageIndex((i) => {
      const lastVisible = useSpread ? Math.min(i + 1, pages.length - 1) : i;
      if (lastVisible >= pages.length - 1) {
        if (hasNext) goNextChapter();
        return i;
      }
      return Math.min(i + step, pages.length - 1);
    });
  }, [pages.length, hasNext, goNextChapter, useSpread, step]);

  const prevPage = useCallback(() => {
    setPageIndex((i) => {
      if (i <= 0) {
        if (hasPrev) goPrevChapter(true);
        return i;
      }
      return Math.max(0, i - step);
    });
  }, [hasPrev, goPrevChapter, step]);

  // Vertical mode tracks the most-visible page via IntersectionObserver.
  useEffect(() => {
    if (mode !== "vertical" || !pages.length) return;
    const root = scrollerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        let best = -1;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            best = Number((e.target as HTMLElement).dataset.idx);
          }
        }
        if (best >= 0) setPageIndex(best);
      },
      { root, threshold: [0.25, 0.5, 0.75] },
    );
    imgRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [mode, pages]);

  const showChrome = useCallback(() => {
    setChrome(true);
    if (chromeTimer.current) clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => setChrome(false), 2500);
  }, []);
  useEffect(() => {
    showChrome();
    return () => {
      if (chromeTimer.current) clearTimeout(chromeTimer.current);
    };
  }, [showChrome]);

  // Keyboard navigation.
  useEffect(() => {
    const isRtl = mode === "rtl";
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (mode === "vertical") return;
          if (isRtl) nextPage();
          else prevPage();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (mode === "vertical") return;
          if (isRtl) prevPage();
          else nextPage();
          break;
        case "ArrowUp":
          if (mode === "vertical") return;
          e.preventDefault();
          prevPage();
          break;
        case "ArrowDown":
          if (mode === "vertical") return;
          e.preventDefault();
          nextPage();
          break;
        case " ": {
          e.preventDefault();
          const el = scrollerRef.current;
          if (mode === "vertical" && el) {
            el.scrollBy({
              top: (e.shiftKey ? -1 : 1) * el.clientHeight * 0.9,
              behavior: "smooth",
            });
          } else if (mode !== "vertical") {
            if (e.shiftKey) prevPage();
            else nextPage();
          }
          break;
        }
        case "Home":
          e.preventDefault();
          setPageIndex(0);
          break;
        case "End":
          e.preventDefault();
          setPageIndex(Math.max(0, pages.length - 1));
          break;
        case "[":
          goPrevChapter(false);
          break;
        case "]":
          goNextChapter();
          break;
        case "m":
        case "M":
          cycleMode();
          break;
        case "d":
        case "D":
          toggleSaver();
          break;
        case "s":
        case "S":
          if (mode !== "vertical") toggleSpread();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    mode,
    nextPage,
    prevPage,
    goPrevChapter,
    goNextChapter,
    cycleMode,
    toggleSaver,
    toggleSpread,
    onClose,
    pages.length,
  ]);

  // Lock body scroll while the reader is mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const pageUrl = (p: ReaderPage) => (dataSaver ? p.urlDataSaver ?? p.url : p.url);
  const isRtl = mode === "rtl";

  // Spread page layout (screen-left / screen-right depends on reading dir).
  const pageA = pages[pageIndex];
  const pageB = useSpread ? pages[pageIndex + 1] : undefined;
  const screenLeft = useSpread ? (isRtl ? pageB : pageA) : undefined;
  const screenRight = useSpread ? (isRtl ? pageA : pageB) : undefined;

  const counter =
    pages.length === 0
      ? ""
      : useSpread && pageB
        ? `${pageIndex + 1}–${pageIndex + 2}/${pages.length}`
        : `${pageIndex + 1}/${pages.length}`;
  const animKey = `${chapterId}:${pageIndex}:${useSpread ? "s" : "1"}`;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black select-none"
      onMouseMove={showChrome}
    >
      {/* Top chrome */}
      <div
        className={clsx(
          "absolute top-0 inset-x-0 z-30 flex items-center gap-3 px-4 py-2.5",
          "bg-gradient-to-b from-black/90 to-transparent transition-opacity duration-200",
          chrome ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="grid place-items-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white"
          aria-label="Close reader"
        >
          <X size={16} />
        </button>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-white truncate">{manga.title}</div>
          <div className="text-[11px] text-neutral-400 truncate">
            {chapter
              ? `${chapter.number ? `Ch. ${chapter.number}` : "Oneshot"}${chapter.title ? ` · ${chapter.title}` : ""}`
              : ""}
            {counter && ` · ${counter}`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={cycleMode}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-2.5 py-1.5 text-[11.5px] text-white"
            title="Reading mode (m)"
          >
            {mode === "vertical" ? (
              <Rows3 size={13} />
            ) : (
              <Columns2 size={13} />
            )}
            {mode === "rtl" ? "RTL" : mode === "ltr" ? "LTR" : "Scroll"}
          </button>
          {mode !== "vertical" && wide && (
            <button
              type="button"
              onClick={toggleSpread}
              className={clsx(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px]",
                spread ? "bg-amber-500/80 text-white" : "bg-white/10 text-white hover:bg-white/20",
              )}
              title="Book spread (s)"
            >
              {spread ? <Book size={13} /> : <Square size={13} />}
              {spread ? "Book" : "Single"}
            </button>
          )}
          <button
            type="button"
            onClick={toggleSaver}
            className={clsx(
              "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px]",
              dataSaver ? "bg-amber-500/80 text-white" : "bg-white/10 text-white hover:bg-white/20",
            )}
            title="Data saver (d)"
          >
            <Gauge size={13} />
            Saver
          </button>
        </div>
      </div>

      {/* Stage */}
      {loading ? (
        <div className="absolute inset-0 grid place-items-center text-neutral-400">
          <span className="flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading pages…
          </span>
        </div>
      ) : error ? (
        <div className="absolute inset-0 grid place-items-center text-neutral-300 px-8">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertTriangle size={24} className="text-amber-400" />
            <p className="text-sm">{error}</p>
          </div>
        </div>
      ) : pages.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center text-neutral-500">
          <span className="flex items-center gap-2 text-sm">
            <BookOpen size={16} /> No pages in this chapter.
          </span>
        </div>
      ) : mode === "vertical" ? (
        <div ref={scrollerRef} className="absolute inset-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-2">
            {pages.map((p, i) => (
              <img
                key={p.index}
                ref={(el) => {
                  imgRefs.current[i] = el;
                }}
                data-idx={i}
                src={pageUrl(p)}
                alt={`Page ${i + 1}`}
                className="w-full block"
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center p-2 sm:p-6">
          {/* Depth vignette behind the book */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_48%,rgba(0,0,0,0.6))]"
          />

          <div
            key={animKey}
            className="manga-page-in relative flex h-full max-h-[94vh] items-center justify-center"
          >
            {useSpread ? (
              <div className="relative flex h-full items-stretch rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/80 bg-neutral-950">
                <div className="relative h-full">
                  {screenLeft ? (
                    <img
                      src={pageUrl(screenLeft)}
                      alt=""
                      className="h-full w-auto max-w-[46vw] object-contain bg-neutral-900"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-full w-[26vw] bg-neutral-900" />
                  )}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-black/45 to-transparent"
                  />
                </div>
                {/* Binding / spine */}
                <div
                  aria-hidden
                  className="w-[3px] bg-gradient-to-r from-black/80 via-black/20 to-black/80"
                />
                <div className="relative h-full">
                  {screenRight ? (
                    <img
                      src={pageUrl(screenRight)}
                      alt=""
                      className="h-full w-auto max-w-[46vw] object-contain bg-neutral-900"
                      decoding="async"
                    />
                  ) : (
                    <div className="h-full w-[26vw] bg-neutral-900" />
                  )}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-black/45 to-transparent"
                  />
                </div>
              </div>
            ) : (
              <div className="relative h-full rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/80">
                <img
                  src={pageUrl(pageA)}
                  alt={`Page ${pageIndex + 1}`}
                  className="h-full w-auto max-w-[94vw] object-contain bg-neutral-900"
                  decoding="async"
                />
              </div>
            )}
          </div>

          {/* Tap zones (above the book, below the chrome) */}
          <button
            type="button"
            aria-label={isRtl ? "Next page" : "Previous page"}
            onClick={() => (isRtl ? nextPage() : prevPage())}
            className="absolute inset-y-0 left-0 w-1/3 z-20 cursor-pointer"
          />
          <button
            type="button"
            aria-label="Toggle controls"
            onClick={() => setChrome((v) => !v)}
            className="absolute inset-y-0 left-1/3 w-1/3 z-20 cursor-pointer"
          />
          <button
            type="button"
            aria-label={isRtl ? "Previous page" : "Next page"}
            onClick={() => (isRtl ? prevPage() : nextPage())}
            className="absolute inset-y-0 right-0 w-1/3 z-20 cursor-pointer"
          />
        </div>
      )}

      {/* Bottom chrome: progress + chapter nav */}
      <div
        className={clsx(
          "absolute bottom-0 inset-x-0 z-30 px-4 py-3",
          "bg-gradient-to-t from-black/90 to-transparent transition-opacity duration-200",
          chrome ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => goPrevChapter(false)}
            disabled={!hasPrev}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 px-2.5 py-1.5 text-[11.5px] text-white"
          >
            <ChevronLeft size={13} /> Prev ch.
          </button>
          <div className="flex-1 h-1 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-violet-400 transition-[width]"
              style={{
                width: `${pages.length ? ((pageIndex + 1) / pages.length) * 100 : 0}%`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={goNextChapter}
            disabled={!hasNext}
            className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 px-2.5 py-1.5 text-[11.5px] text-white"
          >
            Next ch. <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
