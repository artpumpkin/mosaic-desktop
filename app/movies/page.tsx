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
import { X } from "lucide-react";

import MoviesToolbar, {
  type MoviesFilters,
  type MovieType,
  DEFAULT_MOVIES_CATALOG,
} from "@/components/movies/MoviesToolbar";
import PosterRail from "@/components/movies/PosterRail";
import CatalogGridView from "@/components/movies/CatalogGridView";
import TitleDetail from "@/components/movies/TitleDetail";
import MoviePlayer from "@/components/movies/MoviePlayer";
import MoviesSettingsModal from "@/components/movies/MoviesSettingsModal";
import MediaHero from "@/components/browse/MediaHero";
import GenreCards from "@/components/browse/GenreCards";
import MediaHomeSkeleton, {
  PosterGridSkeleton,
} from "@/components/browse/MediaHomeSkeleton";
import {
  CATALOG_PAGE_SIZE,
  CINEMETA_CATALOGS,
  CINEMETA_GENRES,
  HOME_GENRES,
  fetchCatalog,
  fetchCatalogPages,
  fetchMeta,
  searchCatalog,
} from "@/lib/movies/cinemeta";
import { fetchStreams, rankStreams } from "@/lib/movies/torrentio";
import {
  getProgress,
  listInProgress,
  loadFavorites,
  loadRecents,
  pushRecent,
  saveFavorites,
} from "@/lib/movies/progress";
import { getRealDebridApiKey } from "@/lib/settings";
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

const INITIAL_FILTERS: MoviesFilters = {
  type: "all",
  catalogId: "top",
  genre: null,
  search: "",
};

const FOCUS_STORAGE_KEY = "mosaic.movies.focus";

// Module-level (per-session) caches. The page component unmounts when you
// navigate away — refs die with it, which is why Movies flashed the skeleton on
// every revisit. Module state survives route changes, so returning to Movies
// paints rails instantly from memory and revalidates silently in the background.
type CatalogSnapshot = {
  catalogs: Map<string, CatalogItem[]>;
  pages: Map<string, number>;
  exhausted: Set<string>;
};
// Keyed by `${type}|${genre || ""}`.
const moviesCatalogCache = new Map<string, CatalogSnapshot>();
// Genre rails keyed by content type.
const moviesGenreRailsCache = new Map<string, Map<string, CatalogItem[]>>();

const initialCatalogKey = `${INITIAL_FILTERS.type}|${INITIAL_FILTERS.genre ?? ""}`;

// Home rails are horizontal previews — cap how many cards each renders so the
// page DOM stays light (otherwise 3 catalog + 6 genre rails × ~100 items each
// = thousands of poster cards, which makes vertical scrolling janky). The full
// list is still reachable via each rail's "See all".
const RAIL_PREVIEW = 24;

// Which Cinemeta content types a filter selection maps to. "all" fans out to
// both; otherwise just the one. Cinemeta has no combined endpoint, so "all"
// fetches both types per catalog/genre and we merge below.
function typesFor(type: MovieType): ContentType[] {
  return type === "all" ? ["movie", "series"] : [type];
}

// Interleave several already-ordered lists round-robin so an "all" rail mixes
// movies and series instead of showing all movies then all series. Dedups by id.
function interleave(lists: CatalogItem[][]): CatalogItem[] {
  const out: CatalogItem[] = [];
  const seen = new Set<string>();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      const it = list[i];
      if (it && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    }
  }
  return out;
}

