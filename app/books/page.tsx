"use client";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { X, SearchX, FolderOpen, RefreshCw, Loader2 } from "lucide-react";

import BookToolbar, {
  type BookFilters,
  DEFAULT_BOOK_FILTERS,
} from "@/components/books/BookToolbar";
import BookHero from "@/components/books/BookHero";
import BookSettingsModal from "@/components/books/BookSettingsModal";
import BookSkeleton, { BookGridSkeleton } from "@/components/books/BookSkeleton";
import BookRail from "@/components/books/BookRail";
import BookGridView from "@/components/books/BookGridView";
import BookCard from "@/components/books/BookCard";
import BookDetail from "@/components/books/BookDetail";
import EpubReader from "@/components/books/EpubReader";
import MediaGridView from "@/components/browse/MediaGridView";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { LibgenQuery } from "@/lib/books/libgen";

import {
  BOOK_CATALOGS,
  BOOK_GENRES,
  BROWSE_PAGE_SIZE,
  fetchBrowse,
  fetchCatalog,
  fetchCatalogPage,
  fetchMeta,
  searchCatalog,
  sortBookItems,
} from "@/lib/books/openlibrary";
import {
  getBookProgress,
  listInProgress,
  loadFavorites,
  loadRecents,
  pushRecent,
  saveFavorites,
} from "@/lib/books/progress";
import { loadBookFilters, saveBookFilters } from "@/lib/books/prefs";
import {
  getDownloadedPath,
  getLibraryDir,
  getLinkedLocalId,
  getLocalEntry,
  importSingleEpub,
  linkWorkToLocal,
  loadLocalEntries,
  localEntryToBookItem,
  recordDownloadedPath,
  resolveLocalPathForWork,
  scanLibrary,
} from "@/lib/books/library";
import type { BookItem, BookMeta, LocalBookEntry } from "@/lib/books/types";
import { parseWorkId } from "@/lib/books/types";
import { useFullWidth, useWide } from "@/lib/appLayout";
import { toast } from "@/lib/toast";
import { logger, exportAll } from "@/lib/logger";

const FOCUS_STORAGE_KEY = "mosaic.books.focus";

let catalogMemoryCache: Map<string, BookItem[]> | null = null;

