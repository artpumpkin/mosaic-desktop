// Podcast discovery via the iTunes Search API — no key required. Fetched
// through afetch so it works in the Tauri runtime regardless of CORS.

import { afetch } from "@/lib/audio/fetch";
import type { ItunesPodcast } from "./types";

type ItunesRow = {
  feedUrl?: string;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
};

export async function searchPodcasts(query: string): Promise<ItunesPodcast[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://itunes.apple.com/search?media=podcast&limit=25&term=${encodeURIComponent(
    q,
  )}`;
  const res = await afetch(url);
  if (!res.ok) throw new Error(`iTunes search → ${res.status}`);
  const json = (await res.json()) as { results?: ItunesRow[] };
  const out: ItunesPodcast[] = [];
  for (const r of json.results ?? []) {
    if (!r.feedUrl) continue; // can't subscribe without a feed
    out.push({
      feedUrl: r.feedUrl,
      title: r.collectionName || r.trackName || "Untitled",
      author: r.artistName ?? null,
      image: r.artworkUrl600 || r.artworkUrl100 || null,
    });
  }
  return out;
}
