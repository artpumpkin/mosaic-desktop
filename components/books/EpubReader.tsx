"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  BookOpen,
  Square,
  ScrollText,
} from "lucide-react";
import clsx from "clsx";
import { readFile } from "@tauri-apps/plugin-fs";
import type { BookReadProgress } from "@/lib/books/types";
import { saveBookProgress, throttledSaver } from "@/lib/books/progress";
import { logger } from "@/lib/logger";

const FONT_KEY = "mosaic.books.reader.fontSize";
const MODE_KEY = "mosaic.books.reader.mode";

// View modes. epub.js renders these via different flow/spread/manager options:
//   • page   — one page at a time, horizontal page turns (single column).
//   • book   — two-page spread side by side, like an open paperback.
//   • scroll — continuous vertical scroll (one long column).
// True page-curl isn't possible on reflowable EPUB content; "book" spread is
// the closest to the iPad/iBooks open-book feel.
type ViewMode = "page" | "book" | "scroll";

const MODES: { id: ViewMode; label: string; icon: typeof Square }[] = [
  { id: "page", label: "Single page", icon: Square },
  { id: "book", label: "Two-page (book)", icon: BookOpen },
  { id: "scroll", label: "Vertical scroll", icon: ScrollText },
];

// epub.js renderTo options per mode.
function renderOptions(mode: ViewMode): Record<string, unknown> {
  const base = { width: "100%", height: "100%", allowScriptedContent: false };
  if (mode === "scroll") {
    return { ...base, flow: "scrolled", manager: "continuous" };
  }
  return {
    ...base,
    flow: "paginated",
    spread: mode === "book" ? "auto" : "none",
  };
}

// Base reader theme (colours + spacing). Font size is applied separately via
// rendition.themes.fontSize() so zooming doesn't wipe these rules.
const BASE_THEME: Record<string, Record<string, string>> = {
  body: {
    color: "#e5e5e5 !important",
    background: "#0a0a0a !important",
    "line-height": "1.55 !important",
    // Outer margins come from container padding; keep the body flush so epub.js
    // paginates to the full inset height (no clipped first/last line).
    margin: "0 !important",
    padding: "0 !important",
    "-webkit-hyphens": "auto",
    hyphens: "auto",
  },
  // Zoom: epub.js's themes.fontSize() only resizes the root element, so books
  // that hard-code px/pt sizes on their text don't scale. Forcing prose tags to
  // inherit makes the font-size control actually resize the body text.
  "p, li, td, th, blockquote, dd, dt, span": {
    "font-size": "inherit !important",
    "line-height": "inherit !important",
  },
  // Keep images within the page box so full-page illustrations aren't cropped.
  img: {
    "max-width": "100% !important",
    "max-height": "100% !important",
    height: "auto !important",
    "object-fit": "contain",
  },
  p: { "text-align": "justify" },
  a: { color: "#7dd3fc !important" },
};

// Readable column width per mode (px). epub.js sizes the page to its host
// element, so we cap + centre the host to get a book-like measure instead of
// text running the full window width (worst in scroll mode).
const MODE_MAX_WIDTH: Record<ViewMode, number> = {
  page: 760,
  book: 1180,
  scroll: 760,
};

type Rendition = {
  display: (target?: string) => Promise<void>;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  destroy?: () => void;
  themes: {
    default: (rules: Record<string, Record<string, string>>) => void;
    fontSize: (size: string) => void;
  };
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
};

type Props = {
  path: string;
  title: string;
  cover?: string | null;
  progressKey: string;
  initialCfi?: string;
  onClose: () => void;
  onProgress: (p: BookReadProgress) => void;
};