export default function BooksPage() {
  const [filters, setFilters] = useState<BookFilters>(DEFAULT_BOOK_FILTERS);
  const [focusMode, setFocusMode] = useState(false);
  useFullWidth(focusMode);
  useWide(true);

  const [catalogs, setCatalogs] = useState<Map<string, BookItem[]>>(
    () => catalogMemoryCache ?? new Map(),
  );
  const [catalogLoading, setCatalogLoading] = useState(() => !catalogMemoryCache);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [localEntries, setLocalEntries] = useState<LocalBookEntry[]>([]);
  const [libraryDir, setLibraryDir] = useState<string | null>(null);
  const [libraryScanning, setLibraryScanning] = useState(false);

  const [searchResults, setSearchResults] = useState<BookItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [seeAll, setSeeAll] = useState<string | null>(null);
  const [browseItems, setBrowseItems] = useState<BookItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseExhausted, setBrowseExhausted] = useState(false);

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<{ id: string; at: number }[]>([]);
  const [progressEntries, setProgressEntries] = useState(
    [] as ReturnType<typeof listInProgress>,
  );

  const [active, setActive] = useState<BookItem | null>(null);
  const [activeMeta, setActiveMeta] = useState<BookMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  const [reading, setReading] = useState(false);
  const [readPath, setReadPath] = useState<string | null>(null);
  const [readKey, setReadKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const browseActive =
    filters.tab === "discover" &&
    (filters.genre != null || filters.sort !== "featured");
  const filtersActive = browseActive;
  const gridActive = filters.tab === "discover" && (seeAll != null || browseActive);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filtersRestoredRef = useRef(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(FOCUS_STORAGE_KEY) === "1") setFocusMode(true);
    } catch {
      /* ignore */
    }
    const saved = loadBookFilters();
    if (saved) setFilters((prev) => ({ ...prev, ...saved }));
    filtersRestoredRef.current = true;
    setFavorites(loadFavorites());
    setRecents(loadRecents());
    setProgressEntries(listInProgress());
    setLocalEntries(loadLocalEntries());
    setLibraryDir(getLibraryDir());
  }, []);

  useEffect(() => {
    if (!filtersRestoredRef.current) return;
    saveBookFilters({ genre: filters.genre, sort: filters.sort });
  }, [filters.genre, filters.sort]);

  const resumeHandledRef = useRef(false);
  const pendingResumeRef = useRef<string | null>(null);
  useEffect(() => {
    if (resumeHandledRef.current) return;
    let raw: string | null = null;
    try {
      raw = new URLSearchParams(window.location.search).get("resume");
    } catch {
      /* ignore */
    }
    if (!raw) return;
    resumeHandledRef.current = true;
    pendingResumeRef.current = raw;
    const prog = getBookProgress(raw);
    if (raw.startsWith("local:")) {
      const entry = getLocalEntry(raw);
      if (entry) {
        setActive(localEntryToBookItem(entry));
        setReadPath(entry.path);
        setReadKey(raw);
      }
    } else {
      setActive({
        id: raw,
        title: prog?.title ?? raw,
        authors: [],
        cover: prog?.cover ?? null,
      });
      const path = prog?.path ?? resolveLocalPathForWork(parseWorkId(raw) ?? raw);
      if (path) {
        setReadPath(path);
        setReadKey(raw);
      }
    }
  }, []);

  useEffect(() => {
    if (!active || !reading) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active, reading]);

  useEffect(() => {
    if (!active || reading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, reading]);

  useEffect(() => {
    let cancelled = false;
    const hadCache = catalogMemoryCache != null;
    if (!hadCache) setCatalogLoading(true);
    setCatalogError(null);
    (async () => {
      try {
        const results = await Promise.allSettled(
          BOOK_CATALOGS.map((c) => fetchCatalog(c.id)),
        );
        if (cancelled) return;
        const next = new Map<string, BookItem[]>();
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next.set(BOOK_CATALOGS[i].id, r.value);
        });
        if (next.size > 0) {
          catalogMemoryCache = next;
          setCatalogs(next);
        } else if (!hadCache) {
          setCatalogError("Couldn't reach Open Library.");
        }
      } catch (e) {
        if (!cancelled && !hadCache)
          setCatalogError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchGridPage = useCallback(
    (offset: number) =>
      seeAll
        ? fetchCatalogPage(
            seeAll,
            offset,
            filters.sort === "featured" ? undefined : filters.sort,
          )
        : fetchBrowse({
            genre: filters.genre,
            sort: filters.sort,
            offset,
          }),
    [seeAll, filters.genre, filters.sort],
  );

  useEffect(() => {
    if (!gridActive) {
      setBrowseItems([]);
      setBrowseOffset(0);
      setBrowseExhausted(false);
      return;
    }
    let cancelled = false;
    setBrowseLoading(true);
    setBrowseItems([]);
    setBrowseOffset(0);
    setBrowseExhausted(false);
    (async () => {
      try {
        const { items, raw } = await fetchGridPage(0);
        if (cancelled) return;
        setBrowseItems(items);
        setBrowseOffset(raw);
        setBrowseExhausted(raw < BROWSE_PAGE_SIZE);
      } catch {
        if (!cancelled) {
          setBrowseItems([]);
          setBrowseExhausted(true);
        }
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gridActive, fetchGridPage]);

  const loadMoreBrowse = useCallback(() => {
    if (browseLoading || browseLoadingMore || browseExhausted) return;
    setBrowseLoadingMore(true);
    (async () => {
      try {
        const { items, raw } = await fetchGridPage(browseOffset);
        setBrowseItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...items.filter((p) => !seen.has(p.id))];
        });
        setBrowseOffset((o) => o + raw);
        if (raw < BROWSE_PAGE_SIZE) setBrowseExhausted(true);
      } catch {
        setBrowseExhausted(true);
      } finally {
        setBrowseLoadingMore(false);
      }
    })();
  }, [browseLoading, browseLoadingMore, browseExhausted, browseOffset, fetchGridPage]);

  const deferredSearch = useDeferredValue(filters.search);
  useEffect(() => {
    const q = deferredSearch.trim();
    if (!q || filters.tab === "library") {
      if (filters.tab === "discover") setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    (async () => {
      try {
        const r = await searchCatalog(q);
        if (!cancelled) setSearchResults(r);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, filters.tab]);

  useEffect(() => {
    if (!active || active.id.startsWith("local:")) {
      if (active?.id.startsWith("local:")) {
        const entry = getLocalEntry(active.id);
        setActiveMeta(
          entry
            ? {
                ...localEntryToBookItem(entry),
                isbns: entry.isbns,
                localPath: entry.path,
                localId: entry.id,
              }
            : null,
        );
      } else {
        setActiveMeta(null);
      }
      setMetaLoading(false);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    setActiveMeta(null);
    (async () => {
      try {
        const meta = await fetchMeta(active.id);
        if (cancelled) return;
        const workId = parseWorkId(active.id);
        const localId = workId ? getLinkedLocalId(workId) : null;
        const local = localId ? getLocalEntry(localId) : null;
        logger.info("books/page", "meta open resolve", {
          activeId: active.id,
          workId,
          byId: getDownloadedPath(active.id),
          byWork: workId ? resolveLocalPathForWork(workId) : null,
          localId,
          localPath: local?.path ?? null,
        });
        setActiveMeta({
          ...meta,
          authors: meta.authors.length ? meta.authors : active.authors,
          localPath: local?.path ?? resolveLocalPathForWork(workId ?? "") ?? null,
          localId: local?.id ?? null,
        });
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    const key = pendingResumeRef.current;
    if (!key || !readPath) return;
    pendingResumeRef.current = null;
    setReading(true);
  }, [readPath, activeMeta]);

  const resolveReadTarget = useCallback(
    (item: BookItem): { path: string; key: string } | null => {
      if (item.id.startsWith("local:")) {
        const entry = getLocalEntry(item.id);
        return entry ? { path: entry.path, key: item.id } : null;
      }
      const workId = parseWorkId(item.id);
      if (!workId) return null;
      const path =
        // Keyed by the exact book id (no parseWorkId mismatch) first, then the
        // work-link/entry/work-keyed lookups, then the in-memory meta.
        getDownloadedPath(item.id) ??
        resolveLocalPathForWork(workId) ??
        activeMeta?.localPath ??
        null;
      return path ? { path, key: item.id } : null;
    },
    [activeMeta],
  );

  const handlePick = useCallback((item: BookItem) => {
    setActive(item);
    setReading(false);
    pushRecent(item.id);
    setRecents(loadRecents());
  }, []);

  const closeActive = useCallback(() => {
    setActive(null);
    setReading(false);
  }, []);

  const startReading = useCallback(
    (item?: BookItem) => {
      const target = item ?? active;
      if (!target) return;
      const resolved = resolveReadTarget(target);
      if (!resolved) {
        toast("err", "Link or import an EPUB file first");
        return;
      }
      // The in-app reader only renders EPUB; hand any other format (PDF, MOBI…)
      // to the OS default app instead of hanging the epub.js loader forever.
      if (!resolved.path.toLowerCase().endsWith(".epub")) {
        shellOpen(resolved.path).catch((e) =>
          toast("err", e instanceof Error ? e.message : "Couldn't open file"),
        );
        return;
      }
      setReadPath(resolved.path);
      setReadKey(resolved.key);
      setReading(true);
    },
    [active, resolveReadTarget],
  );

  const sourceQuery = useMemo<LibgenQuery | null>(() => {
    if (!active) return null;
    const title = activeMeta?.title ?? active.title;
    if (!title) return null;
    return {
      title,
      author: (activeMeta?.authors ?? active.authors)[0] ?? null,
      isbn: activeMeta?.isbns?.[0] ?? null,
    };
  }, [active, activeMeta]);

  const handleImported = useCallback(
    async (entry: LocalBookEntry, isEpub: boolean) => {
      // Record the downloaded path keyed by the exact book id we'll look it up
      // with on reopen — this is the source of truth for the Read button.
      if (active) recordDownloadedPath(active.id, entry.path);
      logger.info("books/page", "handleImported", {
        activeId: active?.id ?? null,
        entryPath: entry.path,
        isEpub,
        readback: active ? getDownloadedPath(active.id) : null,
      });
      setLocalEntries(loadLocalEntries());
      // Always set a NEW non-null meta (even if meta was still loading), so the
      // localPath lands and the `activeLocalPath` memo recomputes — otherwise
      // the Read button stays disabled after a download.
      setActiveMeta((m) => {
        const base: BookMeta =
          m ??
          ({
            id: active?.id ?? entry.id,
            title: active?.title ?? entry.title,
            authors: active?.authors ?? entry.authors,
            cover: active?.cover ?? entry.cover ?? null,
          } satisfies BookMeta);
        return { ...base, localPath: entry.path, localId: entry.id };
      });
      if (isEpub) {
        setReadPath(entry.path);
        setReadKey(active?.id ?? entry.id);
        setReading(true);
      } else {
        // Non-EPUB formats (PDF/MOBI/…) can't render in the in-app reader —
        // hand the file to the OS default app.
        try {
          await shellOpen(entry.path);
        } catch (e) {
          toast("err", e instanceof Error ? e.message : "Couldn't open file");
        }
      }
    },
    [active],
  );

  const updateFilters = useCallback((next: Partial<BookFilters>) => {
    if ("genre" in next) setSeeAll(null);
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const clearFilters = useCallback(() => {
    setSeeAll(null);
    setFilters((prev) => ({ ...DEFAULT_BOOK_FILTERS, tab: prev.tab, search: prev.search }));
  }, []);

  const openSeeAll = useCallback((catalogId: string) => {
    setSeeAll(catalogId);
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }, []);

  const toggleFocus = useCallback(() => {
    setFocusMode((v) => {
      const next = !v;
      try {
        localStorage.setItem(FOCUS_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const pickLibraryFolder = useCallback(async () => {
    try {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Choose EPUB library folder",
      });
      if (!dir || typeof dir !== "string") return;
      setLibraryScanning(true);
      const entries = await scanLibrary(dir);
      setLocalEntries(entries);
      setLibraryDir(dir);
      toast("ok", `Found ${entries.length} EPUB${entries.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLibraryScanning(false);
    }
  }, []);

  const rescanLibrary = useCallback(async () => {
    const dir = libraryDir ?? getLibraryDir();
    if (!dir) {
      toast("err", "Choose a library folder first");
      return;
    }
    setLibraryScanning(true);
    try {
      const entries = await scanLibrary(dir);
      setLocalEntries(entries);
      toast("ok", `Scanned ${entries.length} EPUB${entries.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setLibraryScanning(false);
    }
  }, [libraryDir]);

  const importEpubFile = useCallback(async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
        title: "Import EPUB",
      });
      if (!file || typeof file !== "string") return;
      const entry = await importSingleEpub(file);
      setLocalEntries(loadLocalEntries());
      if (active && active.id.startsWith("ol:")) {
        const workId = parseWorkId(active.id);
        if (workId) linkWorkToLocal(workId, entry.id);
      }
      toast("ok", "EPUB imported");
      if (active) {
        setActiveMeta((m) =>
          m ? { ...m, localPath: entry.path, localId: entry.id } : m,
        );
      }
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Import failed");
    }
  }, [active]);

  const linkFromLibrary = useCallback(async () => {
    if (!active || !active.id.startsWith("ol:")) return;
    const workId = parseWorkId(active.id);
    if (!workId) return;
    const entries = loadLocalEntries();
    if (entries.length === 0) {
      toast("err", "Scan a library folder or import an EPUB first");
      return;
    }
    const file = await open({
      multiple: false,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
      title: "Link EPUB to this book",
    });
    if (!file || typeof file !== "string") return;
    let entry = entries.find((e) => e.path === file) ?? null;
    if (!entry) entry = await importSingleEpub(file);
    linkWorkToLocal(workId, entry.id);
    setLocalEntries(loadLocalEntries());
    setActiveMeta((m) =>
      m ? { ...m, localPath: entry.path, localId: entry.id } : m,
    );
    toast("ok", "EPUB linked");
  }, [active]);

  const localBookItems = useMemo(
    () => localEntries.map(localEntryToBookItem),
    [localEntries],
  );

  const idsByItem = useMemo(() => {
    const map = new Map<string, BookItem>();
    for (const list of catalogs.values()) for (const it of list) map.set(it.id, it);
    for (const it of searchResults) map.set(it.id, it);
    for (const it of browseItems) map.set(it.id, it);
    for (const it of localBookItems) map.set(it.id, it);
    return map;
  }, [catalogs, searchResults, browseItems, localBookItems]);

  const favoriteItems = useMemo(() => {
    const out: BookItem[] = [];
    for (const id of favorites) {
      const it = idsByItem.get(id);
      if (it) out.push(it);
    }
    return out;
  }, [favorites, idsByItem]);

  const recentItems = useMemo(() => {
    const out: BookItem[] = [];
    for (const r of recents) {
      const it = idsByItem.get(r.id);
      if (it) out.push(it);
    }
    return out;
  }, [recents, idsByItem]);

  const continueItems = useMemo(() => {
    const out: { item: BookItem; fraction: number }[] = [];
    for (const p of progressEntries) {
      const item =
        idsByItem.get(p.key) ??
        ({
          id: p.key,
          title: p.title,
          authors: [],
          cover: p.cover ?? null,
        } satisfies BookItem);
      out.push({ item, fraction: p.fraction });
    }
    return out.slice(0, 24);
  }, [progressEntries, idsByItem]);

  const continueProgressMap = useMemo(() => {
    const m = new Map<string, { fraction: number }>();
    for (const c of continueItems) m.set(c.item.id, { fraction: c.fraction });
    return m;
  }, [continueItems]);

  const filteredLibrary = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return localBookItems;
    return localBookItems.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.authors.some((a) => a.toLowerCase().includes(q)),
    );
  }, [localBookItems, deferredSearch]);

  const showSearch =
    filters.tab === "discover" && deferredSearch.trim().length > 0;
  const showLibrarySearch =
    filters.tab === "library" && deferredSearch.trim().length > 0;

  const filteredSearch = useMemo(
    () => sortBookItems(searchResults, filters.sort),
    [searchResults, filters.sort],
  );

  const heroItems = useMemo(
    () => catalogs.get("trending") ?? catalogs.get("popular") ?? [],
    [catalogs],
  );

  const copyLogs = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportAll());
      toast("ok", "Debug logs copied");
    } catch {
      toast("err", "Couldn't copy logs");
    }
  }, []);

  const gridTitle = useMemo(() => {
    if (seeAll) {
      return BOOK_CATALOGS.find((c) => c.id === seeAll)?.name ?? "All books";
    }
    const g = filters.genre
      ? BOOK_GENRES.find((x) => x.slug === filters.genre)?.label ?? filters.genre
      : null;
    const sortLabel =
      filters.sort === "top"
        ? "Top rated"
        : filters.sort === "newest"
          ? "Newest"
          : filters.sort === "popular"
            ? "Most popular"
            : null;
    return [g, "Books", sortLabel && `· ${sortLabel}`].filter(Boolean).join(" ");
  }, [seeAll, filters.genre, filters.sort]);

  const resultCount = showSearch
    ? filteredSearch.length
    : showLibrarySearch
      ? filteredLibrary.length
      : gridActive
        ? browseItems.length
        : undefined;

  const activeLocalPath = useMemo(() => {
    if (!active) return null;
    const resolved = resolveReadTarget(active);
    return resolved?.path ?? activeMeta?.localPath ?? null;
  }, [active, activeMeta, resolveReadTarget]);

  const activeProgress = active ? getBookProgress(active.id) : null;

  const containerCls =
    "h-screen flex flex-col bg-[var(--background)] overflow-hidden";

  return (
    <div className={containerCls}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <BookToolbar
          filters={filters}
          onChange={updateFilters}
          focusMode={focusMode}
          onToggleFocus={toggleFocus}
          onOpenSettings={() => setSettingsOpen(true)}
          onCopyLogs={copyLogs}
          resultCount={resultCount}
          filtersActive={filtersActive}
          onClear={clearFilters}
        />

        <div className="px-4 md:px-6 py-5 md:py-8 space-y-10">
          {catalogError && filters.tab === "discover" && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-center text-sm text-rose-300">
              Failed to load books: {catalogError}
            </div>
          )}

          {filters.tab === "library" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={pickLibraryFolder}
                  disabled={libraryScanning}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-neutral-200 hover:bg-white/10"
                >
                  {libraryScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FolderOpen size={14} />
                  )}
                  {libraryDir ? "Change folder" : "Choose folder"}
                </button>
                {libraryDir && (
                  <button
                    type="button"
                    onClick={rescanLibrary}
                    disabled={libraryScanning}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-neutral-200 hover:bg-white/10"
                  >
                    <RefreshCw size={14} className={libraryScanning ? "animate-spin" : ""} />
                    Rescan
                  </button>
                )}
                <button
                  type="button"
                  onClick={importEpubFile}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-[12.5px] text-neutral-200 hover:bg-white/10"
                >
                  Import EPUB
                </button>
                {libraryDir && (
                  <span className="text-[11px] text-neutral-500 truncate max-w-md">
                    {libraryDir}
                  </span>
                )}
              </div>

              {continueItems.length > 0 && !showLibrarySearch && (
                <BookRail
                  title="Continue reading"
                  items={continueItems.map((c) => c.item)}
                  activeId={active?.id ?? null}
                  favorites={favorites}
                  onPick={(item) => {
                    handlePick(item);
                    startReading(item);
                  }}
                  onToggleFavorite={toggleFavorite}
                  progressById={continueProgressMap}
                />
              )}

              {showLibrarySearch ? (
                <MediaGridView
                  title={`Library results for “${deferredSearch.trim()}”`}
                  items={filteredLibrary}
                  getKey={(item) => item.id}
                  emptyLabel="No matching EPUBs in your library."
                  renderItem={(item) => (
                    <BookCard
                      item={item}
                      active={item.id === active?.id}
                      isFavorite={favorites.has(item.id)}
                      onPick={handlePick}
                      onToggleFavorite={toggleFavorite}
                      progress={continueProgressMap.get(item.id)?.fraction}
                      fluid
                    />
                  )}
                />
              ) : filteredLibrary.length > 0 ? (
                <MediaGridView
                  title="My EPUBs"
                  items={filteredLibrary}
                  getKey={(item) => item.id}
                  renderItem={(item) => (
                    <BookCard
                      item={item}
                      active={item.id === active?.id}
                      isFavorite={favorites.has(item.id)}
                      onPick={handlePick}
                      onToggleFavorite={toggleFavorite}
                      progress={continueProgressMap.get(item.id)?.fraction}
                      fluid
                    />
                  )}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
                  <FolderOpen size={26} />
                  <p className="text-sm">Choose a folder or import an EPUB to get started.</p>
                </div>
              )}
            </>
          ) : showSearch ? (
            <MediaGridView
              title={`Results for “${deferredSearch.trim()}”`}
              items={filteredSearch}
              getKey={(item) => item.id}
              loading={searchLoading}
              emptyLabel={`No books match “${deferredSearch.trim()}”.`}
              renderItem={(item) => (
                <BookCard
                  item={item}
                  active={item.id === active?.id}
                  isFavorite={favorites.has(item.id)}
                  onPick={handlePick}
                  onToggleFavorite={toggleFavorite}
                  fluid
                />
              )}
            />
          ) : gridActive ? (
            browseLoading ? (
              <BookGridSkeleton />
            ) : browseItems.length > 0 ? (
              <BookGridView
                title={gridTitle}
                items={browseItems}
                activeId={active?.id ?? null}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
                onBack={clearFilters}
                hasMore={!browseExhausted}
                loadingMore={browseLoadingMore}
                onLoadMore={loadMoreBrowse}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500">
                <SearchX size={26} />
                <p className="text-sm">No books match these filters.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-[12.5px] text-neutral-200 hover:bg-white/10"
                >
                  Clear filters
                </button>
              </div>
            )
          ) : catalogLoading && catalogs.size === 0 ? (
            <BookSkeleton />
          ) : (
            <>
              {!catalogError && heroItems.length > 0 && (
                <BookHero
                  items={heroItems}
                  onPlay={handlePick}
                  onInfo={handlePick}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                />
              )}
              <div className="space-y-5">
                {continueItems.length > 0 && (
                  <BookRail
                    title="Continue reading"
                    items={continueItems.map((c) => c.item)}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                    progressById={continueProgressMap}
                  />
                )}
                {favoriteItems.length > 0 && (
                  <BookRail
                    title="Favorites"
                    items={favoriteItems}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                  />
                )}
                {recentItems.length > 0 && (
                  <BookRail
                    title="Recently opened"
                    items={recentItems}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                  />
                )}
                {BOOK_CATALOGS.map((c) => {
                  const list = catalogs.get(c.id);
                  if (!list || list.length === 0) return null;
                  return (
                    <BookRail
                      key={c.id}
                      title={c.name}
                      items={list}
                      activeId={active?.id ?? null}
                      favorites={favorites}
                      onPick={handlePick}
                      onToggleFavorite={toggleFavorite}
                      onSeeAll={c.id === "trending" ? undefined : () => openSeeAll(c.id)}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <BookSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDataChanged={() => {
          setFavorites(loadFavorites());
          setRecents(loadRecents());
          setProgressEntries(listInProgress());
          setLocalEntries(loadLocalEntries());
          setLibraryDir(getLibraryDir());
        }}
      />

      {mounted &&
        reading &&
        readPath &&
        createPortal(
          <EpubReader
            path={readPath}
            title={active?.title ?? "Book"}
            cover={active?.cover}
            progressKey={readKey || active?.id || readPath}
            initialCfi={getBookProgress(readKey || active?.id || "")?.locationCfi}
            onClose={() => {
              setReading(false);
              setProgressEntries(listInProgress());
            }}
            onProgress={() => {
              // EpubReader persists (throttled + flush on close); we only
              // refresh the in-memory continue/progress lists here.
              setProgressEntries(listInProgress());
            }}
          />,
          document.body,
        )}

      {mounted &&
        active &&
        !reading &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md grid place-items-center p-4 md:p-8"
            onClick={closeActive}
          >
            <div
              className="relative w-full max-w-5xl h-[90vh] overflow-hidden rounded-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeActive}
                className="absolute top-3 right-3 z-10 grid place-items-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/10 backdrop-blur"
                aria-label="Close"
              >
                <X size={16} />
              </button>
              <BookDetail
                item={active}
                meta={activeMeta}
                metaLoading={metaLoading}
                localPath={activeLocalPath}
                localLabel={
                  activeMeta?.localId
                    ? getLocalEntry(activeMeta.localId)?.title
                    : null
                }
                isFavorite={favorites.has(active.id)}
                onToggleFavorite={() => toggleFavorite(active.id)}
                onRead={() => startReading()}
                onLinkEpub={linkFromLibrary}
                onImportEpub={importEpubFile}
                sourceQuery={sourceQuery}
                workId={parseWorkId(active.id)}
                onImported={handleImported}
                progressFraction={activeProgress?.fraction}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
