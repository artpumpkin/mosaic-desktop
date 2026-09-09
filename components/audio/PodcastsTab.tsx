"use client";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Mic, ListMusic, Globe, Tag, Rss } from "lucide-react";

import {
  BrowseShell,
  BrowseToolbar,
  SearchInput,
  MediaCard,
  MediaRail,
  MediaGridView,
} from "@/components/browse";
import MediaHero from "@/components/browse/MediaHero";
import MediaHomeSkeleton from "@/components/browse/MediaHomeSkeleton";
import Combobox from "@/components/Combobox";
import TrackList, { type TrackRow } from "@/components/audio/TrackList";
import PodcastFeedModal, { type ModalEpisode } from "@/components/audio/PodcastFeedModal";
import type { AudioItem, AudioPlayerApi } from "@/components/audio/useAudioPlayer";
import type { CatalogItem } from "@/lib/movies/types";
import { searchPodcasts } from "@/lib/podcasts/itunes";
import { fetchFeed } from "@/lib/podcasts/rss";
import {
  getTopPodcasts,
  PODCAST_GENRES,
  PODCAST_COUNTRIES,
} from "@/lib/podcasts/charts";
import {
  addSubscription,
  removeSubscription,
  loadSubscriptions,
  loadFavoriteEpisodes,
  toggleFavoriteEpisode,
  type FavoriteEpisode,
} from "@/lib/podcasts/library";
import type { ItunesPodcast, PodcastFeed, PodcastSubscription } from "@/lib/podcasts/types";
import { toast } from "@/lib/toast";

const COUNTRY_KEY = "mosaic.audio.podcast.country";
const GENRE_KEY = "mosaic.audio.podcast.genre";
// A few categories surfaced as home rails (besides the overall Top Shows).
const HOME_GENRE_IDS = ["1303", "1489", "1488", "1324"];

type Rail = { id: string; title: string; genreId: string | null; items: ItunesPodcast[] };

type Props = {
  player: AudioPlayerApi;
  selector: ReactNode;
  /** Now-playing transport, pinned to the top of the section (Apple-style). */
  playerBar: ReactNode;
};

function podcastToHeroItem(p: ItunesPodcast): CatalogItem {
  return {
    id: p.feedUrl ?? p.title,
    type: "series",
    name: p.title,
    poster: p.image,
    background: p.image,
    releaseInfo: p.author ?? null,
    description: p.author ? `Top podcast · ${p.author}` : "Top podcast",
  };
}

