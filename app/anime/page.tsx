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
import { X, SearchX } from "lucide-react";

import PosterRail from "@/components/movies/PosterRail";
import CatalogGridView from "@/components/movies/CatalogGridView";
import MediaGridView from "@/components/browse/MediaGridView";
import GenreCards from "@/components/browse/GenreCards";
import PosterCard from "@/components/movies/PosterCard";
import TitleDetail from "@/components/movies/TitleDetail";
import MoviePlayer from "@/components/movies/MoviePlayer";
import AnimeToolbar, {
  type AnimeFilters,
  DEFAULT_ANIME_FILTERS,
} from "@/components/anime/AnimeToolbar";
import AnimeHero from "@/components/anime/AnimeHero";
import AnimeSettingsModal from "@/components/anime/AnimeSettingsModal";
import AnimeSkeleton, { PosterGridSkeleton } from "@/components/anime/AnimeSkeleton";
import {
  ANIME_CATALOGS,
  ANIME_GENRES,
  BROWSE_PAGE_SIZE,
  fetchBrowse,
  fetchCatalog,
  fetchCatalogPage,
  fetchMeta,
  searchCatalog,
} from "@/lib/anime/kitsu";
import { fetchStreams, rankStreams } from "@/lib/movies/torrentio";
import {
  animeProgress,
  getProgress,
  listInProgress,
  loadFavorites,
  loadRecents,
  loadWatched,
  markWatched,
  unmarkWatched,
  pushRecent,
  saveFavorites,
} from "@/lib/anime/progress";
import { getRealDebridApiKey } from "@/lib/settings";
import { loadAnimeFilters, saveAnimeFilters } from "@/lib/anime/prefs";
import type {
  CatalogItem,
  ContentType,
  EpisodeMeta,
  Meta,
  Stream,
  WatchProgress,
} from "@/lib/movies/types";
import { useFullWidth, useWide } from "@/lib/appLayout";
import { toast } from "@/lib/toast";
import { useMpvSupported } from "@/lib/player/platform";

const FOCUS_STORAGE_KEY = "mosaic.anime.focus";

// Module-level cache of the mapped catalog rails. Survives route changes (the
// page component unmounts when you navigate away), so returning to Anime renders
// the rails instantly from memory while we revalidate in the background — no
// loading flash. The per-URL localStorage cache (fetchJsonCached, 6h TTL) still
// governs whether revalidation actually hits the network.
let catalogMemoryCache: Map<string, CatalogItem[]> | null = null;

// Torrentio accepts Kitsu ids: `kitsu:<id>` for movies, `kitsu:<id>:<ep>` for a
// series episode (anime uses absolute episode numbering, no season segment).
function animeStreamId(catalogId: string, episode: number | null): string {
  return episode != null ? `kitsu:${catalogId}:${episode}` : `kitsu:${catalogId}`;
}

// Client-side type filter applied to rails / search results so the rails stay
// snappy (browse / "See all" grids filter type server-side instead).
function matchesType(it: CatalogItem, type: AnimeFilters["type"]): boolean {
  if (type === "movie" && it.type !== "movie") return false;
  if (type === "series" && it.type !== "series") return false;
  return true;
}

const ratingOf = (it: CatalogItem) =>
  it.imdbRating ? parseFloat(it.imdbRating) : 0;
const yearOf = (it: CatalogItem) =>
  it.releaseInfo ? parseInt(it.releaseInfo, 10) || 0 : 0;

// Client-side sort for the search grid (Kitsu text search returns relevance
// order; we reorder the small result set locally). The paginated browse /
// "See all" grids sort server-side instead, so this isn't used for them.
function sortCatalogItems(
  items: CatalogItem[],
  sort: AnimeFilters["sort"],
): CatalogItem[] {
  const arr = [...items];
  switch (sort) {
    case "top":
      return arr.sort((a, b) => ratingOf(b) - ratingOf(a));
    case "newest":
      return arr.sort((a, b) => yearOf(b) - yearOf(a));
    case "oldest":
      return arr.sort((a, b) => yearOf(a) - yearOf(b));
    case "az":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "za":
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    // "featured" / "popular": keep the search engine's relevance order.
    default:
      return items;
  }
}

