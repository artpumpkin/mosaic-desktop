"use client";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Music2, ListMusic, User, Play, UserPlus, UserCheck, Tag, Clock } from "lucide-react";

import {
  BrowseShell,
  BrowseToolbar,
  SearchInput,
  SegmentedTabs,
  MediaCard,
  MediaRail,
  MediaGridView,
} from "@/components/browse";
import MediaHero from "@/components/browse/MediaHero";
import MediaHomeSkeleton from "@/components/browse/MediaHomeSkeleton";
import Combobox from "@/components/Combobox";
import AudioDetailModal from "@/components/audio/AudioDetailModal";
import type { AudioItem, AudioPlayerApi } from "@/components/audio/useAudioPlayer";
import type { CatalogItem } from "@/lib/movies/types";
import {
  getHost,
  getTrendingTracks,
  getTrendingPlaylists,
  getArtistTracks,
  getPlaylistTracks,
  searchTracks,
  searchArtists,
  streamUrl,
} from "@/lib/audius/api";
import {
  audiusTrackToHeroItem,
  fmtDur,
  type AudiusArtist,
  type AudiusPlaylist,
  type AudiusTrack,
} from "@/lib/audius/types";
import {
  loadFollows,
  addFollow,
  removeFollow,
  type FollowedArtist,
} from "@/lib/audius/library";
import {
  AUDIUS_GENRES,
  AUDIUS_TIME_RANGES,
  HOME_GENRE_IDS,
} from "@/lib/audius/charts";
import { toast } from "@/lib/toast";

const TIME_KEY = "mosaic.audio.music.time";
const GENRE_KEY = "mosaic.audio.music.genre";

type GenreRail = { id: string; title: string; items: AudiusTrack[] };

type Props = {
  player: AudioPlayerApi;
  selector: ReactNode;
  /** Now-playing transport, pinned to the top of the section (Apple-style). */
  playerBar: ReactNode;
};

type Detail =
  | {
      kind: "artist";
      title: string;
      image: string | null;
      artist: Omit<FollowedArtist, "addedAt">;
      tracks: AudiusTrack[];
    }
  | {
      kind: "playlist";
      title: string;
      subtitle: string | null;
      image: string | null;
      tracks: AudiusTrack[];
    };