export default function PodcastsTab({ player, selector, playerBar }: Props) {
  const [country, setCountry] = useState("us");
  const [genre, setGenre] = useState<string | null>(null); // null = home
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);

  const [rails, setRails] = useState<Rail[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [genreChart, setGenreChart] = useState<ItunesPodcast[]>([]);
  const [genreLoading, setGenreLoading] = useState(false);
  const [results, setResults] = useState<ItunesPodcast[]>([]);
  const [searching, setSearching] = useState(false);

  const [subs, setSubs] = useState<PodcastSubscription[]>([]);
  // The show whose detail modal is open. Holds the chart-row fields so the
  // modal can paint its header instantly while the RSS feed loads.
  const [activeShow, setActiveShow] = useState<ItunesPodcast | null>(null);
  const [feed, setFeed] = useState<PodcastFeed | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [favEpisodes, setFavEpisodes] = useState<FavoriteEpisode[]>([]);

  // Restore persisted country/genre once.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate persisted prefs post-mount */
    try {
      const c = localStorage.getItem(COUNTRY_KEY);
      if (c) setCountry(c);
      const g = localStorage.getItem(GENRE_KEY);
      if (g) setGenre(g);
    } catch {
      /* ignore */
    }
    setSubs(loadSubscriptions());
    setFavEpisodes(loadFavoriteEpisodes());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COUNTRY_KEY, country);
    } catch {
      /* ignore */
    }
  }, [country]);

  useEffect(() => {
    try {
      if (genre) localStorage.setItem(GENRE_KEY, genre);
      else localStorage.removeItem(GENRE_KEY);
    } catch {
      /* ignore */
    }
  }, [genre]);

  // Home rails (overall + curated genres). Reloads on country change.
  useEffect(() => {
    let cancelled = false;
    setHomeLoading(true);
    setRails([]);
    (async () => {
      const jobs: Promise<Rail | null>[] = [
        getTopPodcasts(country, undefined, 24)
          .then((items) => ({ id: "top", title: "Top Shows", genreId: null, items }))
          .catch(() => null),
        ...HOME_GENRE_IDS.map((id) => {
          const name = PODCAST_GENRES.find((g) => g.id === id)?.name ?? "Podcasts";
          return getTopPodcasts(country, id, 18)
            .then((items) => ({ id, title: `Top in ${name}`, genreId: id, items }))
            .catch(() => null);
        }),
      ];
      const settled = await Promise.all(jobs);
      if (cancelled) return;
      setRails(settled.filter((r): r is Rail => !!r && r.items.length > 0));
      setHomeLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [country]);

  // Full chart for a selected genre.
  useEffect(() => {
    if (!genre) {
      setGenreChart([]);
      return;
    }
    let cancelled = false;
    setGenreLoading(true);
    getTopPodcasts(country, genre, 60)
      .then((items) => !cancelled && setGenreChart(items))
      .catch(() => !cancelled && setGenreChart([]))
      .finally(() => !cancelled && setGenreLoading(false));
    return () => {
      cancelled = true;
    };
  }, [genre, country]);

  // Search (iTunes Search API).
  useEffect(() => {
    const q = deferred.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    searchPodcasts(q)
      .then((r) => !cancelled && setResults(r))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setSearching(false));
    return () => {
      cancelled = true;
    };
  }, [deferred]);

  const openFeed = useCallback((p: ItunesPodcast) => {
    if (!p.feedUrl) {
      toast("err", "No feed available for this show");
      return;
    }
    setActiveShow(p);
    setFeedLoading(true);
    setFeed(null);
    fetchFeed(p.feedUrl)
      .then(setFeed)
      .catch((e) => toast("err", e instanceof Error ? e.message : "Couldn't load feed"))
      .finally(() => setFeedLoading(false));
  }, []);

  const closeFeed = useCallback(() => {
    setActiveShow(null);
    setFeed(null);
  }, []);

  // Drive the subscribe toggle off the in-memory `subs` state — not a
  // localStorage read-back. If the persistence write ever fails silently (e.g.
  // a sandboxed webview), the UI must still flip; localStorage is treated as a
  // best-effort side effect, not the source of truth for this render.
  const toggleSub = useCallback(
    (p: ItunesPodcast) => {
      const feedUrl = p.feedUrl;
      if (!feedUrl) return;
      const wasSub = subs.some((s) => s.feedUrl === feedUrl);
      if (wasSub) {
        setSubs((prev) => prev.filter((s) => s.feedUrl !== feedUrl));
        removeSubscription(feedUrl);
        toast("ok", "Unsubscribed");
      } else {
        const sub: PodcastSubscription = {
          feedUrl,
          title: p.title,
          author: p.author,
          image: p.image,
          addedAt: Date.now(),
        };
        setSubs((prev) => [sub, ...prev.filter((s) => s.feedUrl !== feedUrl)]);
        addSubscription(sub);
        toast("ok", "Subscribed");
      }
    },
    [subs],
  );

  const playEpisode = useCallback(
    (index: number) => {
      if (!feed) return;
      const queue: AudioItem[] = feed.episodes.map((ep) => ({
        id: ep.id,
        title: ep.title,
        subtitle: feed.title,
        src: ep.audioUrl,
        art: ep.image,
        kind: "podcast",
      }));
      player.play(queue, index);
    },
    [feed, player],
  );

  // Star/unstar a single episode (from inside the open feed). Drive the toggle
  // off the in-memory favEpisodes state — not a localStorage read-back — so the
  // heart flips instantly even if the persistence write fails silently in the
  // webview (same fix as the subscribe toggle).
  const toggleFavEpisode = useCallback(
    (epId: string) => {
      if (!feed) return;
      const ep = feed.episodes.find((e) => e.id === epId);
      if (!ep) return;
      const wasFav = favEpisodes.some((e) => e.id === ep.id);
      const entry: FavoriteEpisode = {
        id: ep.id,
        title: ep.title,
        audioUrl: ep.audioUrl,
        image: ep.image,
        durationSec: ep.durationSec,
        publishedAt: ep.publishedAt,
        feedUrl: feed.feedUrl,
        feedTitle: feed.title,
        addedAt: Date.now(),
      };
      setFavEpisodes((prev) =>
        wasFav
          ? prev.filter((e) => e.id !== ep.id)
          : [entry, ...prev.filter((e) => e.id !== ep.id)],
      );
      toggleFavoriteEpisode(entry);
      toast("ok", wasFav ? "Removed from favorites" : "Added to favorites");
    },
    [feed, favEpisodes],
  );

  // Unstar from the home "Favorite episodes" rail (ep is already a favorite).
  const unfavEpisode = useCallback((ep: FavoriteEpisode) => {
    setFavEpisodes((prev) => prev.filter((e) => e.id !== ep.id));
    toggleFavoriteEpisode(ep);
  }, []);

  const playFavorite = useCallback(
    (index: number) => {
      const queue: AudioItem[] = favEpisodes.map((ep) => ({
        id: ep.id,
        title: ep.title,
        subtitle: ep.feedTitle,
        src: ep.audioUrl,
        art: ep.image,
        kind: "podcast",
      }));
      player.play(queue, index);
    },
    [favEpisodes, player],
  );

  // --- hero ---------------------------------------------------------------
  const topRail = rails.find((r) => r.id === "top");
  const heroItems = useMemo<CatalogItem[]>(
    () => (topRail?.items ?? []).slice(0, 5).map(podcastToHeroItem),
    [topRail],
  );
  const heroById = useMemo(() => {
    const m = new Map<string, ItunesPodcast>();
    for (const p of topRail?.items ?? []) m.set(p.feedUrl ?? p.title, p);
    return m;
  }, [topRail]);
  const subFeedUrls = useMemo(() => new Set(subs.map((s) => s.feedUrl)), [subs]);
  const favEpisodeIds = useMemo(
    () => new Set(favEpisodes.map((e) => e.id)),
    [favEpisodes],
  );

  // --- card renderer ------------------------------------------------------
  // `fluid` stretches a card to its grid column; rails instead want the fixed
  // rail width (matches Anime's PosterCard: fixed in rails, fluid in grids).
  // A fluid card in a rail's flex row collapses oddly when it's the only item.
  const renderCard = useCallback(
    (p: ItunesPodcast, active = false, fluid = false) => (
      <MediaCard
        title={p.title}
        subtitle={p.author}
        poster={p.image}
        aspect="1/1"
        accent="rose"
        active={active}
        isFavorite={p.feedUrl ? subFeedUrls.has(p.feedUrl) : false}
        onPick={() => openFeed(p)}
        onToggleFavorite={p.feedUrl ? () => toggleSub(p) : undefined}
        favoriteLabel="subscriptions"
        favoriteIcon={<Rss size={12} strokeWidth={2.5} />}
        fallbackIcon={<Mic size={30} />}
        overlayIcon={<ListMusic size={18} />}
        fluid={fluid}
      />
    ),
    // Drive the heart off the reactive sub set so it fills the instant a show
    // is subscribed (reading localStorage in render wouldn't re-trigger).
    [openFeed, toggleSub, subFeedUrls],
  );

  const countryName =
    PODCAST_COUNTRIES.find((c) => c.code === country)?.name ?? country.toUpperCase();
  const showSearch = deferred.trim().length > 0;

  const toolbar = (
    <BrowseToolbar>
      {selector}
      <Combobox
        value={country}
        onChange={(c) => c && setCountry(c)}
        options={PODCAST_COUNTRIES.map((c) => ({
          value: c.code,
          label: c.name,
          prefix: c.flag,
          hint: c.code.toUpperCase(),
        }))}
        clearable={false}
        leadingIcon={<Globe size={13} />}
        className="w-44"
      />
      <Combobox
        value={genre}
        onChange={setGenre}
        options={PODCAST_GENRES.map((g) => ({ value: g.id, label: g.name }))}
        placeholder="All categories"
        leadingIcon={<Tag size={13} />}
        className="w-48"
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search podcasts…" />
    </BrowseToolbar>
  );

  const episodeRows: ModalEpisode[] =
    feed?.episodes.map((ep, i) => ({
      id: ep.id,
      title: ep.title,
      meta: [
        ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString() : null,
        ep.durationSec ? `${Math.round(ep.durationSec / 60)} min` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      art: ep.image,
      active: player.current?.id === ep.id,
      playing: player.current?.id === ep.id && player.isPlaying,
      publishedAt: ep.publishedAt,
      favorite: favEpisodeIds.has(ep.id),
      onPlay: () => playEpisode(i),
      onToggleFavorite: () => toggleFavEpisode(ep.id),
    })) ?? [];

  // Home "Favorite episodes" rail rows (cross-show, newest-added first).
  const favEpisodeRows: TrackRow[] = favEpisodes.map((ep, i) => ({
    id: ep.id,
    title: ep.title,
    meta: [
      ep.feedTitle,
      ep.publishedAt ? new Date(ep.publishedAt).toLocaleDateString() : null,
      ep.durationSec ? `${Math.round(ep.durationSec / 60)} min` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    art: ep.image,
    active: player.current?.id === ep.id,
    playing: player.current?.id === ep.id && player.isPlaying,
    favorite: true,
    onPlay: () => playFavorite(i),
    onToggleFavorite: () => unfavEpisode(ep),
  }));

  return (
    <BrowseShell toolbar={toolbar} header={playerBar}>
      {showSearch ? (
        <>
          <MediaGridView
            title={`Results for "${deferred.trim()}"`}
            items={results}
            getKey={(p) => p.feedUrl ?? p.title}
            loading={searching}
            minColWidth={150}
            emptyLabel="No podcasts found."
            renderItem={(p) => renderCard(p, false, true)}
          />
        </>
      ) : genre ? (
        <>
          <MediaGridView
            title={`Top in ${PODCAST_GENRES.find((g) => g.id === genre)?.name ?? "Podcasts"} · ${countryName}`}
            items={genreChart}
            getKey={(p) => p.feedUrl ?? p.title}
            loading={genreLoading}
            minColWidth={150}
            emptyLabel="No shows found."
            onBack={() => setGenre(null)}
            renderItem={(p) => renderCard(p, false, true)}
          />
        </>
      ) : homeLoading ? (
        <MediaHomeSkeleton rails={4} />
      ) : (
        <>
          {heroItems.length > 0 && (
            <MediaHero
              items={heroItems}
              onPlay={(it) => {
                const p = heroById.get(it.id);
                if (p) openFeed(p);
              }}
              onInfo={(it) => {
                const p = heroById.get(it.id);
                if (p) openFeed(p);
              }}
              favorites={subFeedUrls}
              onToggleFavorite={(id) => {
                const p = heroById.get(id);
                if (p) toggleSub(p);
              }}
              favoriteLabel="subscriptions"
              favoriteIcon={<Rss size={17} />}
              badgeLabel={`Top podcasts · ${countryName}`}
              primaryLabel="Open"
              primaryIcon={<ListMusic size={16} />}
            />
          )}

          {favEpisodeRows.length > 0 && (
            <TrackList
              title="Favorite episodes"
              subtitle={`${favEpisodeRows.length}`}
              rows={favEpisodeRows}
              kind="podcast"
            />
          )}

          {subs.length > 0 && (
            <MediaRail
              title="Subscriptions"
              items={subs}
              getKey={(s) => s.feedUrl}
              renderItem={(s) =>
                renderCard(
                  { feedUrl: s.feedUrl, title: s.title, author: s.author, image: s.image },
                  activeShow?.feedUrl === s.feedUrl,
                )
              }
            />
          )}

          {rails.map((rail) => (
            <MediaRail
              key={rail.id}
              title={rail.title}
              items={rail.items}
              getKey={(p) => p.feedUrl ?? p.title}
              onSeeAll={rail.genreId ? () => setGenre(rail.genreId) : undefined}
              renderItem={(p) => renderCard(p)}
            />
          ))}
        </>
      )}

      <PodcastFeedModal
        open={activeShow != null}
        header={activeShow}
        feed={feed}
        loading={feedLoading}
        episodes={episodeRows}
        isSubscribed={activeShow?.feedUrl ? subFeedUrls.has(activeShow.feedUrl) : false}
        onToggleSubscribe={() => activeShow && toggleSub(activeShow)}
        onClose={closeFeed}
      />
    </BrowseShell>
  );
}