export default function EpubReader({
  path,
  title,
  cover,
  progressKey,
  initialCfi,
  onClose,
  onProgress,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saver = useRef(throttledSaver(3000));
  // Latest progress, flushed on close/unmount so a final position isn't lost
  // inside the throttle window.
  const latestProgress = useRef<BookReadProgress | null>(null);
  // Current location, so we can restore it when the rendition is rebuilt on a
  // view-mode change. Seeded with the resume point.
  const currentCfi = useRef<string | undefined>(initialCfi);
  const locationsReady = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const v = localStorage.getItem(FONT_KEY);
      return v ? Math.min(180, Math.max(70, parseInt(v, 10))) : 100;
    } catch {
      return 100;
    }
  });
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY);
      return v === "book" || v === "scroll" ? v : "page";
    } catch {
      return "page";
    }
  });
  const [fraction, setFraction] = useState(0);

  const persistProgress = useCallback(
    (cfi: string, frac: number) => {
      const p: BookReadProgress = {
        key: progressKey,
        title,
        cover: cover ?? null,
        path,
        locationCfi: cfi,
        fraction: frac,
        updatedAt: Date.now(),
      };
      latestProgress.current = p;
      // EpubReader owns persistence (throttled); the parent's onProgress only
      // refreshes UI state, so we don't double-write localStorage per page turn.
      saver.current(p);
      onProgress(p);
    },
    [progressKey, title, cover, path, onProgress],
  );
  // The rendition effect must NOT depend on persistProgress (it changes every
  // render because the parent passes a fresh onProgress), or the rendition
  // rebuilds in a loop and the reader flashes forever. Call it via a ref.
  const persistRef = useRef(persistProgress);
  persistRef.current = persistProgress;

  // --- Load + render the book. Re-runs on path or view-mode change. Kept as a
  // SINGLE effect (not split) so the rendition always renders the freshly
  // awaited book within one scope — a split load/render races against
  // StrictMode/HMR cleanup and crashes epub.js with `this.book.package`
  // undefined when it renders a book the other effect already destroyed.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    let book: { destroy?: () => void } | null = null;
    let rendition: Rendition | null = null;

    // epub.js only parses EPUB; a PDF/MOBI/etc. makes book.ready hang forever.
    if (!path.toLowerCase().endsWith(".epub")) {
      setError("This format can't be read in-app. Open it with an external app.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        logger.info("books/reader", "open", { path, mode });
        const data = await readFile(path);
        logger.info("books/reader", "readFile ok", { path, bytes: data.byteLength });
        const buf = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const ePub = (await import("epubjs")).default;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = ePub(buf);
        book = b;
        bookRef.current = b;
        await b.ready;
        const host = hostRef.current;
        if (cancelled || !host) return;

        rendition = b.renderTo(host, renderOptions(mode)) as Rendition;
        renditionRef.current = rendition;
        rendition.themes.default(BASE_THEME);
        rendition.themes.fontSize(`${fontSize}%`);

        b.locations
          .generate(1600)
          .then(() => {
            locationsReady.current = true;
          })
          .catch(() => {
            /* percentage fallback unavailable */
          });

        rendition.on("relocated", (...args: unknown[]) => {
          const loc = args[0] as { start?: { cfi?: string } };
          const cfi = loc?.start?.cfi;
          if (!cfi) return;
          currentCfi.current = cfi;
          let frac = 0;
          if (locationsReady.current) {
            const pct = b.locations.percentageFromCfi(cfi);
            frac = typeof pct === "number" ? pct : 0;
          }
          setFraction(frac);
          persistRef.current(cfi, frac);
        });

        await rendition.display(currentCfi.current);
        if (!cancelled) setLoading(false);
      } catch (e) {
        logger.error("books/reader", "open failed", {
          path,
          err: e instanceof Error ? e.message : String(e),
        });
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to open EPUB");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (latestProgress.current) saveBookProgress(latestProgress.current);
      rendition?.destroy?.();
      book?.destroy?.();
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontSize/persist via refs; reload on path or mode change
  }, [path, mode]);

  // --- Zoom: apply font size to the live rendition without rebuilding it ---
  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {
      /* ignore */
    }
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "ArrowRight") renditionRef.current?.next();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const atFontMin = fontSize <= 70;
  const atFontMax = fontSize >= 180;

  return (
    <div className="fixed inset-0 z-[1100] bg-neutral-950 flex flex-col">
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/80 backdrop-blur">
        <button
          type="button"
          onClick={onClose}
          className="grid place-items-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
          aria-label="Close reader"
        >
          <X size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-white truncate">{title}</p>
          <p className="text-[10px] text-neutral-500 tabular-nums">
            {Math.round(fraction * 100)}% read
          </p>
        </div>

        {/* View mode */}
        <div className="inline-flex bg-white/5 border border-white/10 rounded-lg p-0.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={on}
                title={m.label}
                className={clsx(
                  "grid place-items-center w-8 h-8 rounded-md transition-colors",
                  on ? "bg-white/15 text-white" : "text-neutral-400 hover:text-white",
                )}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.max(70, f - 10))}
            disabled={atFontMin}
            className="grid place-items-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10 disabled:opacity-40"
            aria-label="Smaller text"
          >
            <Minus size={14} />
          </button>
          <span className="text-[11px] text-neutral-500 w-10 text-center tabular-nums">
            {fontSize}%
          </span>
          <button
            type="button"
            onClick={() => setFontSize((f) => Math.min(180, f + 10))}
            disabled={atFontMax}
            className="grid place-items-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10 disabled:opacity-40"
            aria-label="Larger text"
          >
            <Plus size={14} />
          </button>
        </div>

        {mode !== "scroll" && (
          <>
            <button
              type="button"
              onClick={() => renditionRef.current?.prev()}
              className="grid place-items-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => renditionRef.current?.next()}
              className="grid place-items-center w-9 h-9 rounded-lg border border-white/10 bg-white/5 text-neutral-200 hover:bg-white/10"
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </header>

      {/* Inset the render host so the page has margins and the first/last lines
          aren't clipped against the header or window edge. */}
      <div className="relative flex-1 min-h-0 px-6 md:px-10 py-4 md:py-6">
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-neutral-950 z-10">
            <Loader2 size={28} className="animate-spin text-sky-400" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <BookOpen size={32} className="text-neutral-600 mb-3" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}
        <div
          className="mx-auto h-full"
          style={{ maxWidth: MODE_MAX_WIDTH[mode], width: "100%" }}
        >
          <div ref={hostRef} className={clsx("w-full h-full", loading && "opacity-0")} />
        </div>
      </div>
    </div>
  );
}
