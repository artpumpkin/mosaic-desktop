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
import { Loader2, X } from "lucide-react";

import MangaToolbar from "@/components/manga/MangaToolbar";
import MangaFilterBar from "@/components/manga/MangaFilterBar";
import MangaHero from "@/components/manga/MangaHero";
import MangaRail from "@/components/manga/MangaRail";
import MangaGridView from "@/components/manga/MangaGridView";
import MangaDetail from "@/components/manga/MangaDetail";
import Reader from "@/components/manga/Reader";
import MangaSources from "@/components/manga/MangaSources";

import { getConnectorFor } from "@/lib/manga/connectors";
import { loadInstalledExtensions } from "@/lib/manga/extensions";
import { MANGADEX_GENRES, type BrowseSort } from "@/lib/manga/genres";
import { getMangaSources, setMangaSources } from "@/lib/settings";
import {
  allSources,
  resolveActiveSource,
  DEFAULT_MANGA_SOURCES_STATE,
} from "@/lib/manga/sources";
import {
  seriesKey,
  type Manga,
  type MangaDetail as MangaDetailT,
  type Chapter,
  type MangaSourcesState,
  type MangaReadProgress,
} from "@/lib/manga/types";
import {
  getMangaProgress,
  listInProgress,
  markChapterRead,
  getReadChapters,
  throttledSaver,
} from "@/lib/manga/progress";
import {
  loadFavorites,
  saveFavorites,
  loadLibrary,
  addToLibrary,
  removeFromLibrary,
  isInLibrary,
} from "@/lib/manga/library";
import { useFullWidth, useWide } from "@/lib/appLayout";
import { useInvalidation } from "@/lib/query/bus";
import { toast } from "@/lib/toast";

const FOCUS_STORAGE_KEY = "mosaic.manga.focus";

