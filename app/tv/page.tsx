"use client";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ChannelRail from "@/components/tv/ChannelRail";
import ChannelFilters from "@/components/tv/ChannelFilters";
import ChannelsList from "@/components/tv/ChannelsList";
import TopToolbar, { type TvFilters } from "@/components/tv/TopToolbar";
import TVPlayer, { type ScopeOption } from "@/components/tv/TVPlayer";
import TvPlaylistsModal from "@/components/tv/TvPlaylistsModal";
import {
  loadTvData,
  refreshTvData,
  indexStreamsByChannel,
  indexLogosByChannel,
} from "@/lib/tv/api";
import { loadRadioData, refreshRadioData } from "@/lib/tv/radio";
import type { TvCategory, TvChannel, TvDataset, TvStream } from "@/lib/tv/types";
import {
  BUILTIN_IPTV_ORG,
  resolveActiveSource,
  type TvSource,
  type TvSourcesState,
} from "@/lib/tv/sources";
import { getTvSources } from "@/lib/settings";
import { setActiveTvSource } from "@/lib/actions/tvSources";
import {
  loadTvRecents,
  saveTvRecents,
  loadTvFavorites,
  saveTvFavorites,
  TV_RECENTS_MAX,
  type TvRecent,
  type MediaKind,
} from "@/lib/tv/storage";
import { useMpvSupported } from "@/lib/player/platform";
import { useInvalidation } from "@/lib/query/bus";
import { useFullWidth, useWide } from "@/lib/appLayout";
import { toast } from "@/lib/toast";

const FOCUS_SIDEBAR_PER_CATEGORY = 80; // cap per category in the browse list
const FOCUS_SIDEBAR_SEARCH_LIMIT = 200;
const FOCUS_STORAGE_KEY = "mosaic.tv.focus";
const NAV_SCOPE_KEY = "mosaic.tv.navScope";
const MEDIA_KIND_KEY = "mosaic.tv.mediaKind";

// Where the user picked the active channel from. Drives `navScope` implicitly
// — picking inside Favorites locks Next/Prev to Favorites, etc. "search" and
// "auto" intentionally leave the scope alone so a search-driven pick or the
// initial load doesn't reshape navigation.
type PickSource =
  | { kind: "favorites" }
  | { kind: "recents" }
  | { kind: "category"; id: string }
  | { kind: "search" }
  | { kind: "auto" };

// Active navigation scope for Next/Prev/Shuffle.
type NavScope =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "recents" }
  | { kind: "category"; id: string };

function scopeKey(s: NavScope): string {
  return s.kind === "category" ? `category:${s.id}` : s.kind;
}

function parseScopeKey(key: string): NavScope {
  if (key === "favorites" || key === "recents" || key === "all") return { kind: key };
  if (key.startsWith("category:")) return { kind: "category", id: key.slice(9) };
  return { kind: "all" };
}

function loadNavScope(): NavScope {
  try {
    const raw = localStorage.getItem(NAV_SCOPE_KEY);
    return raw ? parseScopeKey(raw) : { kind: "all" };
  } catch {
    return { kind: "all" };
  }
}

function saveNavScope(s: NavScope) {
  try {
    localStorage.setItem(NAV_SCOPE_KEY, scopeKey(s));
  } catch {
    /* ignore */
  }
}

function scopeFromPickSource(src: PickSource): NavScope | null {
  switch (src.kind) {
    case "favorites":
      return { kind: "favorites" };
    case "recents":
      return { kind: "recents" };
    case "category":
      return { kind: "category", id: src.id };
    case "search":
    case "auto":
      return null;
  }
}

function pickSourceFromScope(s: NavScope): PickSource {
  if (s.kind === "category") return { kind: "category", id: s.id };
  if (s.kind === "favorites") return { kind: "favorites" };
  if (s.kind === "recents") return { kind: "recents" };
  return { kind: "auto" };
}

// The rail key the user picked from — used to scope the "now playing" border
// to a single rail. Returning null means no rail owns the highlight (initial
// load before any click, or a pick that doesn't belong to a visible rail).
function railKeyFromPickSource(src: PickSource): string | null {
  switch (src.kind) {
    case "favorites":
      return "favorites";
    case "recents":
      return "recents";
    case "category":
      return `category:${src.id}`;
    case "search":
      return "results";
    case "auto":
      return null;
  }
}