export default function MoviesPage() {
  const [filters, setFilters] = useState<MoviesFilters>(INITIAL_FILTERS);
  const [focusMode, setFocusMode] = useState(false);
  useFullWidth(focusMode);
  useWide(true);

  // Seed from the module cache so a revisit paints rails immediately (no flash).
  const [catalogs, setCatalogs] = useState<Map<string, CatalogItem[]>>(
    () => moviesCatalogCache.get(initialCatalogKey)?.catalogs ?? new Map(),
  );
  const [catalogLoading, setCatalogLoading] = useState(
    () => !moviesCatalogCache.has(initialCatalogKey),
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Tracks how many pages we've already loaded per catalog id so "Load more"
  // can fetch the next page without re-fetching what's already on screen.
  const [catalogPages, setCatalogPages] = useState<Map<string, number>>(
    () => moviesCatalogCache.get(initialCatalogKey)?.pages ?? new Map(),
  );
  // Set of catalog ids that have returned an empty page → no more results.
  const [exhausted, setExhausted] = useState<Set<string>>(
    () => moviesCatalogCache.get(initialCatalogKey)?.exhausted ?? new Set(),
  );
  const [loadingMoreId, setLoadingMoreId] = useState<string | null>(null);

  // Genre rails (Netflix-style): one horizontal rail per Cinemeta genre on the
  // resting home view, below the catalog rails. Keyed by genre slug. Cached per
  // content type so flipping Movies/Series repaints instantly.
  const [genreRails, setGenreRails] = useState<Map<string, CatalogItem[]>>(
    () => moviesGenreRailsCache.get(INITIAL_FILTERS.type) ?? new Map(),
  );

  // When set, the catalog rails are hidden and we render the full-grid view
  // for that catalog with infinite scroll (the Stremio "See all" pattern).
  const [seeAllCatalogId, setSeeAllCatalogId] = useState<string | null>(null);

  const INITIAL_PAGES = 3;

  const [searchResults, setSearchResults] = useState<CatalogItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [rdToken, setRdToken] = useState<string | null>(null);
  const [rdLoaded, setRdLoaded] = useState(false);

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<{ id: string; type: ContentType; at: number }[]>([]);
  const [progressEntries, setProgressEntries] = useState<WatchProgress[]>([]);

  // Active title: when the user clicks a poster, we load meta + streams
  // and show the TitleDetail panel.
  const [active, setActive] = useState<CatalogItem | null>(null);
  const [activeMeta, setActiveMeta] = useState<Meta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  // For series: currently selected episode (drives stream lookup).
  const [activeEpisode, setActiveEpisode] = useState<EpisodeMeta | null>(null);

  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [activeStreamIdx, setActiveStreamIdx] = useState(0);

  // When the user hits Play, we mount the MoviePlayer overlay.
  const [playing, setPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mpvSupported = useMpvSupported();

  // The player overlay is portaled to <body>, so on the mpv path the app
  // shell (sidebar + main) paints behind the transparent video stage and
  // would cover the native mpv layer. While the mpv player is open we add a
  // body class that hides every direct body child that doesn't contain the
  // player (see globals.css). Unlike the plugin's `player-fullscreen`, this
  // does NOT promote the video element to fill the screen, so the player's
  // own title bar / footer chrome stay intact.
  useEffect(() => {
    const on = playing && mpvSupported === true;
    document.body.classList.toggle("mpv-overlay-open", on);
    return () => document.body.classList.remove("mpv-overlay-open");
  }, [playing, mpvSupported]);

  // Track first mount so the SSR markup matches the client (avoids hydration
  // warnings when we conditionally render a portal).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the active title modal on Escape (only when not in the player).
  useEffect(() => {
    if (!active || playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, playing]);

  // Lock body scroll while the modal/player overlay is mounted.
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);

  // Persisted prefs hydrate after mount.
  useEffect(() => {
    try {
      if (localStorage.getItem(FOCUS_STORAGE_KEY) === "1") setFocusMode(true);
    } catch {
      /* ignore */
    }
    setFavorites(loadFavorites());
    setRecents(loadRecents());
    setProgressEntries(listInProgress());
  }, []);

  // Deep-link resume from the Dashboard "Up next" rail: /movies?resume=<id>
  // where <id> is an IMDb id ("tt…") or an episode key ("tt…:S:E"). We open
  // the title, target the right episode once meta loads, then auto-play once
  // streams resolve. The MoviePlayer itself restores the saved position via
  // its progressKey (getProgress), so we only need to drive the open+play.
  const resumeHandledRef = useRef(false);
  const pendingResumeRef = useRef<{
    id: string;
    season?: number;
    episode?: number;
  } | null>(null);
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
      ? { id: raw, season: Number(parts[1]), episode: Number(parts[2]) }
      : { id: raw };
    setActive({
      id: baseId,
      type,
      name: prog?.name ?? baseId,
      poster: prog?.poster ?? null,
    });
  }, []);

  // Once meta is available for a resumed series, jump to the saved episode
  // (the meta effect otherwise auto-picks S1E1).
  useEffect(() => {
    const pend = pendingResumeRef.current;
    if (!pend?.season || !activeMeta || active?.type !== "series") return;
    const ep = activeMeta.videos?.find(
      (v) => v.season === pend.season && v.episode === pend.episode,
    );
    if (ep) setActiveEpisode(ep);
  }, [activeMeta, active]);

  // Load Real-Debrid token from settings on mount.
  useEffect(() => {
    (async () => {
      try {
        const t = await getRealDebridApiKey();
        setRdToken(t);
      } catch {
        setRdToken(null);
      } finally {
        setRdLoaded(true);
      }
    })();
  }, []);

  // Catalog rails: load (Popular | year | imdbRating) for the current type +
  // genre. We keep an in-memory snapshot per (type, genre) so flipping
  // between Movies/Series or genres feels instant — the cached rails show
  // immediately and we revalidate in the background.
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${filters.type}|${filters.genre ?? ""}`;
    const cached = moviesCatalogCache.get(cacheKey);

    if (cached) {
      // Show cached snapshot instantly — no skeleton, no flash.
      setCatalogs(cached.catalogs);
      setCatalogPages(cached.pages);
      setExhausted(cached.exhausted);
      setCatalogLoading(false);
    } else {
      // First visit for this (type, genre) — show the loading state.
      setCatalogLoading(true);
      setCatalogs(new Map());
      setCatalogPages(new Map());
      setExhausted(new Set());
    }
    setCatalogError(null);
    // Exit any "See all" grid when the user changes type/genre so they aren't
    // staring at a stale title list.
    setSeeAllCatalogId(null);

    (async () => {
      try {
        const types = typesFor(filters.type);
        const results = await Promise.allSettled(
          CINEMETA_CATALOGS.map((c) =>
            Promise.all(
              types.map((t) =>
                fetchCatalogPages(
                  { type: t, catalogId: c.id, genre: filters.genre },
                  INITIAL_PAGES,
                ),
              ),
            ).then((lists) => interleave(lists)),
          ),
        );
        if (cancelled) return;
        const next = new Map<string, CatalogItem[]>();
        const pages = new Map<string, number>();
        results.forEach((r, i) => {
          if (r.status === "fulfilled") {
            next.set(CINEMETA_CATALOGS[i].id, r.value);
            pages.set(CINEMETA_CATALOGS[i].id, INITIAL_PAGES);
          }
        });
        setCatalogs(next);
        setCatalogPages(pages);
        // Persist the fresh snapshot so subsequent visits skip the spinner.
        moviesCatalogCache.set(cacheKey, {
          catalogs: next,
          pages,
          exhausted: new Set(),
        });
      } catch (e) {
        if (!cancelled)
          setCatalogError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters.type, filters.genre]);

  // Genre rails for the resting home view — one `top` catalog fetch per genre,
  // genre-filtered. Cached per type so Movies↔Series flips are instant. Always
  // loaded (cheap, parallel) so they're ready when filters clear back to home;
  // rails with no results are skipped at render time.
  useEffect(() => {
    let cancelled = false;
    const cached = moviesGenreRailsCache.get(filters.type);
    setGenreRails(cached ?? new Map());
    (async () => {
      try {
        const types = typesFor(filters.type);
        const results = await Promise.allSettled(
          HOME_GENRES.map((g) =>
            Promise.all(
              types.map((t) =>
                fetchCatalog({
                  type: t,
                  catalogId: DEFAULT_MOVIES_CATALOG,
                  genre: g,
                }),
              ),
            ).then((lists) => interleave(lists)),
          ),
        );
        if (cancelled) return;
        const next = new Map<string, CatalogItem[]>();
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value.length > 0)
            next.set(HOME_GENRES[i], r.value);
        });
        setGenreRails(next);
        moviesGenreRailsCache.set(filters.type, next);
      } catch {
        /* soft fail — home just shows fewer rails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters.type]);

  // Fetch the next page for a specific catalog. Cinemeta's `skip` paginates
  // at CATALOG_PAGE_SIZE (~100) per step; we append and dedup by id, and
  // mirror the update into the in-memory snapshot so subsequent (type,
  // genre) switches restore the user's scroll progress.
  const loadMore = useCallback(
    async (catalogId: string) => {
      if (loadingMoreId || exhausted.has(catalogId)) return;
      const loadedPages = catalogPages.get(catalogId) ?? 0;
      const cacheKey = `${filters.type}|${filters.genre ?? ""}`;
      setLoadingMoreId(catalogId);
      try {
        const types = typesFor(filters.type);
        const lists = await Promise.all(
          types.map((t) =>
            fetchCatalog({
              type: t,
              catalogId,
              genre: filters.genre,
              skip: loadedPages * CATALOG_PAGE_SIZE,
            }),
          ),
        );
        const next = interleave(lists);
        if (next.length === 0) {
          setExhausted((prev) => {
            const updated = new Set(prev).add(catalogId);
            const snap = moviesCatalogCache.get(cacheKey);
            if (snap) snap.exhausted = updated;
            return updated;
          });
          return;
        }
        setCatalogs((prev) => {
          const out = new Map(prev);
          const existing = out.get(catalogId) ?? [];
          const ids = new Set(existing.map((it) => it.id));
          const merged = [...existing];
          for (const it of next) {
            if (!ids.has(it.id)) merged.push(it);
          }
          out.set(catalogId, merged);
          const snap = moviesCatalogCache.get(cacheKey);
          if (snap) snap.catalogs = out;
          return out;
        });
        setCatalogPages((prev) => {
          const out = new Map(prev);
          out.set(catalogId, loadedPages + 1);
          const snap = moviesCatalogCache.get(cacheKey);
          if (snap) snap.pages = out;
          return out;
        });
      } catch {
        // soft fail — the user can retry the click
      } finally {
        setLoadingMoreId(null);
      }
    },
    [filters.type, filters.genre, catalogPages, exhausted, loadingMoreId],
  );

  // Search: deferred to avoid hammering the addon while the user types.
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
        const types = typesFor(filters.type);
        const lists = await Promise.all(types.map((t) => searchCatalog(t, q)));
        if (!cancelled) setSearchResults(interleave(lists));
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deferredSearch, filters.type]);

  // When a title is picked, load meta. For series we then preload streams
  // for episode 1 of season 1 if available.
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
        const meta = await fetchMeta(active.type, active.id);
        if (cancelled) return;
        setActiveMeta(meta);
        if (active.type === "series" && meta?.videos?.length) {
          const firstEp = [...meta.videos]
            .filter((v) => v.season > 0 && v.episode > 0)
            .sort((a, b) =>
              a.season === b.season ? a.episode - b.episode : a.season - b.season,
            )[0];
          if (firstEp) setActiveEpisode(firstEp);
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Whenever the targeted stream key changes (movie id, or series episode),
  // (re)fetch the stream list and auto-pick the best one.
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
          type: active.type,
          imdbId: active.id,
          rdToken,
          season: activeEpisode?.season,
          episode: activeEpisode?.episode,
        });
        if (cancelled) return;
        // rankStreams dedupes, drops dead/fake sources, and orders by a
        // composite quality score — so the best source is simply index 0.
        const ranked = rankStreams(list);
        setStreams(ranked);
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

  // Finish a deep-link resume: once streams for the targeted title/episode are
  // ranked and ready, start playback. For series we wait until the episode the
  // link asked for is the active one (the episode-targeting effect above).
  useEffect(() => {
    const pend = pendingResumeRef.current;
    if (!pend || streamsLoading || streams.length === 0) return;
    if (active?.type === "series") {
      if (!activeEpisode) return;
      if (
        pend.season &&
        (activeEpisode.season !== pend.season ||
          activeEpisode.episode !== pend.episode)
      )
        return;
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

  // When the user picks an episode in TitleDetail.
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

  // Picking a stream starts playback immediately (no separate Play press).
  const onPickStream = useCallback((idx: number) => {
    setActiveStreamIdx(idx);
    setPlaying(true);
  }, []);

  // Reflect last save back into the UI when the player unmounts.
  const playerCloseRef = useRef<() => void>(() => undefined);
  playerCloseRef.current = () => {
    setPlaying(false);
    setProgressEntries(listInProgress());
  };

  // --- Derived rail data ---------------------------------------------------

  const idsByItem = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const list of catalogs.values()) for (const it of list) map.set(it.id, it);
    for (const list of genreRails.values()) for (const it of list) map.set(it.id, it);
    for (const it of searchResults) map.set(it.id, it);
    return map;
  }, [catalogs, genreRails, searchResults]);

  const favoriteItems = useMemo(() => {
    const out: CatalogItem[] = [];
    for (const id of favorites) {
      const it = idsByItem.get(id);
      if (it && (filters.type === "all" || it.type === filters.type)) out.push(it);
    }
    return out;
  }, [favorites, idsByItem, filters.type]);

  const recentItems = useMemo(() => {
    const out: CatalogItem[] = [];
    for (const r of recents) {
      if (filters.type !== "all" && r.type !== filters.type) continue;
      const it = idsByItem.get(r.id);
      if (it) out.push(it);
    }
    return out;
  }, [recents, idsByItem, filters.type]);

  // Continue-watching: for series progress on "tt…:S:E" we surface the
  // underlying show poster + an episode badge.
  const continueItems = useMemo<{
    item: CatalogItem;
    fraction: number;
    badge?: string;
  }[]>(() => {
    const out: { item: CatalogItem; fraction: number; badge?: string }[] = [];
    for (const p of progressEntries) {
      if (filters.type !== "all" && p.type !== filters.type) continue;
      const baseId = p.seriesId ?? p.id.split(":")[0];
      const item =
        idsByItem.get(baseId) ??
        ({
          id: baseId,
          type: p.type,
          name: p.name,
          poster: p.poster ?? null,
        } as CatalogItem);
      const fraction =
        p.duration > 0 ? Math.min(0.99, p.position / p.duration) : 0;
      out.push({ item, fraction, badge: p.episodeLabel });
    }
    return out.slice(0, 24);
  }, [progressEntries, idsByItem, filters.type]);

  const continueProgressMap = useMemo(() => {
    const m = new Map<string, { fraction: number; badge?: string }>();
    for (const c of continueItems) {
      m.set(c.item.id, { fraction: c.fraction, badge: c.badge });
    }
    return m;
  }, [continueItems]);

  const showSearch = deferredSearch.trim().length > 0;
  const torrentFallback = rdLoaded && !rdToken;

  // Browse mode mirrors the Anime section: when a genre is picked or the
  // sort/catalog is changed off its default, swap the multi-rail home for a
  // single infinite-scroll grid of that catalog (already loaded with the genre
  // applied by the catalog effect). The hero + rails are the resting state.
  const browseActive =
    filters.genre != null || filters.catalogId !== DEFAULT_MOVIES_CATALOG;
  const filtersActive = browseActive;
  const clearFilters = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      genre: null,
      catalogId: DEFAULT_MOVIES_CATALOG,
    }));
  }, []);

  // Hero spotlight draws from the most-popular catalog (with backdrops).
  const heroItems = useMemo(
    () => catalogs.get(DEFAULT_MOVIES_CATALOG) ?? [],
    [catalogs],
  );
  // The catalog the browse grid renders (already genre-filtered by the effect).
  const browseList = useMemo(
    () => catalogs.get(filters.catalogId) ?? [],
    [catalogs, filters.catalogId],
  );
  const browseCatalogName = useMemo(
    () =>
      CINEMETA_CATALOGS.find((c) => c.id === filters.catalogId)?.name ??
      "Movies",
    [filters.catalogId],
  );

  const totalCount = useMemo(() => {
    if (showSearch) return searchResults.length;
    let n = 0;
    for (const list of catalogs.values()) n += list.length;
    return n;
  }, [showSearch, searchResults.length, catalogs]);

  // Active stream + persistence keys used by the MoviePlayer.
  const activeStream = streams[activeStreamIdx] ?? null;

  const progressKey = useMemo(() => {
    if (!active) return "";
    if (active.type === "movie") return active.id;
    if (activeEpisode)
      return `${active.id}:${activeEpisode.season}:${activeEpisode.episode}`;
    return active.id;
  }, [active, activeEpisode]);

  const playerTitle = useMemo(() => {
    if (!active) return "";
    if (active.type === "series" && activeEpisode) {
      const epName = activeEpisode.name ?? activeEpisode.title;
      const tag = `S${activeEpisode.season}·E${activeEpisode.episode}`;
      return `${active.name} — ${tag}${epName ? " · " + epName : ""}`;
    }
    return active.name;
  }, [active, activeEpisode]);

  const playerSubtitle = useMemo(() => {
    if (!active) return "";
    const parts = [
      activeMeta?.releaseInfo ?? active.releaseInfo,
      activeMeta?.runtime ?? active.runtime,
      activeStream?.quality,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [active, activeMeta, activeStream]);

  // Container styling mirrors the TV page so we break out of AppShell's
  // padded box in default mode and lock to viewport in focus mode. Both
  // modes pin the outer chrome to viewport height so the inner scroll
  // owns the single scrollbar — that way the sticky MoviesToolbar (now
  // inside the scroll context) reliably stays at the top as the user
  // scrolls through rails or the catalog grid.
  const containerCls =
    "h-screen flex flex-col bg-[var(--background)] overflow-hidden";

  return (
    <div className={containerCls}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MoviesToolbar
          filters={filters}
          onChange={(p) => setFilters((prev) => ({ ...prev, ...p }))}
          focusMode={focusMode}
          onToggleFocus={toggleFocus}
          onOpenSettings={() => setSettingsOpen(true)}
          resultCount={totalCount}
          torrentFallback={torrentFallback}
          onClear={clearFilters}
          filtersActive={filtersActive}
        />

        <div className="px-4 md:px-6 py-5 md:py-8 space-y-10">
        {/* Status messages */}
        {catalogError && (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5 text-center text-sm text-rose-300">
            Failed to load catalog: {catalogError}
          </div>
        )}

        {/* Rails / grid view */}
        {showSearch ? (
          <PosterRail
            title={`Results for "${deferredSearch.trim()}"`}
            items={searchResults}
            activeId={active?.id ?? null}
            favorites={favorites}
            onPick={handlePick}
            onToggleFavorite={toggleFavorite}
          />
        ) : seeAllCatalogId ? (
          (() => {
            const cat =
              CINEMETA_CATALOGS.find((c) => c.id === seeAllCatalogId) ??
              CINEMETA_CATALOGS[0];
            const list = catalogs.get(cat.id) ?? [];
            return (
              <CatalogGridView
                title={cat.name}
                items={list}
                activeId={active?.id ?? null}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
                onBack={() => setSeeAllCatalogId(null)}
                hasMore={!exhausted.has(cat.id)}
                loadingMore={loadingMoreId === cat.id}
                onLoadMore={() => loadMore(cat.id)}
              />
            );
          })()
        ) : catalogLoading && catalogs.size === 0 ? (
          <MediaHomeSkeleton />
        ) : browseActive ? (
          browseList.length === 0 && catalogLoading ? (
            <PosterGridSkeleton />
          ) : (
            <CatalogGridView
              title={
                filters.genre
                  ? `${browseCatalogName} · ${filters.genre}`
                  : browseCatalogName
              }
              items={browseList}
              activeId={active?.id ?? null}
              favorites={favorites}
              onPick={handlePick}
              onToggleFavorite={toggleFavorite}
              onBack={clearFilters}
              hasMore={!exhausted.has(filters.catalogId)}
              loadingMore={loadingMoreId === filters.catalogId}
              onLoadMore={() => loadMore(filters.catalogId)}
            />
          )
        ) : (
          <div className="space-y-5">
            {heroItems.length > 0 && (
              <MediaHero
                items={heroItems}
                onPlay={handlePick}
                onInfo={handlePick}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
              />
            )}
            <GenreCards
              genres={CINEMETA_GENRES.map((g) => ({ value: g, label: g }))}
              onPick={(g) =>
                setFilters((prev) => ({
                  ...prev,
                  genre: g,
                  catalogId: DEFAULT_MOVIES_CATALOG,
                }))
              }
            />
            {continueItems.length > 0 && (
              <PosterRail
                title="Continue watching"
                items={continueItems.map((c) => c.item)}
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
                items={favoriteItems}
                activeId={active?.id ?? null}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {recentItems.length > 0 && (
              <PosterRail
                title="Recently picked"
                items={recentItems}
                activeId={active?.id ?? null}
                favorites={favorites}
                onPick={handlePick}
                onToggleFavorite={toggleFavorite}
              />
            )}
            {CINEMETA_CATALOGS.map((c) => {
              const list = catalogs.get(c.id);
              if (!list || list.length === 0) return null;
              return (
                <PosterRail
                  key={c.id}
                  title={c.name}
                  count={list.length}
                  items={list.slice(0, RAIL_PREVIEW)}
                  activeId={active?.id ?? null}
                  favorites={favorites}
                  onPick={handlePick}
                  onToggleFavorite={toggleFavorite}
                  onSeeAll={() => setSeeAllCatalogId(c.id)}
                />
              );
            })}
            {/* Netflix-style genre rails. "See all" sets the genre filter,
                which the catalog effect reloads as a single infinite-scroll
                grid (the existing browse path). */}
            {HOME_GENRES.map((g) => {
              const list = genreRails.get(g);
              if (!list || list.length === 0) return null;
              return (
                <PosterRail
                  key={`genre-${g}`}
                  title={g}
                  count={list.length}
                  items={list.slice(0, RAIL_PREVIEW)}
                  activeId={active?.id ?? null}
                  favorites={favorites}
                  onPick={handlePick}
                  onToggleFavorite={toggleFavorite}
                  onSeeAll={() =>
                    setFilters((prev) => ({
                      ...prev,
                      genre: g,
                      catalogId: DEFAULT_MOVIES_CATALOG,
                    }))
                  }
                />
              );
            })}
          </div>
        )}

        </div>
      </div>

      <MoviesSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDataChanged={() => {
          setFavorites(loadFavorites());
          setRecents(loadRecents());
          setProgressEntries(listInProgress());
        }}
      />

      {mounted && active && createPortal(
        playing && activeStream ? (
          <div
            // Mark the whole player portal as "keep visible" under the
            // `mpv-overlay-open` body rule (globals.css). That rule hides every
            // direct <body> child that doesn't contain a [data-player-fullscreen-keep]
            // element — and that marker otherwise only appears on the mpv
            // surface, which mounts LATE (after torrent_start resolves the
            // magnet). Without this attribute the entire portal — title bar AND
            // the "Loading magnet…" overlay — is display:none during the whole
            // magnet-loading window, which is the black screen on play.
            data-player-fullscreen-keep
            // Belt + suspenders: Tailwind utilities AND inline styles, so even
            // if a parent has a CSS transform/filter that hijacks `position:
            // fixed`, the inline `position: fixed` on the actual rendered
            // node still anchors to the viewport. Without this the page rails
            // were peeking through above the player on first paint.
            className="fixed inset-0 z-[1000]"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1000,
              // Transparent on the mpv path so the native video layer shows
              // through the stage hole (the app shell behind is hidden via
              // the `mpv-overlay-open` body class); opaque black otherwise.
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
                  ? `S${activeEpisode.season} · E${activeEpisode.episode}`
                  : undefined
              }
              persistSeriesId={active.type === "series" ? active.id : undefined}
              isFavorite={favorites.has(active.id)}
              onToggleFavorite={() => toggleFavorite(active.id)}
              onClose={() => playerCloseRef.current()}
              streamCount={streams.length}
              streamIndex={activeStreamIdx}
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
                onPickEpisode={(ep) => {
                  onPickEpisode(ep);
                  // For series, picking an episode means the user wants to play.
                  // Wait for streams to load then auto-play.
                  requestAnimationFrame(() => setPlaying(true));
                }}
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
