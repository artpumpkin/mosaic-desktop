// Audius REST API — free, no key required (production calls just append an
// app_name). Flow: discover a host once (cached for the session), then hit
// {host}/v1/... for trending/search/artist/playlist data. Tracks stream
// directly from {host}/v1/tracks/{id}/stream (302 → mp3), so playback needs no
// fetch — the URL is fed straight to an <audio> element.
//
// All JSON reads go through afetch so they work in the Tauri runtime (the http
// plugin bypasses CORS, already allowed by the capability allowlist).

import { afetch } from "@/lib/audio/fetch";
import type {
  AudiusArtist,
  AudiusArtwork,
  AudiusPlaylist,
  AudiusTrack,
} from "./types";
import { pickArtwork } from "./types";

const APP_NAME = "Mosaic";
const FALLBACK_HOSTS = [
  "https://api.audius.co",
  "https://discoveryprovider.audius.co",
];

let hostPromise: Promise<string> | null = null;

// Discover a discovery-node host. api.audius.co returns a ranked list; we take
// the first and cache the resolved host for the session. Recommended to re-pick
// per app start (availability shifts over time), which a fresh module load does.
export async function getHost(): Promise<string> {
  if (hostPromise) return hostPromise;
  hostPromise = (async () => {
    try {
      const res = await afetch("https://api.audius.co");
      if (res.ok) {
        const json = (await res.json()) as { data?: string[] };
        const host = json.data?.find((h) => typeof h === "string" && h.startsWith("http"));
        if (host) return host.replace(/\/$/, "");
      }
    } catch {
      /* fall through to a static host */
    }
    return FALLBACK_HOSTS[0];
  })();
  return hostPromise;
}

// Build the playable stream URL. Sync (host is resolved by the caller via
// getHost) so it can be mapped over a queue without awaiting per track.
export function streamUrl(host: string, trackId: string): string {
  return `${host}/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`;
}

// --- normalizers ----------------------------------------------------------

type RawTrack = {
  id?: string;
  title?: string;
  duration?: number;
  genre?: string;
  play_count?: number;
  permalink?: string;
  artwork?: AudiusArtwork;
  user?: { id?: string; name?: string; handle?: string };
};

type RawUser = {
  id?: string;
  name?: string;
  handle?: string;
  follower_count?: number;
  is_verified?: boolean;
  profile_picture?: AudiusArtwork;
};

type RawPlaylist = {
  id?: string;
  playlist_name?: string;
  artwork?: AudiusArtwork;
  track_count?: number;
  total_play_count?: number;
  user?: { id?: string; name?: string };
};

function toTrack(r: RawTrack): AudiusTrack | null {
  if (!r.id || !r.title) return null;
  return {
    id: r.id,
    title: r.title,
    durationSec: typeof r.duration === "number" ? r.duration : null,
    genre: r.genre ?? null,
    playCount: typeof r.play_count === "number" ? r.play_count : null,
    permalink: r.permalink ?? null,
    artwork: pickArtwork(r.artwork ?? null),
    artist: r.user?.id
      ? { id: r.user.id, name: r.user.name ?? "Unknown", handle: r.user.handle ?? "" }
      : null,
  };
}

function toArtist(r: RawUser): AudiusArtist | null {
  if (!r.id || !r.name) return null;
  return {
    id: r.id,
    name: r.name,
    handle: r.handle ?? "",
    followerCount: typeof r.follower_count === "number" ? r.follower_count : null,
    isVerified: !!r.is_verified,
    picture: pickArtwork(r.profile_picture ?? null),
  };
}

function toPlaylist(r: RawPlaylist): AudiusPlaylist | null {
  if (!r.id || !r.playlist_name) return null;
  return {
    id: r.id,
    name: r.playlist_name,
    artwork: pickArtwork(r.artwork ?? null),
    trackCount: typeof r.track_count === "number" ? r.track_count : null,
    user: r.user?.id ? { id: r.user.id, name: r.user.name ?? "Unknown" } : null,
  };
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const host = await getHost();
  const q = new URLSearchParams({ app_name: APP_NAME, ...params }).toString();
  const res = await afetch(`${host}${path}?${q}`);
  if (!res.ok) throw new Error(`Audius ${path} → ${res.status}`);
  return (await res.json()) as T;
}

// --- queries --------------------------------------------------------------

export async function getTrendingTracks(
  genre?: string,
  time?: string,
): Promise<AudiusTrack[]> {
  const params: Record<string, string> = {};
  if (genre) params.genre = genre;
  if (time) params.time = time;
  const json = await getJson<{ data?: RawTrack[] }>("/v1/tracks/trending", params);
  return dedupe((json.data ?? []).map(toTrack).filter((t): t is AudiusTrack => !!t));
}

export async function getTrendingPlaylists(time?: string): Promise<AudiusPlaylist[]> {
  const json = await getJson<{ data?: RawPlaylist[] }>(
    "/v1/playlists/trending",
    time ? { time } : {},
  );
  return dedupe(
    (json.data ?? []).map(toPlaylist).filter((p): p is AudiusPlaylist => !!p),
  );
}

export async function searchTracks(query: string): Promise<AudiusTrack[]> {
  const q = query.trim();
  if (!q) return [];
  const json = await getJson<{ data?: RawTrack[] }>("/v1/tracks/search", { query: q });
  return dedupe((json.data ?? []).map(toTrack).filter((t): t is AudiusTrack => !!t));
}

export async function searchArtists(query: string): Promise<AudiusArtist[]> {
  const q = query.trim();
  if (!q) return [];
  const json = await getJson<{ data?: RawUser[] }>("/v1/users/search", { query: q });
  return dedupe(
    (json.data ?? []).map(toArtist).filter((a): a is AudiusArtist => !!a),
  );
}

export async function getArtistTracks(artistId: string): Promise<AudiusTrack[]> {
  const json = await getJson<{ data?: RawTrack[] }>(`/v1/users/${artistId}/tracks`);
  return dedupe((json.data ?? []).map(toTrack).filter((t): t is AudiusTrack => !!t));
}

export async function getPlaylistTracks(playlistId: string): Promise<AudiusTrack[]> {
  const json = await getJson<{ data?: RawTrack[] }>(`/v1/playlists/${playlistId}/tracks`);
  return dedupe((json.data ?? []).map(toTrack).filter((t): t is AudiusTrack => !!t));
}