export default function MangaPage() {
  const [sourcesState, setSourcesState] = useState<MangaSourcesState>(
    DEFAULT_MANGA_SOURCES_STATE,
  );
  const [search, setSearch] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  useFullWidth(focusMode);
  useWide(true);

  const [sort, setSort] = useState<BrowseSort>("popular");
  const [genre, setGenre] = useState<string | null>(null);

  const [browseRows, setBrowseRows] = useState<{ title: string; items: Manga[] }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [featuredDetail, setFeaturedDetail] = useState<MangaDetailT | null>(null);

  const [searchResults, setSearchResults] = useState<Manga[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [active, setActive] = useState<Manga | null>(null);
  const [detail, setDetail] = useState<MangaDetailT | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [readChapters, setReadChapters] = useState<Set<string>>(new Set());

  const [reader, setReader] = useState<{ chapterId: string; pageIndex: number } | null>(
    null,
  );

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [library, setLibrary] = useState(() => [] as ReturnType<typeof loadLibrary>);
  const [progressEntries, setProgressEntries] = useState<MangaReadProgress[]>([]);
  const [inLibraryFlag, setInLibraryFlag] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Bumped once installed extensions are compiled into the runtime registry,
  // so the browse effect re-runs if an extension is the active source.
  const [extEpoch, setExtEpoch] = useState(0);

  const activeSource = useMemo(
    () => resolveActiveSource(sourcesState),
    [sourcesState],
  );

  // The source a given Manga belongs to (it may differ from the browse
  // source — e.g. a library/favorite item from another source).
  const sourceFor = useCallback(
    (sourceId: string) =>
      allSources(sourcesState).find((s) => s.id === sourceId) ?? activeSource,
    [sourcesState, activeSource],
  );
  const activeMangaSource = useMemo(
    () => (active ? sourceFor(active.sourceId) : activeSource),
    [active, sourceFor, activeSource],
  );

  // --- bootstrap ----------------------------------------------------------
  useEffect(() => setMounted(true), []);

  // Compile any installed extensions into the runtime registry on load.
  useEffect(() => {
    loadInstalledExtensions().finally(() => setExtEpoch((e) => e + 1));
  }, []);

  // Re-load + recompile extensions whenever the source list changes (install
  // / uninstall happens in the Sources modal, which invalidates this key).
  useInvalidation(["manga:extensions"], () => {
    loadInstalledExtensions().finally(() => setExtEpoch((e) => e + 1));
  });

  const loadSources = useCallback(() => {
    getMangaSources()
      .then(setSourcesState)
      .catch(() => setSourcesState(DEFAULT_MANGA_SOURCES_STATE));
  }, []);
  useEffect(() => loadSources(), [loadSources]);
  useInvalidation(["manga:sources"], loadSources);

  useEffect(() => {
    try {
      if (localStorage.getItem(FOCUS_STORAGE_KEY) === "1") setFocusMode(true);
    } catch {
      /* ignore */
    }
    setFavorites(loadFavorites());
    setLibrary(loadLibrary());
    setProgressEntries(listInProgress());
  }, []);

  // Deep-link resume from the Dashboard "Up next" rail: /manga?resume=<key>
  // where <key> is `${sourceId}:${mangaId}`. Open the series and jump straight
  // into the reader at the saved chapter/page. Chapters load async via the
  // detail effect; the Reader picks them up once they arrive.
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (resumeHandledRef.current) return;
    let raw: string | null = null;
    try {
      raw = new URLSearchParams(window.location.search).get("resume");
    } catch {
      /* ignore */
    }
    if (!raw) return;
    const sep = raw.indexOf(":");
    if (sep < 0) return;
    resumeHandledRef.current = true;
    const sourceId = raw.slice(0, sep);
    const mangaId = raw.slice(sep + 1);
    const prog = getMangaProgress(sourceId, mangaId);
    setActive({
      sourceId,
      id: mangaId,
      title: prog?.title ?? mangaId,
      cover: prog?.cover ?? null,
    });
    if (prog) setReader({ chapterId: prog.chapterId, pageIndex: prog.pageIndex });
  }, []);

  // Genre filtering is MangaDex-specific; reset it when the source changes.
  useEffect(() => {
    setGenre(null);
  }, [activeSource.id]);

  // --- browse rows for the active source ----------------------------------
  useEffect(() => {
    let cancelled = false;
    setBrowseLoading(true);
    setBrowseError(null);
    setBrowseRows([]);
    setFeaturedDetail(null);
    (async () => {
      try {
        const connector = getConnectorFor(activeSource);
        const rows = connector.browse
          ? await connector.browse(activeSource, { sort, genre })
          : [];
        if (!cancelled) setBrowseRows(rows);
      } catch (e) {
        if (!cancelled)
          setBrowseError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSource, sort, genre, extEpoch]);

  // Fetch detail for the featured (first browse) item to enrich the hero.
  const featured = browseRows[0]?.items?.[0] ?? null;
  const featuredId = featured ? `${featured.sourceId}:${featured.id}` : null;
  useEffect(() => {
    if (!featured) {
      setFeaturedDetail(null);
      return;
    }
    let cancelled = false;
    getConnectorFor(activeSource)
      .getManga(activeSource, featured.id)
      .then((d) => {
        if (!cancelled) setFeaturedDetail(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredId]);

  // --- search (deferred) --------------------------------------------------
  const deferredSearch = useDeferredValue(search);
  useEffect(() => {
    const q = deferredSearch.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    (async () => {
      try {
        const { items } = await getConnectorFor(activeSource).search(activeSource, q);
        if (!cancelled) setSearchResults(items);
      } catch (e) {
        if (!cancelled) {
          setSearchResults([]);
          toast("err", e instanceof Error ? e.message : "Search failed");
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, activeSource]);

  // --- detail + chapters on pick ------------------------------------------
  useEffect(() => {
    if (!active) {
      setDetail(null);
      setChapters([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setChaptersLoading(true);
    setDetail(null);
    setChapters([]);
    setReadChapters(getReadChapters(active.sourceId, active.id));
    setInLibraryFlag(isInLibrary(seriesKey(active.sourceId, active.id)));
    const src = activeMangaSource;
    const connector = getConnectorFor(src);
    connector
      .getManga(src, active.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    connector
      .getChapters(src, active.id)
      .then((c) => {
        if (!cancelled) setChapters(c);
      })
      .catch((e) => {
        if (!cancelled) toast("err", e instanceof Error ? e.message : "Chapters failed");
      })
      .finally(() => {
        if (!cancelled) setChaptersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, activeMangaSource]);

  // --- handlers -----------------------------------------------------------
  const handlePick = useCallback((item: Manga) => setActive(item), []);
  const closeActive = useCallback(() => setActive(null), []);

  const persistSources = useCallback((next: MangaSourcesState) => {
    setSourcesState(next);
    setMangaSources(next).catch(() => {});
  }, []);

  const onPickSource = useCallback(
    (id: string) => persistSources({ ...sourcesState, activeId: id }),
    [sourcesState, persistSources],
  );

  const toggleFavorite = useCallback((item: Manga) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      const key = seriesKey(item.sourceId, item.id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavorites(next);
      return next;
    });
  }, []);

  const toggleLibrary = useCallback(() => {
    if (!active) return;
    const key = seriesKey(active.sourceId, active.id);
    if (isInLibrary(key)) {
      removeFromLibrary(key);
      setInLibraryFlag(false);
    } else {
      addToLibrary({
        key,
        sourceId: active.sourceId,
        mangaId: active.id,
        title: active.title,
        cover: active.cover ?? null,
        addedAt: Date.now(),
      });
      setInLibraryFlag(true);
    }
    setLibrary(loadLibrary());
  }, [active]);

  const openChapter = useCallback(
    (chapterId: string) => {
      if (!active) return;
      const prog = getMangaProgress(active.sourceId, active.id);
      const pageIndex =
        prog && prog.chapterId === chapterId ? prog.pageIndex : 0;
      setReader({ chapterId, pageIndex });
    },
    [active],
  );

  const saver = useRef(throttledSaver(1000));
  const onReaderProgress = useCallback((p: MangaReadProgress) => {
    saver.current(p);
  }, []);

  const onChapterRead = useCallback(
    (chapterId: string) => {
      if (!active) return;
      markChapterRead(active.sourceId, active.id, chapterId);
      setReadChapters(getReadChapters(active.sourceId, active.id));
    },
    [active],
  );

  const closeReader = useCallback(() => {
    setReader(null);
    setProgressEntries(listInProgress());
    if (active) setReadChapters(getReadChapters(active.sourceId, active.id));
  }, [active]);

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

  // --- derived rails ------------------------------------------------------
  const knownByKey = useMemo(() => {
    const m = new Map<string, Manga>();
    for (const row of browseRows) for (const it of row.items) m.set(seriesKey(it.sourceId, it.id), it);
    for (const it of searchResults) m.set(seriesKey(it.sourceId, it.id), it);
    for (const e of library)
      m.set(e.key, {
        sourceId: e.sourceId,
        id: e.mangaId,
        title: e.title,
        cover: e.cover,
      });
    for (const p of progressEntries)
      if (!m.has(p.key))
        m.set(p.key, {
          sourceId: p.sourceId,
          id: p.mangaId,
          title: p.title,
          cover: p.cover,
        });
    return m;
  }, [browseRows, searchResults, library, progressEntries]);

  const continueItems = useMemo<Manga[]>(
    () =>
      progressEntries
        .map((p) => knownByKey.get(p.key))
        .filter((x): x is Manga => !!x),
    [progressEntries, knownByKey],
  );

  const progressByKey = useMemo(() => {
    const m = new Map<string, { fraction: number; badge?: string }>();
    for (const p of progressEntries) {
      const fraction = p.pageCount > 0 ? Math.min(0.99, (p.pageIndex + 1) / p.pageCount) : 0;
      m.set(p.key, {
        fraction,
        badge: p.chapterNumber ? `Ch. ${p.chapterNumber}` : undefined,
      });
    }
    return m;
  }, [progressEntries]);

  const libraryItems = useMemo<Manga[]>(
    () =>
      library.map((e) => ({
        sourceId: e.sourceId,
        id: e.mangaId,
        title: e.title,
        cover: e.cover,
      })),
    [library],
  );

  const favoriteItems = useMemo<Manga[]>(
    () =>
      [...favorites]
        .map((k) => knownByKey.get(k))
        .filter((x): x is Manga => !!x),
    [favorites, knownByKey],
  );

  const showSearch = deferredSearch.trim().length > 0;
  const activeKey = active ? seriesKey(active.sourceId, active.id) : null;
  const lastChapterId = useMemo(() => {
    if (!active) return null;
    return getMangaProgress(active.sourceId, active.id)?.chapterId ?? null;
  }, [active, progressEntries]);

  const containerCls =
    "h-screen flex flex-col bg-[var(--background)] overflow-hidden";

  return (
    <div className={containerCls}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MangaToolbar
          search={search}
          onSearch={setSearch}
          sources={allSources(sourcesState)}
          activeId={sourcesState.activeId}
          onPickSource={onPickSource}
          focusMode={focusMode}
          onToggleFocus={toggleFocus}
          onManageSources={() => setManageOpen(true)}
        />

        <div className="px-4 md:px-6 py-5 md:py-8 space-y-10">
          {browseError && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-center text-sm text-rose-300">
              Failed to load from {activeSource.name}: {browseError}
            </div>
          )}

          {showSearch ? (
            <MangaGridView
              title={`Results for "${deferredSearch.trim()}" · ${activeSource.name}`}
              items={searchResults}
              activeKey={activeKey}
              favorites={favorites}
              onPick={handlePick}
              onToggleFavorite={toggleFavorite}
              loading={searchLoading}
            />
          ) : (
            <div className="space-y-10">
              {featured && (
                <MangaHero
                  item={featured}
                  detail={featuredDetail}
                  sourceName={activeSource.name.replace(/\s*\(built-in\)/, "")}
                  isFavorite={favorites.has(`${featured.sourceId}:${featured.id}`)}
                  onOpen={handlePick}
                  onToggleFavorite={toggleFavorite}
                />
              )}

              <MangaFilterBar
                sort={sort}
                onSort={setSort}
                genre={genre}
                onGenre={setGenre}
                genres={MANGADEX_GENRES}
                showGenres={activeSource.kind === "mangadex"}
              />

              <MangaRail
                title="Continue reading"
                items={continueItems}
                activeKey={activeKey}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
                progressByKey={progressByKey}
              />
              <MangaRail
                title="Library"
                items={libraryItems}
                activeKey={activeKey}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
              />
              <MangaRail
                title="Favorites"
                items={favoriteItems}
                activeKey={activeKey}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
              />
              {browseRows.map((row, i) => (
                <MangaRail
                  key={row.title}
                  title={row.title}
                  items={i === 0 && featured ? row.items.slice(1) : row.items}
                  activeKey={activeKey}
                  favorites={favorites}
                  onPick={handlePick}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
              {browseLoading && (
                <div className="text-sm text-neutral-400 flex items-center gap-2 px-1">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {mounted &&
        active &&
        !reader &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md grid place-items-center p-4 md:p-8"
            onClick={closeActive}
          >
            <div
              className="relative w-full max-w-4xl h-[90vh] overflow-hidden rounded-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeActive}
                className="absolute top-3 right-3 z-20 grid place-items-center w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white/90 border border-white/10 backdrop-blur"
                aria-label="Close"
              >
                <X size={16} />
              </button>
              <MangaDetail
                item={active}
                detail={detail}
                detailLoading={detailLoading}
                chapters={chapters}
                chaptersLoading={chaptersLoading}
                readChapters={readChapters}
                lastChapterId={lastChapterId}
                isFavorite={favorites.has(activeKey!)}
                inLibrary={inLibraryFlag}
                onToggleFavorite={() => toggleFavorite(active)}
                onToggleLibrary={toggleLibrary}
                onOpenChapter={openChapter}
              />
            </div>
          </div>,
          document.body,
        )}

      {/* Reader overlay */}
      {mounted &&
        active &&
        reader &&
        createPortal(
          <Reader
            source={activeMangaSource}
            manga={active}
            chapters={chapters}
            initialChapterId={reader.chapterId}
            initialPageIndex={reader.pageIndex}
            onClose={closeReader}
            onProgress={onReaderProgress}
            onChapterRead={onChapterRead}
          />,
          document.body,
        )}

      {/* Sources manager */}
      {mounted &&
        manageOpen &&
        createPortal(
          <MangaSources state={sourcesState} onClose={() => setManageOpen(false)} />,
          document.body,
        )}
    </div>
  );
}