function formatCount(n: number | null): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function MusicTab({ player, selector, playerBar }: Props) {
  const [host, setHost] = useState<string | null>(null);

  const [time, setTime] = useState("week");
  const [genre, setGenre] = useState<string | null>(null); // null = home

  const [trending, setTrending] = useState<AudiusTrack[]>([]);
  const [playlists, setPlaylists] = useState<AudiusPlaylist[]>([]);
  const [genreRails, setGenreRails] = useState<GenreRail[]>([]);
  const [homeLoading, setHomeLoading] = useState(true);

  const [genreChart, setGenreChart] = useState<AudiusTrack[]>([]);
  const [genreLoading, setGenreLoading] = useState(false);

  const [follows, setFollows] = useState<FollowedArtist[]>([]);

  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [searchKind, setSearchKind] = useState<"tracks" | "artists">("tracks");
  const [trackResults, setTrackResults] = useState<AudiusTrack[]>([]);
  const [artistResults, setArtistResults] = useState<AudiusArtist[]>([]);
  const [searching, setSearching] = useState(false);

  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    getHost().then(setHost).catch(() => setHost("https://api.audius.co"));
    setFollows(loadFollows());
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate persisted prefs post-mount */
    try {
      const t = localStorage.getItem(TIME_KEY);
      if (t) setTime(t);
      const g = localStorage.getItem(GENRE_KEY);
      if (g) setGenre(g);
    } catch {
      /* ignore */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TIME_KEY, time);
    } catch {
      /* ignore */
    }
  }, [time]);

  useEffect(() => {
    try {
      if (genre) localStorage.setItem(GENRE_KEY, genre);
      else localStorage.removeItem(GENRE_KEY);
    } catch {
      /* ignore */
    }
  }, [genre]);

  // Home: overall trending + trending playlists + a few curated genre rails.
  // Reloads on time-window change.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- async data load + loading flag */
    let cancelled = false;
    setHomeLoading(true);
    setGenreRails([]);
    Promise.all([
      getTrendingTracks(undefined, time).catch(() => [] as AudiusTrack[]),
      getTrendingPlaylists(time).catch(() => [] as AudiusPlaylist[]),
      ...HOME_GENRE_IDS.map((g) =>
        getTrendingTracks(g, time)
          .then((items) => ({ id: g, title: `Trending ${g}`, items }) as GenreRail)
          .catch(() => null),
      ),
    ]).then(([t, p, ...rails]) => {
      if (cancelled) return;
      setTrending(t as AudiusTrack[]);
      setPlaylists(p as AudiusPlaylist[]);
      setGenreRails(
        (rails as (GenreRail | null)[]).filter(
          (r): r is GenreRail => !!r && r.items.length > 0,
        ),
      );
      setHomeLoading(false);
    });
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      cancelled = true;
    };
  }, [time]);

  // Full chart for a selected genre.
  useEffect(() => {
    if (!genre) {
      setGenreChart([]);
      return;
    }
    let cancelled = false;
    setGenreLoading(true);
    getTrendingTracks(genre, time)
      .then((items) => !cancelled && setGenreChart(items))
      .catch(() => !cancelled && setGenreChart([]))
      .finally(() => !cancelled && setGenreLoading(false));
    return () => {
      cancelled = true;
    };
  }, [genre, time]);

  // Search: tracks + artists in parallel.
  useEffect(() => {
    const q = deferred.trim();
    if (!q) {
      setTrackResults([]);
      setArtistResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    Promise.all([
      searchTracks(q).catch(() => [] as AudiusTrack[]),
      searchArtists(q).catch(() => [] as AudiusArtist[]),
    ]).then(([t, a]) => {
      if (cancelled) return;
      setTrackResults(t);
      setArtistResults(a);
      setSearching(false);
    });
    return () => {
      cancelled = true;
    };
  }, [deferred]);

  // --- playback -----------------------------------------------------------
  const playTracks = useCallback(
    (list: AudiusTrack[], index: number) => {
      if (!host) {
        toast("err", "Connecting to Audius…");
        return;
      }
      const queue: AudioItem[] = list.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: t.artist?.name ?? null,
        src: streamUrl(host, t.id),
        art: t.artwork,
        kind: "music",
      }));
      player.play(queue, index);
    },
    [host, player],
  );

  // --- follow -------------------------------------------------------------
  // Drive off in-memory `follows` (not a localStorage read-back) so the UI
  // flips instantly even if the webview's persistence write fails silently.
  const followIds = useMemo(() => new Set(follows.map((a) => a.id)), [follows]);
  const toggleFollow = useCallback(
    (a: Omit<FollowedArtist, "addedAt">) => {
      const wasFollowing = follows.some((f) => f.id === a.id);
      if (wasFollowing) {
        setFollows((prev) => prev.filter((f) => f.id !== a.id));
        removeFollow(a.id);
        toast("ok", `Unfollowed ${a.name}`);
      } else {
        const entry: FollowedArtist = {
          id: a.id,
          name: a.name,
          handle: a.handle,
          picture: a.picture,
          addedAt: Date.now(),
        };
        setFollows((prev) => [entry, ...prev.filter((f) => f.id !== a.id)]);
        addFollow(a);
        toast("ok", `Following ${a.name}`);
      }
    },
    [follows],
  );

  // --- detail views -------------------------------------------------------
  const openArtist = useCallback((a: Omit<FollowedArtist, "addedAt">) => {
    setDetail({ kind: "artist", title: a.name, image: a.picture, artist: a, tracks: [] });
    setDetailLoading(true);
    getArtistTracks(a.id)
      .then((tracks) => setDetail((d) => (d?.kind === "artist" && d.artist.id === a.id ? { ...d, tracks } : d)))
      .catch(() => toast("err", "Couldn't load artist"))
      .finally(() => setDetailLoading(false));
  }, []);

  const openPlaylist = useCallback((p: AudiusPlaylist) => {
    setDetail({
      kind: "playlist",
      title: p.name,
      subtitle: p.user?.name ?? null,
      image: p.artwork,
      tracks: [],
    });
    setDetailLoading(true);
    getPlaylistTracks(p.id)
      .then((tracks) => setDetail((d) => (d?.kind === "playlist" && d.title === p.name ? { ...d, tracks } : d)))
      .catch(() => toast("err", "Couldn't load playlist"))
      .finally(() => setDetailLoading(false));
  }, []);

  // --- card renderers -----------------------------------------------------
  // `fluid` stretches to the grid column; rails want the fixed card width — a
  // fluid card in a rail's flex row collapses to ~0 width (mirrors PodcastsTab).
  const renderTrackCard = useCallback(
    (list: AudiusTrack[], t: AudiusTrack, fluid = false) => (
      <MediaCard
        title={t.title}
        subtitle={t.artist?.name ?? null}
        poster={t.artwork}
        aspect="1/1"
        accent="violet"
        active={player.current?.id === t.id}
        durationBadge={t.durationSec != null ? fmtDur(t.durationSec) : undefined}
        onPick={() => playTracks(list, list.findIndex((x) => x.id === t.id))}
        fallbackIcon={<Music2 size={30} />}
        fluid={fluid}
      />
    ),
    [player.current?.id, playTracks],
  );

  const renderArtistCard = useCallback(
    (a: AudiusArtist, fluid = false) => (
      <MediaCard
        title={a.name}
        subtitle={a.followerCount != null ? `${formatCount(a.followerCount)} followers` : a.handle ? `@${a.handle}` : null}
        poster={a.picture}
        aspect="1/1"
        accent="violet"
        isFavorite={followIds.has(a.id)}
        onPick={() => openArtist(a)}
        onToggleFavorite={() => toggleFollow(a)}
        favoriteLabel="following"
        fallbackIcon={<User size={30} />}
        overlayIcon={<ListMusic size={18} />}
        fluid={fluid}
      />
    ),
    [openArtist, toggleFollow, followIds],
  );

  // --- hero ---------------------------------------------------------------
  const heroItems = useMemo<CatalogItem[]>(
    () => trending.slice(0, 5).map(audiusTrackToHeroItem),
    [trending],
  );
  const heroById = useMemo(() => {
    const m = new Map<string, AudiusTrack>();
    for (const t of trending) m.set(t.id, t);
    return m;
  }, [trending]);
  const heroFavorites = useMemo(
    () => new Set(trending.filter((t) => t.artist && followIds.has(t.artist.id)).map((t) => t.id)),
    [trending, followIds],
  );

  const showSearch = deferred.trim().length > 0;
  const searchTabs = [
    { value: "tracks" as const, label: "Tracks", icon: <Music2 size={13} /> },
    { value: "artists" as const, label: "Artists", icon: <User size={13} /> },
  ];

  const toolbar = (
    <BrowseToolbar>
      {selector}
      {showSearch && (
        <SegmentedTabs value={searchKind} onChange={setSearchKind} tabs={searchTabs} />
      )}
      <Combobox
        value={time}
        onChange={(t) => t && setTime(t)}
        options={AUDIUS_TIME_RANGES.map((t) => ({ value: t.id, label: t.name }))}
        clearable={false}
        leadingIcon={<Clock size={13} />}
        className="w-40"
      />
      <Combobox
        value={genre}
        onChange={setGenre}
        options={AUDIUS_GENRES.map((g) => ({ value: g.id, label: g.name }))}
        placeholder="All genres"
        leadingIcon={<Tag size={13} />}
        className="w-48"
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search Audius music…" />
    </BrowseToolbar>
  );

  const timeName =
    AUDIUS_TIME_RANGES.find((t) => t.id === time)?.name ?? "This Week";

  // The detail (artist / playlist) overlay — a centered portal modal matching
  // the Podcast + Library modals instead of replacing the browse view.
  const detailAction = detail ? (
    <div className="flex items-center gap-2">
      {detail.kind === "artist" && (
        <button
          type="button"
          onClick={() => toggleFollow(detail.artist)}
          className={
            followIds.has(detail.artist.id)
              ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/90 text-white text-[12.5px]"
              : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black text-[12.5px] font-medium hover:bg-white/90"
          }
        >
          {followIds.has(detail.artist.id) ? <UserCheck size={14} /> : <UserPlus size={14} />}
          {followIds.has(detail.artist.id) ? "Following" : "Follow"}
        </button>
      )}
      {detail.tracks.length > 0 && (
        <button
          type="button"
          onClick={() => playTracks(detail.tracks, 0)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[12.5px] text-neutral-200 hover:bg-white/10"
        >
          <Play size={14} fill="currentColor" /> Play all
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <BrowseShell toolbar={toolbar} header={playerBar}>
      {showSearch ? (
        searchKind === "tracks" ? (
          <MediaGridView
            title={`Tracks for "${deferred.trim()}"`}
            items={trackResults}
            getKey={(t) => t.id}
            loading={searching}
            minColWidth={150}
            emptyLabel="No tracks found."
            renderItem={(t) => renderTrackCard(trackResults, t, true)}
          />
        ) : (
          <MediaGridView
            title={`Artists for "${deferred.trim()}"`}
            items={artistResults}
            getKey={(a) => a.id}
            loading={searching}
            minColWidth={150}
            emptyLabel="No artists found."
            renderItem={(a) => renderArtistCard(a, true)}
          />
        )
      ) : genre ? (
        <MediaGridView
          title={`Trending ${AUDIUS_GENRES.find((g) => g.id === genre)?.name ?? genre} · ${timeName}`}
          items={genreChart}
          getKey={(t) => t.id}
          loading={genreLoading}
          minColWidth={150}
          emptyLabel="No tracks found."
          onBack={() => setGenre(null)}
          renderItem={(t) => renderTrackCard(genreChart, t, true)}
        />
      ) : homeLoading ? (
        <MediaHomeSkeleton rails={3} />
      ) : (
        <>
          {heroItems.length > 0 && (
            <MediaHero
              items={heroItems}
              onPlay={(it) => {
                const t = heroById.get(it.id);
                if (t) playTracks(trending, trending.indexOf(t));
              }}
              onInfo={(it) => {
                const t = heroById.get(it.id);
                if (t?.artist) openArtist({ id: t.artist.id, name: t.artist.name, handle: t.artist.handle, picture: t.artwork });
              }}
              favorites={heroFavorites}
              onToggleFavorite={(id) => {
                const t = heroById.get(id);
                if (t?.artist) toggleFollow({ id: t.artist.id, name: t.artist.name, handle: t.artist.handle, picture: t.artwork });
              }}
              badgeLabel={`Trending on Audius · ${timeName}`}
              primaryLabel="Play"
            />
          )}

          <MediaRail
            title={`Trending tracks · ${timeName}`}
            items={trending}
            getKey={(t) => t.id}
            renderItem={(t) => renderTrackCard(trending, t)}
          />

          {follows.length > 0 && (
            <MediaRail
              title="Following"
              items={follows}
              getKey={(a) => a.id}
              renderItem={(a) =>
                renderArtistCard({
                  id: a.id,
                  name: a.name,
                  handle: a.handle,
                  picture: a.picture,
                  followerCount: null,
                  isVerified: false,
                })
              }
            />
          )}

          {playlists.length > 0 && (
            <MediaRail
              title="Trending playlists"
              items={playlists}
              getKey={(p) => p.id}
              renderItem={(p) => (
                <MediaCard
                  title={p.name}
                  subtitle={p.user?.name ?? null}
                  poster={p.artwork}
                  aspect="1/1"
                  accent="violet"
                  onPick={() => openPlaylist(p)}
                  fallbackIcon={<ListMusic size={30} />}
                  overlayIcon={<ListMusic size={18} />}
                />
              )}
            />
          )}

          {genreRails.map((rail) => (
            <MediaRail
              key={rail.id}
              title={rail.title}
              items={rail.items}
              getKey={(t) => t.id}
              onSeeAll={() => setGenre(rail.id)}
              renderItem={(t) => renderTrackCard(rail.items, t)}
            />
          ))}
        </>
      )}

      <AudioDetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        header={
          detail
            ? {
                title: detail.title,
                subtitle: detail.kind === "playlist" ? detail.subtitle : null,
                image: detail.image,
                meta:
                  detail.tracks.length > 0
                    ? `${detail.tracks.length} track${detail.tracks.length === 1 ? "" : "s"}`
                    : null,
              }
            : null
        }
        fallbackIcon={
          detail?.kind === "playlist" ? <ListMusic size={30} /> : <User size={30} />
        }
        action={detailAction}
        loading={detailLoading}
        rows={
          detail
            ? detail.tracks.map((t, i) => ({
                id: t.id,
                title: t.title,
                meta: [t.artist?.name, t.durationSec != null ? fmtDur(t.durationSec) : null]
                  .filter(Boolean)
                  .join(" · "),
                art: t.artwork,
                active: player.current?.id === t.id,
                playing: player.current?.id === t.id && player.isPlaying,
                onPlay: () => playTracks(detail.tracks, i),
              }))
            : []
        }
        kind="music"
        listTitle="Tracks"
        searchPlaceholder="Search tracks…"
        viewKey="mosaic.audio.music.trackView"
      />
    </BrowseShell>
  );
}