export default function AnimePage() {
  const [filters, setFilters] = useState<AnimeFilters>(DEFAULT_ANIME_FILTERS);
  const [focusMode, setFocusMode] = useState(false);
  useFullWidth(focusMode);
  useWide(true);

  // Seed from the module cache so a revisit paints rails immediately.
  const [catalogs, setCatalogs] = useState<Map<string, CatalogItem[]>>(
    () => catalogMemoryCache ?? new Map(),
  );
  const [catalogLoading, setCatalogLoading] = useState(() => !catalogMemoryCache);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<CatalogItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Paginated grid — feeds two sources: the filter-driven "browse" (genre /
  // sort / type) and a single catalog rail's "See all" (`seeAll` holds its id).
  const [seeAll, setSeeAll] = useState<string | null>(null);
  const [browseItems, setBrowseItems] = useState<CatalogItem[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseOffset, setBrowseOffset] = useState(0);
  const [browseExhausted, setBrowseExhausted] = useState(false);

  const [rdToken, setRdToken] = useState<string | null>(null);
  const [rdLoaded, setRdLoaded] = useState(false);

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<{ id: string; type: ContentType; at: number }[]>([]);
  const [progressEntries, setProgressEntries] = useState<WatchProgress[]>([]);
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());

  const [active, setActive] = useState<CatalogItem | null>(null);
  const [activeMeta, setActiveMeta] = useState<Meta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [activeEpisode, setActiveEpisode] = useState<EpisodeMeta | null>(null);

  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [activeStreamIdx, setActiveStreamIdx] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mpvSupported = useMpvSupported();

  const browseActive =
    filters.genre != null || filters.sort !== "featured" || filters.type !== "all";
  const filtersActive = browseActive;
  // The paginated grid renders for either source: an open "See all", or any
  // active browse filter. `seeAll` wins so a rail's full view ignores filters.
  const gridActive = seeAll != null || browseActive;

  // Hide the app shell behind the transparent mpv layer while playing (same
  // mechanism as the Movies player — see globals.css `.mpv-overlay-open`).
  useEffect(() => {
    const on = playing && mpvSupported === true;
    document.body.classList.toggle("mpv-overlay-open", on);
    return () => document.body.classList.remove("mpv-overlay-open");
  }, [playing, mpvSupported]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the detail modal on Escape (when not in the player).
  useEffect(() => {
    if (!active || playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, playing]);

  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // Persisted prefs hydrate after mount (in an effect, not useState init, to
  // avoid an SSR/client hydration mismatch).
  const filtersRestoredRef = useRef(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(FOCUS_STORAGE_KEY) === "1") setFocusMode(true);
    } catch {
      /* ignore */
    }
    const savedFilters = loadAnimeFilters();
    if (savedFilters) setFilters((prev) => ({ ...prev, ...savedFilters }));
    filtersRestoredRef.current = true;
    setFavorites(loadFavorites());
    setRecents(loadRecents());
    setProgressEntries(listInProgress());
    setWatchedIds(loadWatched());
  }, []);

  // Persist browse filters (not search) whenever they change — after the
  // initial restore so we never clobber saved prefs with the defaults.
  useEffect(() => {
    if (!filtersRestoredRef.current) return;
    saveAnimeFilters({
      type: filters.type,
      genre: filters.genre,
      sort: filters.sort,
    });
  }, [filters.type, filters.genre, filters.sort]);

  // Deep-link resume from the Dashboard "Up next" rail: /anime?resume=<id>
  // where <id> is a Kitsu id ("12") or an episode key ("12:1:5").
  const resumeHandledRef = useRef(false);
  const pendingResumeRef = useRef<{ id: string; episode?: number } | null>(null);
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
    const prog = getProgress(raw);
    const parts = raw.split(":");
    const baseId = parts[0];
    const isEpisode = parts.length >= 3;
    const type: ContentType =
      isEpisode || prog?.type === "series" ? "series" : "movie";
    pendingResumeRef.current = isEpisode
      ? { id: raw, episode: Number(parts[2]) }
      : { id: raw };
    setActive({
      id: baseId,
      type,
      name: prog?.name ?? baseId,
      poster: prog?.poster ?? null,
    });
  }, []);

  // Real-Debrid token (Torrentio uses it for anime too).
  useEffect(() => {
    (async () => {
      try {
        setRdToken(await getRealDebridApiKey());
      } catch {
        setRdToken(null);
      } finally {
        setRdLoaded(true);
      }
    })();
  }, []);

  // Catalog rails — stale-while-revalidate. With a warm module cache we render
  // it immediately and revalidate silently in the background (no spinner); only
  // a truly cold start shows the loading skeleton.
  useEffect(() => {
    let cancelled = false;
    const hadCache = catalogMemoryCache != null;
    if (!hadCache) setCatalogLoading(true);
    setCatalogError(null);
    (async () => {
      try {
        const results = await Promise.allSettled(
          ANIME_CATALOGS.map((c) => fetchCatalog(c.id)),
        );
        if (cancelled) return;
        const next = new Map<string, CatalogItem[]>();
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next.set(ANIME_CATALOGS[i].id, r.value);
        });
        if (next.size > 0) {
          catalogMemoryCache = next;
          setCatalogs(next);
        } else if (!hadCache) {
          setCatalogError("Couldn't reach Kitsu.");
        }
      } catch (e) {
        // Keep showing cached rails on a background failure; only surface the
        // error when we have nothing to show.
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

  // One page of the active grid source. `offset` is the RAW Kitsu row offset
  // (not the filtered count) so pagination stays aligned even when movies are
  // dropped from a series view. Returns { items, raw }.
  const fetchGridPage = useCallback(
    (offset: number) =>
      seeAll
        ? fetchCatalogPage(
            seeAll,
            offset,
            // "Featured" keeps the rail's natural order; any other sort
            // re-orders the rail server-side.
            filters.sort === "featured" ? undefined : filters.sort,
          )
        : fetchBrowse({
            genre: filters.genre,
            type: filters.type,
            sort: filters.sort,
            offset,
          }),
    [seeAll, filters.genre, filters.type, filters.sort],
  );

  // (Re)fetch page 0 whenever the grid source changes (filters or `seeAll`).
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
  }, [
    browseLoading,
    browseLoadingMore,
    browseExhausted,
    browseOffset,
    fetchGridPage,
  ]);

  // Search (deferred).
  const deferredSearch = useDeferredValue(filters.search);
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
  }, [deferredSearch]);

  // Meta on pick. For series, preselect episode 1 (or the resumed episode).
  useEffect(() => {
    if (!active) {
      setActiveMeta(null);
      setActiveEpisode(null);
      setStreams([]);
      return;
    }
    let cancelled = false;
    setMetaLoading(true);
    setActiveMeta(null);
    setActiveEpisode(null);
    setStreams([]);
    setActiveStreamIdx(0);
    (async () => {
      try {
        const meta = await fetchMeta(active.id);
        if (cancelled) return;
        setActiveMeta(meta);
        if (active.type === "series" && meta?.videos?.length) {
          setActiveEpisode(meta.videos[0]);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Once meta loads for a resumed series, jump to the saved episode.
  useEffect(() => {
    const pend = pendingResumeRef.current;
    if (!pend?.episode || !activeMeta || active?.type !== "series") return;
    const ep = activeMeta.videos?.find((v) => v.episode === pend.episode);
    if (ep) setActiveEpisode(ep);
  }, [activeMeta, active]);

  // (Re)fetch streams whenever the target (movie id, or series episode) changes.
  useEffect(() => {
    if (!active || !rdLoaded) return;
    if (active.type === "series" && !activeEpisode) return;
    let cancelled = false;
    setStreamsLoading(true);
    setStreams([]);
    setActiveStreamIdx(0);
    (async () => {
      try {
        const list = await fetchStreams({
          // The episode is baked into imdbId; leave season/episode unset so
          // fetchStreams uses our kitsu:<id>[:ep] id verbatim.
          type: active.type,
          imdbId: animeStreamId(active.id, activeEpisode?.episode ?? null),
          rdToken,
        });
        if (cancelled) return;
        setStreams(rankStreams(list));
        setActiveStreamIdx(0);
      } catch (e) {
        if (!cancelled) toast("err", e instanceof Error ? e.message : "Streams failed");
      } finally {
        if (!cancelled) setStreamsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, activeEpisode, rdToken, rdLoaded]);

  // Finish a deep-link resume: auto-play once streams are ready.
  useEffect(() => {
    const pend = pendingResumeRef.current;
    if (!pend || streamsLoading || streams.length === 0) return;
    if (active?.type === "series") {
      if (!activeEpisode) return;
      if (pend.episode && activeEpisode.episode !== pend.episode) return;
    }
    pendingResumeRef.current = null;
    setPlaying(true);
  }, [streams, streamsLoading, active, activeEpisode]);

  const handlePick = useCallback((item: CatalogItem) => {
    setActive(item);
    setPlaying(false);
    pushRecent(item.id, item.type);
    setRecents(loadRecents());
  }, []);

  const closeActive = useCallback(() => {
    setActive(null);
    setPlaying(false);
  }, []);

  const updateFilters = useCallback((next: Partial<AnimeFilters>) => {
    // Type/genre define a browse query, so they take over the grid and close
    // any open "See all". Sort instead re-orders the current view in place
    // (including a See all rail), and search also keeps it.
    if ("type" in next || "genre" in next) setSeeAll(null);
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const clearFilters = useCallback(() => {
    setSeeAll(null);
    setFilters((prev) => ({ ...DEFAULT_ANIME_FILTERS, search: prev.search }));
  }, []);

  const openSeeAll = useCallback((catalogId: string) => {
    setSeeAll(catalogId);
    // Scroll back to the top so the grid header (sticky under the toolbar) is
    // in view instead of wherever the rail was.
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

  const onPickEpisode = useCallback((ep: EpisodeMeta) => {
    setActiveEpisode(ep);
    setPlaying(false);
  }, []);

  const onPlayMovie = useCallback(() => {
    if (streams.length === 0) {
      toast("err", "No playable stream yet");
      return;
    }
    setPlaying(true);
  }, [streams.length]);

  const onPickStream = useCallback((idx: number) => {
    setActiveStreamIdx(idx);
    setPlaying(true);
  }, []);

  const handlePlayerClose = useCallback(() => {
    setPlaying(false);
    setProgressEntries(listInProgress());
    setWatchedIds(loadWatched());
  }, []);

  const toggleEpisodeWatched = useCallback((ep: EpisodeMeta) => {
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ep.id)) {
        next.delete(ep.id);
        unmarkWatched(ep.id);
      } else {
        next.add(ep.id);
        markWatched(ep.id);
      }
      return next;
    });
  }, []);

  // --- derived rails -------------------------------------------------------
  const idsByItem = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const list of catalogs.values()) for (const it of list) map.set(it.id, it);
    for (const it of searchResults) map.set(it.id, it);
    for (const it of browseItems) map.set(it.id, it);
    return map;
  }, [catalogs, searchResults, browseItems]);

  const favoriteItems = useMemo(() => {
    const out: CatalogItem[] = [];
    for (const id of favorites) {
      const it = idsByItem.get(id);
      if (it) out.push(it);
    }
    return out;
  }, [favorites, idsByItem]);

  const recentItems = useMemo(() => {
    const out: CatalogItem[] = [];
    for (const r of recents) {
      const it = idsByItem.get(r.id);
      if (it) out.push(it);
    }
    return out;
  }, [recents, idsByItem]);

  const continueItems = useMemo<{
    item: CatalogItem;
    fraction: number;
    badge?: string;
  }[]>(() => {
    const out: { item: CatalogItem; fraction: number; badge?: string }[] = [];
    for (const p of progressEntries) {
      const baseId = p.seriesId ?? p.id.split(":")[0];
      const item =
        idsByItem.get(baseId) ??
        ({
          id: baseId,
          type: p.type,
          name: p.name,
          poster: p.poster ?? null,
        } as CatalogItem);
      const fraction = p.duration > 0 ? Math.min(0.99, p.position / p.duration) : 0;
      out.push({ item, fraction, badge: p.episodeLabel });
    }
    return out.slice(0, 24);
  }, [progressEntries, idsByItem]);

  const continueProgressMap = useMemo(() => {
    const m = new Map<string, { fraction: number; badge?: string }>();
    for (const c of continueItems) m.set(c.item.id, { fraction: c.fraction, badge: c.badge });
    return m;
  }, [continueItems]);

  const showSearch = deferredSearch.trim().length > 0;
  const activeStream = streams[activeStreamIdx] ?? null;

  // Episode keys with saved (unfinished) progress — drives the "in progress"
  // marker in the episode list. Watched (finished) episodes live in watchedIds.
  const inProgressEpisodeIds = useMemo(
    () => new Set(progressEntries.map((p) => p.id)),
    [progressEntries],
  );

  // Client-side type filter for the rails / search.
  const applyFilters = useCallback(
    (items: CatalogItem[]) => items.filter((it) => matchesType(it, filters.type)),
    [filters.type],
  );

  const filteredSearch = useMemo(
    () => sortCatalogItems(applyFilters(searchResults), filters.sort),
    [searchResults, applyFilters, filters.sort],
  );
  // Browse / "See all" items are already filtered + sorted server-side.
  const filteredBrowse = browseItems;

  // Hero spotlight — top trending titles (fall back to most-popular).
  const heroItems = useMemo(
    () => catalogs.get("trending") ?? catalogs.get("popular") ?? [],
    [catalogs],
  );

  const gridTitle = useMemo(() => {
    // "See all" of a single rail uses that rail's name verbatim.
    if (seeAll) {
      return ANIME_CATALOGS.find((c) => c.id === seeAll)?.name ?? "All anime";
    }
    const g = filters.genre
      ? ANIME_GENRES.find((x) => x.slug === filters.genre)?.label ?? filters.genre
      : null;
    const typeLabel =
      filters.type === "movie" ? "Movies" : filters.type === "series" ? "Series" : "Anime";
    const sortLabel =
      filters.sort === "top"
        ? "Top rated"
        : filters.sort === "newest"
          ? "Newest"
          : filters.sort === "popular"
            ? "Most popular"
            : null;
    return [g, typeLabel, sortLabel && `· ${sortLabel}`].filter(Boolean).join(" ");
  }, [seeAll, filters.genre, filters.type, filters.sort]);

  const resultCount = showSearch
    ? filteredSearch.length
    : gridActive
      ? filteredBrowse.length
      : undefined;

  const progressKey = useMemo(() => {
    if (!active) return "";
    if (active.type === "movie") return active.id;
    if (activeEpisode) return activeEpisode.id; // `${id}:1:${ep}`
    return active.id;
  }, [active, activeEpisode]);

  const playerTitle = useMemo(() => {
    if (!active) return "";
    if (active.type === "series" && activeEpisode) {
      const epName = activeEpisode.name ?? activeEpisode.title;
      return `${active.name} — E${activeEpisode.episode}${epName ? " · " + epName : ""}`;
    }
    return active.name;
  }, [active, activeEpisode]);

  const playerSubtitle = useMemo(() => {
    if (!active) return "";
    return [activeMeta?.releaseInfo ?? active.releaseInfo, activeStream?.quality]
      .filter(Boolean)
      .join(" · ");
  }, [active, activeMeta, activeStream]);

  const containerCls =
    "h-screen flex flex-col bg-[var(--background)] overflow-hidden";

  return (
    <div className={containerCls}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <AnimeToolbar
          filters={filters}
          onChange={updateFilters}
          focusMode={focusMode}
          onToggleFocus={toggleFocus}
          onOpenSettings={() => setSettingsOpen(true)}
          resultCount={resultCount}
          filtersActive={filtersActive}
          onClear={clearFilters}
        />

        <div className="px-4 md:px-6 py-5 md:py-8 space-y-10">
          {catalogError && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-center text-sm text-rose-300">
              Failed to load anime: {catalogError}
            </div>
          )}

          {showSearch ? (
            <MediaGridView
              title={`Results for “${deferredSearch.trim()}”`}
              items={filteredSearch}
              getKey={(item) => item.id}
              loading={searchLoading}
              emptyLabel={`No anime match “${deferredSearch.trim()}”.`}
              renderItem={(item) => (
                <PosterCard
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
              <PosterGridSkeleton />
            ) : filteredBrowse.length > 0 ? (
              <CatalogGridView
                title={gridTitle}
                items={filteredBrowse}
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
                <p className="text-sm">No anime match these filters.</p>
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
            <AnimeSkeleton />
          ) : (
            <>
              {!catalogError && heroItems.length > 0 && (
                <AnimeHero
                  items={heroItems}
                  onPlay={handlePick}
                  onInfo={handlePick}
                  favorites={favorites}
                  onToggleFavorite={toggleFavorite}
                />
              )}
              <div className="space-y-5">
                <GenreCards
                  genres={ANIME_GENRES.map((g) => ({
                    value: g.slug,
                    label: g.label,
                  }))}
                  active={filters.genre}
                  onPick={(slug) => updateFilters({ genre: slug })}
                />
                {continueItems.length > 0 && (
                  <PosterRail
                    title="Continue watching"
                    items={applyFilters(continueItems.map((c) => c.item))}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                    progressById={continueProgressMap}
                  />
                )}
                {favoriteItems.length > 0 && (
                  <PosterRail
                    title="Favorites"
                    items={applyFilters(favoriteItems)}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                  />
                )}
                {recentItems.length > 0 && (
                  <PosterRail
                    title="Recently watched"
                    items={applyFilters(recentItems)}
                    activeId={active?.id ?? null}
                    favorites={favorites}
                    onPick={handlePick}
                    onToggleFavorite={toggleFavorite}
                  />
                )}
                {ANIME_CATALOGS.map((c) => {
                  const list = catalogs.get(c.id);
                  if (!list || list.length === 0) return null;
                  return (
                    <PosterRail
                      key={c.id}
                      title={c.name}
                      items={applyFilters(list)}
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

      <AnimeSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDataChanged={() => {
          setFavorites(loadFavorites());
          setRecents(loadRecents());
          setProgressEntries(listInProgress());
          setWatchedIds(loadWatched());
        }}
      />

      {mounted &&
        active &&
        createPortal(
          playing && activeStream ? (
            <div
              data-player-fullscreen-keep
              className="fixed inset-0 z-[1000]"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: mpvSupported ? "transparent" : "#000",
              }}
            >
              <MoviePlayer
                title={playerTitle}
                subtitle={playerSubtitle}
                stream={activeStream}
                subtitleSearchId={progressKey}
                progressKey={progressKey}
                progressType={active.type}
                persistPoster={active.poster ?? null}
                persistEpisodeLabel={
                  active.type === "series" && activeEpisode
                    ? `E${activeEpisode.episode}`
                    : undefined
                }
                persistSeriesId={active.type === "series" ? active.id : undefined}
                isFavorite={favorites.has(active.id)}
                onToggleFavorite={() => toggleFavorite(active.id)}
                onClose={handlePlayerClose}
                streamCount={streams.length}
                streamIndex={activeStreamIdx}
                store={animeProgress}
                onTryNextStream={() => {
                  if (activeStreamIdx + 1 < streams.length) {
                    setActiveStreamIdx(activeStreamIdx + 1);
                    return true;
                  }
                  return false;
                }}
              />
            </div>
          ) : (
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
                <TitleDetail
                  item={active}
                  meta={activeMeta}
                  metaLoading={metaLoading}
                  streams={streams}
                  streamsLoading={streamsLoading}
                  activeStreamIndex={activeStreamIdx}
                  onPickStream={onPickStream}
                  onPlay={onPlayMovie}
                  selectedSeason={activeEpisode?.season ?? null}
                  selectedEpisode={activeEpisode}
                  // Selecting an episode only loads its streams into the
                  // sidebar — playback starts when the user picks a stream.
                  onPickEpisode={onPickEpisode}
                  watchedEpisodeIds={watchedIds}
                  inProgressEpisodeIds={inProgressEpisodeIds}
                  onToggleWatched={toggleEpisodeWatched}
                  isFavorite={favorites.has(active.id)}
                  onToggleFavorite={() => toggleFavorite(active.id)}
                />
                {getProgress(progressKey) && (
                  <div className="text-[11.5px] text-neutral-400 px-4 py-2 bg-black/60 border-t border-white/5">
                    Will resume where you left off.
                  </div>
                )}
              </div>
            </div>
          ),
          document.body,
        )}
    </div>
  );
}
