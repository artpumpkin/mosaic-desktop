// Audius domain types. Audius is a free, key-less music network — tracks are
// fully streamable. These are the normalized shapes the Music tab consumes;
// raw API rows are mapped onto them in api.ts. Names are prefixed `Audius*` to
// avoid colliding with the local-library `AudioTrack` (lib/music/types.ts).

import type { CatalogItem } from "@/lib/movies/types";

export type AudiusArtwork = {
  "150x150"?: string;
  "480x480"?: string;
  "1000x1000"?: string;
} | null;

export type AudiusArtist = {
  id: string;
  name: string;
  handle: string;
  followerCount: number | null;
  isVerified: boolean;
  picture: string | null;
};

export type AudiusTrack = {
  id: string;
  title: string;
  durationSec: number | null;
  genre: string | null;
  playCount: number | null;
  permalink: string | null;
  artwork: string | null;
  artist: { id: string; name: string; handle: string } | null;
};

export type AudiusPlaylist = {
  id: string;
  name: string;
  artwork: string | null;
  trackCount: number | null;
  user: { id: string; name: string } | null;
};

// Prefer a mid-size square; fall back up then down.
export function pickArtwork(a: AudiusArtwork): string | null {
  if (!a) return null;
  return a["480x480"] || a["1000x1000"] || a["150x150"] || null;
}

export function audiusTrackToHeroItem(t: AudiusTrack): CatalogItem {
  return {
    id: t.id,
    type: "movie",
    name: t.title,
    poster: t.artwork,
    background: t.artwork,
    releaseInfo: t.artist?.name ?? null,
    genres: t.genre ? [t.genre] : undefined,
    runtime: t.durationSec != null ? fmtDur(t.durationSec) : null,
    description: t.artist ? `Trending on Audius · ${t.artist.name}` : "Trending on Audius",
  };
}

export function audiusPlaylistToHeroItem(p: AudiusPlaylist): CatalogItem {
  return {
    id: p.id,
    type: "series",
    name: p.name,
    poster: p.artwork,
    background: p.artwork,
    releaseInfo: p.user?.name ?? null,
    description: "Trending playlist on Audius",
  };
}

export function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}