// Promoted to the top "Featured" rail when no search is active and channels exist
// in these slots. Order is meaningful — categories appear in this order, then any
// remaining categories alphabetically.
const RAIL_PRIORITY = [
  "news",
  "general",
  "entertainment",
  "movies",
  "sports",
  "music",
  "documentary",
  "comedy",
  "kids",
  "lifestyle",
  "culture",
  "science",
  "education",
  "business",
  "travel",
  "cooking",
  "outdoor",
  "weather",
  // Radio genre buckets (see lib/tv/radio.ts) — ignored by TV, which has no
  // such categories, but gives the radio rails a sensible top-down order.
  "pop",
  "rock",
  "electronic",
  "hiphop",
  "jazz",
  "classical",
  "country",
  "blues",
  "reggae",
  "latin",
  "oldies",
  "folk",
  "ambient",
  "metal",
  "religious",
  "world",
  "various",
];

const INITIAL_FILTERS: TvFilters = {
  search: "",
  countries: [],
  genre: null,
};

export default function TvPage() {
  const mpvSupported = useMpvSupported();
  const [data, setData] = useState<TvDataset | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TvFilters>(INITIAL_FILTERS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [recents, setRecents] = useState<TvRecent[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [navScope, setNavScope] = useState<NavScope>({ kind: "all" });
  const [activeRailKey, setActiveRailKey] = useState<string | null>(null);
  const [sourcesState, setSourcesState] = useState<TvSourcesState | null>(null);
  const [managePlaylistsOpen, setManagePlaylistsOpen] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKind>("tv");
  const isRadio = mediaKind === "radio";
  const noun = isRadio ? "station" : "channel";
  const activeSource: TvSource = useMemo(
    () => (sourcesState ? resolveActiveSource(sourcesState) : BUILTIN_IPTV_ORG),
    [sourcesState],
  );

  // Focus mode: hide the main Mosaic nav so the TV page reads like a smart-TV
  // home screen. Persisted in localStorage so the preference sticks.
  useFullWidth(focusMode);
  useWide(true);

  // Hydrate persisted prefs after mount (avoid SSR mismatch).
  useEffect(() => {
    try {
      if (localStorage.getItem(FOCUS_STORAGE_KEY) === "1") setFocusMode(true);
      if (localStorage.getItem(MEDIA_KIND_KEY) === "radio") setMediaKind("radio");
    } catch {
      /* ignore */
    }
    setNavScope(loadNavScope());
  }, []);

  // Recents + favorites are namespaced per media kind — reload them whenever
  // the kind changes (and on mount, for the hydrated kind).
  useEffect(() => {
    setRecents(loadTvRecents(mediaKind));
    setFavorites(new Set(loadTvFavorites(mediaKind)));
  }, [mediaKind]);

  const onChangeMediaKind = useCallback((kind: MediaKind) => {
    setMediaKind(kind);
    try {
      localStorage.setItem(MEDIA_KIND_KEY, kind);
    } catch {
      /* ignore */
    }
    // Reset transient view state so the new kind starts clean and auto-picks.
    setActiveId(null);
    setFilters(INITIAL_FILTERS);
    setNavScope({ kind: "all" });
    saveNavScope({ kind: "all" });
  }, []);

  const updateNavScope = useCallback((next: NavScope) => {
    setNavScope(next);
    saveNavScope(next);
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveTvFavorites([...next], mediaKind);
      return next;
    });
  }, [mediaKind]);

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

  // Load the user's source registry (built-in + any custom M3U playlists)
  // and refetch when it changes via the invalidation bus.
  const loadSources = useCallback(() => {
    getTvSources().then(setSourcesState).catch(() => {
      setSourcesState({ custom: [], activeId: "iptv-org" });
    });
  }, []);
  useEffect(loadSources, [loadSources]);
  useInvalidation(["tv:sources"], loadSources);

  // Fetch the channel dataset for the active source. Refetches whenever the
  // active source id changes (switching providers, deleting the active one).
  // NOTE: BUILTIN_IPTV_ORG is a module-level constant — so when activeSource
  // resolves to the built-in across both "no sources state" and "sources
  // loaded, built-in active" renders, the reference is the same and React
  // would skip the effect. Depending on .id + .url keeps the fetch firing
  // whenever the user actually switched providers.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setActiveId(null);
    (async () => {
      try {
        const result = isRadio
          ? await loadRadioData()
          : await loadTvData(activeSource);
        if (cancelled) return;
        setData(result.data);
        setFetchedAt(result.fetchedAt);
        setLoading(false);
        // Stale-while-revalidate: the (possibly stale) cached list is on screen
        // now; if it's past the TTL, refresh in the background and swap in the
        // fresh one when it lands, surfacing the existing "updating" indicator.
        if (result.stale) {
          setRefreshing(true);
          (isRadio ? refreshRadioData() : refreshTvData(activeSource))
            .then((fresh) => {
              if (cancelled) return;
              setData(fresh.data);
              setFetchedAt(fresh.fetchedAt);
              toast("ok", isRadio ? "Station list updated" : "Channel list updated");
            })
            .catch(() => {
              /* keep showing the cached list */
            })
            .finally(() => {
              if (!cancelled) setRefreshing(false);
            });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource.id, activeSource.url, mediaKind]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = isRadio
        ? await refreshRadioData()
        : await refreshTvData(activeSource);
      setData(result.data);
      setFetchedAt(result.fetchedAt);
      toast("ok", isRadio ? "Stations refreshed" : "Channels refreshed");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [activeSource, isRadio]);

  const streamsByChannel = useMemo(
    () => (data ? indexStreamsByChannel(data.streams) : new Map<string, TvStream[]>()),
    [data],
  );

  const logosByChannel = useMemo(
    () => (data ? indexLogosByChannel(data.logos) : new Map<string, string>()),
    [data],
  );

  const countryFlags = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    for (const c of data.countries) {
      if (c.flag) map.set(c.code, c.flag);
    }
    return map;
  }, [data]);

  const categoriesByName = useMemo(() => {
    const map = new Map<string, TvCategory>();
    if (!data) return map;
    for (const c of data.categories) map.set(c.id, c);
    return map;
  }, [data]);

  // Channels that have at least one playable stream, with logos resolved.
  const playableChannels = useMemo(() => {
    if (!data) return [] as TvChannel[];
    return data.channels
      .filter((c) => streamsByChannel.has(c.id))
      .map((c) => ({ ...c, logo: c.logo || logosByChannel.get(c.id) || null }));
  }, [data, streamsByChannel, logosByChannel]);

  const channelById = useMemo(() => {
    const map = new Map<string, TvChannel>();
    for (const c of playableChannels) map.set(c.id, c);
    return map;
  }, [playableChannels]);

  const deferredSearch = useDeferredValue(filters.search);

  // Apply user-driven filters on the playable channel set.
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const countrySet =
      filters.countries.length > 0 ? new Set(filters.countries) : null;
    return playableChannels.filter((c) => {
      if (countrySet && !countrySet.has(c.country)) return false;
      if (filters.genre && !c.categories.includes(filters.genre)) return false;
      if (q) {
        const haystack = [c.name, ...(c.alt_names ?? [])].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [playableChannels, deferredSearch, filters.countries, filters.genre]);

  // Group filtered channels by their first category for the rails.
  const railsByCategory = useMemo(() => {
    const groups = new Map<string, TvChannel[]>();
    for (const c of filtered) {
      const cat = c.categories[0] || "general";
      const arr = groups.get(cat);
      if (arr) arr.push(c);
      else groups.set(cat, [c]);
    }
    // Order: known priority list first, then everything else alphabetically.
    const priorityIdx = new Map(RAIL_PRIORITY.map((id, i) => [id, i]));
    return [...groups.entries()].sort(([a], [b]) => {
      const ia = priorityIdx.get(a) ?? 1e6;
      const ib = priorityIdx.get(b) ?? 1e6;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
  }, [filtered]);

  // Auto-pick a channel once data is ready, preferring the most recent.
  // Also seed activeRailKey so the home rail of the picked channel shows the
  // highlight on first paint instead of feeling "lost."
  useEffect(() => {
    if (activeId || filtered.length === 0) return;
    const recentCandidate = recents.find((r) => channelById.has(r.id))?.id;
    const candidateId = recentCandidate ?? filtered[0]?.id;
    if (!candidateId) return;
    setActiveId(candidateId);
    if (recentCandidate) {
      setActiveRailKey("recents");
    } else {
      const ch = channelById.get(candidateId);
      const cat = ch?.categories[0];
      setActiveRailKey(cat ? `category:${cat}` : null);
    }
  }, [filtered, activeId, recents, channelById]);

  // Backfill logos for recents stored before their channel logo resolved (e.g.
  // saved during a session where logos.json hadn't loaded yet). Keeps the
  // Dashboard "Up next" rail showing real channel art instead of a placeholder.
  useEffect(() => {
    if (channelById.size === 0) return;
    setRecents((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.logo) return r;
        const logo = channelById.get(r.id)?.logo ?? null;
        if (!logo) return r;
        changed = true;
        return { ...r, logo };
      });
      if (changed) saveTvRecents(next, mediaKind);
      return changed ? next : prev;
    });
  }, [channelById, mediaKind]);

  const active = activeId ? channelById.get(activeId) ?? null : null;
  const activeStreams = active ? streamsByChannel.get(active.id) ?? [] : [];

  const handlePick = useCallback(
    (channel: TvChannel, source: PickSource = { kind: "auto" }) => {
      const streams = streamsByChannel.get(channel.id) ?? [];
      if (streams.length === 0) {
        toast(
          "err",
          `No playable streams for this ${mediaKind === "radio" ? "station" : "channel"}`,
        );
        return;
      }
      setActiveId(channel.id);
      setActiveRailKey(railKeyFromPickSource(source));
      setRecents((prev) => {
        const entry: TvRecent = {
          id: channel.id,
          name: channel.name,
          logo: channel.logo ?? null,
          at: Date.now(),
        };
        const next = [
          entry,
          ...prev.filter((r) => r.id !== channel.id),
        ].slice(0, TV_RECENTS_MAX);
        saveTvRecents(next, mediaKind);
        return next;
      });
      const nextScope = scopeFromPickSource(source);
      if (nextScope) updateNavScope(nextScope);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [streamsByChannel, updateNavScope, mediaKind],
  );

  // Deep-link from the Dashboard "Up next" rail: /tv?play=<channelId>. Fires
  // once the requested channel becomes resolvable (after the dataset loads),
  // overriding the auto-pick. Guarded by a ref so it only tunes once.
  const tvResumeDoneRef = useRef(false);
  useEffect(() => {
    if (tvResumeDoneRef.current) return;
    let requested: string | null = null;
    try {
      requested = new URLSearchParams(window.location.search).get("play");
    } catch {
      /* ignore */
    }
    if (!requested) return;
    const ch = channelById.get(requested);
    if (!ch) return; // dataset not ready yet — retry on next render
    tvResumeDoneRef.current = true;
    handlePick(ch, { kind: "auto" });
  }, [channelById, handlePick]);

  // onPrev / onNext / onShuffle live below — defined after favoriteChannels
  // and recentChannels so they can walk the active navScope's channel list.

  const onFilterChange = useCallback((next: Partial<TvFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  // Recently-watched channels — deliberately NOT filtered: the user's history
  // should stay constant regardless of the country/genre/search filters.
  const recentChannels = useMemo(() => {
    if (recents.length === 0) return [];
    return recents
      .map((r) => channelById.get(r.id))
      .filter((c): c is TvChannel => !!c);
  }, [recents, channelById]);

  // Favorites that are still resolvable and pass the current filters. We don't
  // hide favorites when filters narrow the catalog — we just dim them out by
  // limiting to the filtered set so the user's mental model stays consistent
  // ("the current filter affects everything").
  const favoriteChannels = useMemo(() => {
    if (favorites.size === 0) return [];
    const inFilter = new Set(filtered.map((c) => c.id));
    return [...favorites]
      .map((id) => channelById.get(id))
      .filter((c): c is TvChannel => !!c && inFilter.has(c.id));
  }, [favorites, channelById, filtered]);

  const toggleActiveFavorite = useCallback(() => {
    if (active) toggleFavorite(active.id);
  }, [active, toggleFavorite]);

  // Channels that Next/Prev/Shuffle walk through, derived from the active
  // navScope. `filtered` is the "All" fallback — used whenever the chosen
  // scope is empty or doesn't contain the active channel, so the buttons
  // never become inert.
  const navList = useMemo<TvChannel[]>(() => {
    switch (navScope.kind) {
      case "favorites":
        return favoriteChannels;
      case "recents":
        return recentChannels;
      case "category": {
        const found = railsByCategory.find(([id]) => id === navScope.id);
        return found ? found[1] : [];
      }
      case "all":
      default:
        return filtered;
    }
  }, [navScope, favoriteChannels, recentChannels, railsByCategory, filtered]);

  // The list to actually iterate: if the scoped list doesn't contain the
  // active channel (or is empty), fall back to `filtered` so the buttons
  // still move somewhere reasonable.
  const effectiveNavList = useMemo<TvChannel[]>(() => {
    if (navList.length === 0) return filtered;
    if (active && !navList.some((c) => c.id === active.id)) return filtered;
    return navList;
  }, [navList, filtered, active]);

  const stickySource = useMemo<PickSource>(() => pickSourceFromScope(navScope), [navScope]);

  const onPrev = useCallback(() => {
    if (!active || effectiveNavList.length === 0) return;
    const idx = effectiveNavList.findIndex((c) => c.id === active.id);
    const prev =
      effectiveNavList[(idx - 1 + effectiveNavList.length) % effectiveNavList.length];
    if (prev) handlePick(prev, stickySource);
  }, [active, effectiveNavList, handlePick, stickySource]);

  const onNext = useCallback(() => {
    if (!active || effectiveNavList.length === 0) return;
    const idx = effectiveNavList.findIndex((c) => c.id === active.id);
    const next = effectiveNavList[(idx + 1) % effectiveNavList.length];
    if (next) handlePick(next, stickySource);
  }, [active, effectiveNavList, handlePick, stickySource]);

  const onShuffle = useCallback(() => {
    if (effectiveNavList.length === 0) return;
    const pool =
      effectiveNavList.length === 1
        ? effectiveNavList
        : effectiveNavList.filter((c) => c.id !== active?.id);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) handlePick(pick, stickySource);
  }, [effectiveNavList, active, handlePick, stickySource]);

  // Auto-degrade: if the active scope no longer makes sense (favorites empty,
  // recents empty, or category filtered out), snap back to "all" so the chip
  // doesn't lie and the buttons stay useful.
  useEffect(() => {
    if (navScope.kind === "favorites" && favoriteChannels.length === 0) {
      updateNavScope({ kind: "all" });
    } else if (navScope.kind === "recents" && recentChannels.length === 0) {
      updateNavScope({ kind: "all" });
    } else if (
      navScope.kind === "category" &&
      !railsByCategory.some(([id]) => id === navScope.id)
    ) {
      updateNavScope({ kind: "all" });
    }
  }, [navScope, favoriteChannels.length, recentChannels.length, railsByCategory, updateNavScope]);

  // Build the scope chip options. Only includes scopes that have any
  // channels right now; the current scope is always present even if empty
  // (it'll auto-degrade away on the next render).
  const scopeControl = useMemo(() => {
    const activeCatId = active?.categories[0];
    const activeCatMeta = activeCatId ? categoriesByName.get(activeCatId) : undefined;
    const activeCatName =
      activeCatMeta?.name ??
      (activeCatId ? activeCatId.charAt(0).toUpperCase() + activeCatId.slice(1) : null);
    const currentCatId = navScope.kind === "category" ? navScope.id : null;
    const currentCatName = currentCatId
      ? categoriesByName.get(currentCatId)?.name ??
        currentCatId.charAt(0).toUpperCase() + currentCatId.slice(1)
      : null;

    const options: ScopeOption[] = [{ value: "all", label: "All channels" }];
    options.push({
      value: "favorites",
      label: `Favorites${favoriteChannels.length ? ` (${favoriteChannels.length})` : ""}`,
      disabled: favoriteChannels.length === 0,
    });
    options.push({
      value: "recents",
      label: `Recents${recentChannels.length ? ` (${recentChannels.length})` : ""}`,
      disabled: recentChannels.length === 0,
    });
    if (activeCatId && activeCatName) {
      options.push({
        value: `category:${activeCatId}`,
        label: activeCatName,
      });
    }
    // Surface the currently-selected category in the menu even if it's not
    // the active channel's category (rare but possible after the user
    // overrides scope manually then picks via a different rail).
    if (
      currentCatId &&
      currentCatName &&
      currentCatId !== activeCatId &&
      !options.some((o) => o.value === `category:${currentCatId}`)
    ) {
      options.push({
        value: `category:${currentCatId}`,
        label: currentCatName,
      });
    }

    let label: string;
    switch (navScope.kind) {
      case "favorites":
        label = "Favorites";
        break;
      case "recents":
        label = "Recents";
        break;
      case "category":
        label = currentCatName ?? "Category";
        break;
      case "all":
      default:
        label = "All";
    }

    return {
      label,
      value: scopeKey(navScope),
      options,
      onChange: (v: string) => updateNavScope(parseScopeKey(v)),
    };
  }, [
    navScope,
    favoriteChannels.length,
    recentChannels.length,
    active,
    categoriesByName,
    updateNavScope,
  ]);

  // Per-rail onPick wrappers so the rail's identity flows into the scope.
  const pickFromRecents = useCallback(
    (c: TvChannel) => handlePick(c, { kind: "recents" }),
    [handlePick],
  );
  const pickFromList = useCallback(
    (c: TvChannel, groupId: string) => {
      if (groupId === "favorites") handlePick(c, { kind: "favorites" });
      else if (groupId === "results") handlePick(c, { kind: "search" });
      else handlePick(c, { kind: "category", id: groupId });
    },
    [handlePick],
  );

  // Container: in Focus mode we lock to viewport height (`h-screen`) so the
  // channels sidebar's `overflow-y-auto` actually scrolls inside its column
  // rather than growing the page. The AppShell already gives us full width in
  // that mode. In default (rails) mode the page is allowed to grow and we use
  // negative margins to break out of the AppShell's padded `max-w-6xl` box.
  // On the mpv path the page must NOT paint an opaque background — mpv
  // renders in a native layer BELOW the transparent webview, so this
  // full-page `bg-[var(--background)]` was covering the video (it's the same
  // #07070b the Tauri window already paints, so dropping it is visually
  // identical except the video now shows through). Native <video> keeps it.
  const pageBg = mpvSupported ? "" : "bg-[var(--background)]";
  const containerCls = `h-screen flex flex-col overflow-hidden ${pageBg}`;

  // Grouped channel list for the always-on browse pane (the "A" column in the
  // YouTube-style layout, and the Focus-mode sidebar). When searching it's one
  // "results" group; otherwise Favorites pinned above the per-category groups.
  const listGroups = useMemo<[string, TvChannel[]][]>(() => {
    if (deferredSearch.trim()) {
      return [["results", filtered.slice(0, FOCUS_SIDEBAR_SEARCH_LIMIT)]];
    }
    const cats = railsByCategory.map(
      ([cat, items]) =>
        [cat, items.slice(0, FOCUS_SIDEBAR_PER_CATEGORY)] as [string, TvChannel[]],
    );
    return favoriteChannels.length > 0
      ? ([["favorites", favoriteChannels], ...cats] as [string, TvChannel[]][])
      : cats;
  }, [deferredSearch, filtered, railsByCategory, favoriteChannels]);

  // Horizontal "recommendations" strip under the player (the "B" row): recently
  // watched (unfiltered) when present; otherwise recommend favorites + popular.
  const recoChannels = useMemo<TvChannel[]>(() => {
    // Recently-watched takes over the strip wholesale and stays unfiltered.
    if (recentChannels.length > 0) return recentChannels.slice(0, 30);
    const seen = new Set<string>();
    const out: TvChannel[] = [];
    const add = (arr: TvChannel[]) => {
      for (const c of arr) {
        if (out.length >= 30) break;
        if (!seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
    };
    add(favoriteChannels);
    add(filtered);
    return out;
  }, [recentChannels, favoriteChannels, filtered]);
  const recoTitle = recentChannels.length > 0 ? "Recently watched" : "Recommended";

  return (
    <div className={containerCls}>
      <TopToolbar
        resultCount={filtered.length}
        totalCount={playableChannels.length}
        onRefresh={onRefresh}
        isRefreshing={refreshing}
        fetchedAt={fetchedAt}
        focusMode={focusMode}
        onToggleFocus={toggleFocus}
        sources={
          sourcesState
            ? [BUILTIN_IPTV_ORG, ...sourcesState.custom]
            : [BUILTIN_IPTV_ORG]
        }
        activeSourceId={activeSource.id}
        mediaKind={mediaKind}
        onChangeMediaKind={onChangeMediaKind}
        onManagePlaylists={() => setManagePlaylistsOpen(true)}
        onChangeSource={(id) => {
          // Optimistic local switch — refetches via the activeSource effect.
          // Persist via the server action so the choice survives reloads.
          setSourcesState((prev) =>
            prev ? { ...prev, activeId: id } : prev,
          );
          const fd = new FormData();
          fd.set("id", id);
          void setActiveTvSource(null, fd);
        }}
      />

      {/* YouTube-style watch layout: the player (T) + a recommendations strip
          (B) fill the left column; a full-height channel browse list (A) sits
          on the right. Everything fits one screen — only A scrolls vertically
          and B scrolls horizontally; the player flexes to the leftover height.
          Focus mode just hides the app sidebar (via useFullWidth) for more
          room — the layout is the same. */}
      <div className="flex-1 min-h-0 flex gap-2 p-2">
        {/* Left: player (T) on top, recommendations (B) below. */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
          <div className="flex-1 min-h-0">
            {active ? (
              <TVPlayer
                fill
                mediaKind={mediaKind}
                genreLabel={
                  categoriesByName.get(active.categories[0] ?? "")?.name ??
                  active.categories[0] ??
                  null
                }
                channel={active}
                streams={activeStreams}
                countryFlag={countryFlags.get(active.country)}
                isFavorite={favorites.has(active.id)}
                onToggleFavorite={toggleActiveFavorite}
                onPrev={filtered.length > 1 ? onPrev : undefined}
                onNext={filtered.length > 1 ? onNext : undefined}
                onShuffle={filtered.length > 1 ? onShuffle : undefined}
                scope={filtered.length > 1 ? scopeControl : undefined}
              />
            ) : (
              <div className="h-full rounded-2xl bg-black/40 border border-white/5 grid place-items-center text-neutral-500 text-sm">
                {loading
                  ? "Tuning in…"
                  : error && !data
                    ? `Failed to load ${noun}s: ${error}`
                    : data
                      ? `Select a ${noun} to start ${isRadio ? "listening" : "watching"}`
                      : `Loading ${noun}s…`}
              </div>
            )}
          </div>

          {/* B: recommendations strip — horizontal scroll, fixed height. */}
          {recoChannels.length > 0 && (
            <div className="shrink-0">
              <ChannelRail
                title={recoTitle}
                railKey="recents"
                activeRailKey={activeRailKey}
                channels={recoChannels}
                countryFlags={countryFlags}
                activeChannelId={active?.id ?? null}
                favorites={favorites}
                onPick={pickFromRecents}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          )}
        </div>

        {/* A: full-height channel browse list with its own search + filters. */}
        <aside className="w-[300px] lg:w-[360px] shrink-0 min-h-0 flex flex-col rounded-2xl border border-white/5 bg-black/20 overflow-hidden">
          <ChannelFilters
            filters={filters}
            onChange={onFilterChange}
            countries={data?.countries ?? []}
            categories={data?.categories ?? []}
            searchNoun={isRadio ? "stations" : "channels"}
          />
          {error && !data ? (
            <div className="flex-1 grid place-items-center p-6 text-center text-sm text-rose-300">
              Failed to load {noun}s: {error}
            </div>
          ) : data && filtered.length === 0 && !loading ? (
            <div className="flex-1 grid place-items-center p-8 text-center text-sm text-neutral-400">
              No {noun}s match your filters. Try clearing search or country.
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ChannelsList
                groups={listGroups}
                categoriesByName={categoriesByName}
                countryFlags={countryFlags}
                activeChannelId={active?.id ?? null}
                activeGroupId={activeRailKey?.startsWith("category:") ? activeRailKey.slice(9) : activeRailKey}
                favorites={favorites}
                onPick={pickFromList}
                onToggleFavorite={toggleFavorite}
              />
            </div>
          )}
        </aside>
      </div>

      <TvPlaylistsModal
        open={managePlaylistsOpen}
        onClose={() => setManagePlaylistsOpen(false)}
      />
    </div>
  );
}
