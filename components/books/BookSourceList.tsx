"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Download,
  SearchX,
  FileText,
  RefreshCw,
  Square,
  BookDown,
} from "lucide-react";
import clsx from "clsx";

import {
  searchLibgen,
  downloadLibgenBook,
  type LibgenQuery,
  type LibgenResult,
} from "@/lib/books/libgen";
import { importDownloadedBook } from "@/lib/books/library";
import type { LocalBookEntry } from "@/lib/books/types";
import { toast } from "@/lib/toast";

type Props = {
  /** Title/author/isbn to look up on Libgen. Null = nothing to search. */
  query: LibgenQuery | null;
  /** Open Library work id to link the import to (null for local-only). */
  workId?: string | null;
  /** Called after a successful download + import. `isEpub` lets the parent
   *  open the reader (epub) or hand off to the OS (other formats). */
  onImported: (entry: LocalBookEntry, isEpub: boolean) => void;
};

// EPUB first (the only format the in-app reader renders), then larger files
// (usually higher quality scans/encodes) within a format.
const FORMAT_RANK: Record<string, number> = {
  epub: 5,
  azw3: 4,
  mobi: 3,
  pdf: 2,
  fb2: 1,
};

function fmtBytes(n: number): string {
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function rankResults(rows: LibgenResult[]): LibgenResult[] {
  return [...rows].sort((a, b) => {
    const fr = (FORMAT_RANK[b.extension] ?? 0) - (FORMAT_RANK[a.extension] ?? 0);
    if (fr !== 0) return fr;
    return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  });
}

/**
 * Inline Libgen download panel — the Books equivalent of the Movies/Anime
 * StreamPicker. Lives in the detail modal's right column: instead of stream
 * seeders it lists direct ebook download links. Searches Libgen for the active
 * book, lets the user filter by format, and downloads + imports on click.
 */
export default function BookSourceList({ query, workId, onImported }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LibgenResult[]>([]);
  const [downloadingMd5, setDownloadingMd5] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    received: number;
    total: number | null;
  } | null>(null);
  const [formatFilter, setFormatFilter] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(() => {
    if (!query) {
      setLoading(false);
      setResults([]);
      setError(null);
      return () => {};
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const rows = await searchLibgen(query);
        if (cancelled) return;
        setResults(rankResults(rows));
        if (rows.length === 0)
          setError("No results found on Libgen for this title.");
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => runSearch(), [runSearch]);

  const formats = useMemo(() => {
    const s = new Set<string>();
    for (const r of results) if (r.extension !== "unknown") s.add(r.extension);
    return [...s];
  }, [results]);

  const shown = useMemo(
    () =>
      formatFilter ? results.filter((r) => r.extension === formatFilter) : results,
    [results, formatFilter],
  );

  const handleDownload = useCallback(
    async (result: LibgenResult) => {
      if (downloadingMd5) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setDownloadingMd5(result.md5);
      setProgress({ received: 0, total: result.sizeBytes });
      try {
        const { bytes, filename } = await downloadLibgenBook(
          result,
          (received, total) =>
            setProgress({ received, total: total ?? result.sizeBytes }),
          ctrl.signal,
        );
        const entry = await importDownloadedBook(bytes, filename, workId ?? null);
        const isEpub = entry.path.toLowerCase().endsWith(".epub");
        toast("ok", isEpub ? "Downloaded — opening" : "Downloaded to your library");
        onImported(entry, isEpub);
      } catch (e) {
        const aborted =
          ctrl.signal.aborted ||
          (e instanceof DOMException && e.name === "AbortError");
        if (aborted) toast("ok", "Download stopped");
        else toast("err", e instanceof Error ? e.message : "Download failed");
      } finally {
        abortRef.current = null;
        setDownloadingMd5(null);
        setProgress(null);
      }
    },
    [downloadingMd5, workId, onImported],
  );

  const stopDownload = useCallback(() => abortRef.current?.abort(), []);

  return (
    <div className="min-w-0 flex flex-col min-h-0">
      {/* Header — mirrors the anime "Streams" column, but for download links. */}
      <div className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-neutral-500 mb-2 px-1 flex items-center justify-between gap-2 shrink-0">
        <span className="inline-flex items-center gap-1.5">
          <BookDown size={12} className="text-violet-300/70" />
          Download
        </span>
        {downloadingMd5 ? (
          <button
            type="button"
            onClick={stopDownload}
            className="inline-flex items-center gap-1 px-2 h-6 rounded-md border border-rose-400/40 bg-rose-500/15 text-[10px] tracking-normal normal-case text-rose-200 hover:bg-rose-500/25"
            title="Stop download"
          >
            <Square size={9} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={runSearch}
            disabled={loading || !query}
            className="grid place-items-center w-6 h-6 rounded-md border border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10 disabled:opacity-40"
            aria-label="Search again"
            title="Search again"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        )}
      </div>

      {/* Format filter chips */}
      {formats.length > 1 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 mb-2 px-1">
          <button
            type="button"
            onClick={() => setFormatFilter(null)}
            className={clsx(
              "px-2 py-0.5 rounded-md border text-[10.5px] uppercase tracking-wide transition-colors",
              formatFilter === null
                ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
                : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
            )}
          >
            All
          </button>
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormatFilter(f)}
              className={clsx(
                "px-2 py-0.5 rounded-md border text-[10.5px] uppercase tracking-wide transition-colors",
                formatFilter === f
                  ? "bg-violet-500/20 border-violet-400/40 text-violet-100"
                  : "bg-white/5 border-white/10 text-neutral-400 hover:text-white",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {!query ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-neutral-500 text-center px-4">
            <SearchX size={24} />
            <p className="text-[12.5px]">No download sources for this book.</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-neutral-400">
            <Loader2 size={22} className="animate-spin text-violet-400" />
            <p className="text-[12.5px]">Searching Libgen…</p>
          </div>
        ) : error && shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-neutral-500 text-center px-4">
            <SearchX size={24} />
            <p className="text-[13px]">{error}</p>
            <p className="text-[11px] text-neutral-600">
              Mirrors come and go — try again, or refine the title.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {shown.map((r) => {
              const isDownloading = downloadingMd5 === r.md5;
              const disabled = !!downloadingMd5 && !isDownloading;
              const pct =
                isDownloading && progress && progress.total
                  ? Math.min(
                      100,
                      Math.round((progress.received / progress.total) * 100),
                    )
                  : null;
              return (
                <button
                  key={r.md5}
                  type="button"
                  onClick={() => handleDownload(r)}
                  disabled={disabled}
                  className={clsx(
                    "relative w-full text-left rounded-lg border px-3 py-2 transition-colors flex items-center gap-3 min-w-0 overflow-hidden",
                    isDownloading
                      ? "bg-sky-500/15 border-sky-400/40"
                      : "bg-white/[0.03] border-white/10 hover:bg-white/[0.07] hover:border-white/20",
                    disabled && "opacity-40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium text-neutral-100 truncate">
                      {r.title}
                    </div>
                    <div className="text-[10.5px] text-neutral-400 flex items-center gap-x-1.5 gap-y-0.5 mt-0.5 flex-wrap">
                      <span
                        className={clsx(
                          "inline-flex items-center gap-1 px-1 py-px rounded uppercase font-semibold tracking-wide",
                          r.extension === "epub"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : "bg-white/10 text-neutral-300",
                        )}
                      >
                        <FileText size={9} />
                        {r.extension}
                      </span>
                      {isDownloading && progress ? (
                        <span className="text-sky-200">
                          {fmtBytes(progress.received)}
                          {progress.total ? ` / ${fmtBytes(progress.total)}` : ""}
                          {pct != null ? ` · ${pct}%` : " · downloading…"}
                        </span>
                      ) : (
                        <>
                          {r.authors.length > 0 && (
                            <span className="truncate max-w-[14rem]">
                              {r.authors.slice(0, 2).join(", ")}
                            </span>
                          )}
                          {r.year && <span>· {r.year}</span>}
                          {r.language && <span>· {r.language}</span>}
                          {r.sizeLabel && <span>· {r.sizeLabel}</span>}
                        </>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 grid place-items-center w-8 h-8 rounded-lg bg-white/5 text-neutral-300">
                    {isDownloading ? (
                      <Loader2 size={15} className="animate-spin text-sky-400" />
                    ) : (
                      <Download size={15} />
                    )}
                  </span>
                  {isDownloading && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
                      <span
                        className={clsx(
                          "block h-full bg-sky-400 transition-all",
                          pct == null && "animate-pulse w-1/3",
                        )}
                        style={pct != null ? { width: `${pct}%` } : undefined}
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
