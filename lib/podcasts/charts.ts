// Podcast discovery via Apple's free Top Charts RSS-JSON feed (no key). The
// chart rows carry a collectionId but no feedUrl, so we resolve feedUrls in a
// single batched iTunes `lookup` call — that's what makes a charted show
// subscribable/openable. Fetched through afetch (CORS-free in the Tauri runtime).

import { afetch } from "@/lib/audio/fetch";
import type { ItunesPodcast } from "./types";

// iTunes podcast category ids (genre 26 = Podcasts). The curated subset used for
// the genre picker + a few home rails.
export const PODCAST_GENRES: { id: string; name: string }[] = [
  { id: "1301", name: "Arts" },
  { id: "1321", name: "Business" },
  { id: "1303", name: "Comedy" },
  { id: "1304", name: "Education" },
  { id: "1483", name: "Fiction" },
  { id: "1511", name: "Government" },
  { id: "1512", name: "Health & Fitness" },
  { id: "1487", name: "History" },
  { id: "1305", name: "Kids & Family" },
  { id: "1502", name: "Leisure" },
  { id: "1310", name: "Music" },
  { id: "1489", name: "News" },
  { id: "1314", name: "Religion & Spirituality" },
  { id: "1533", name: "Science" },
  { id: "1324", name: "Society & Culture" },
  { id: "1545", name: "Sports" },
  { id: "1309", name: "TV & Film" },
  { id: "1318", name: "Technology" },
  { id: "1488", name: "True Crime" },
];

// Storefronts for the country picker (Apple uses ISO-3166 alpha-2, lowercased).
export const PODCAST_COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "us", name: "United States", flag: "🇺🇸" },
  { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
  { code: "ca", name: "Canada", flag: "🇨🇦" },
  { code: "au", name: "Australia", flag: "🇦🇺" },
  { code: "de", name: "Germany", flag: "🇩🇪" },
  { code: "fr", name: "France", flag: "🇫🇷" },
  { code: "es", name: "Spain", flag: "🇪🇸" },
  { code: "it", name: "Italy", flag: "🇮🇹" },
  { code: "br", name: "Brazil", flag: "🇧🇷" },
  { code: "mx", name: "Mexico", flag: "🇲🇽" },
  { code: "jp", name: "Japan", flag: "🇯🇵" },
  { code: "in", name: "India", flag: "🇮🇳" },
  { code: "nl", name: "Netherlands", flag: "🇳🇱" },
  { code: "se", name: "Sweden", flag: "🇸🇪" },
  { code: "ma", name: "Morocco", flag: "🇲🇦" },
];

type ChartEntry = {
  "im:name"?: { label?: string };
  "im:artist"?: { label?: string };
  "im:image"?: { label?: string }[];
  id?: { attributes?: { "im:id"?: string } };
};

type LookupRow = {
  collectionId?: number;
  trackId?: number;
  feedUrl?: string;
};

// Resolve feedUrls for a batch of collection ids via a single lookup call.
async function resolveFeedUrls(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const res = await afetch(`https://itunes.apple.com/lookup?id=${ids.join(",")}`);
    if (!res.ok) return out;
    const json = (await res.json()) as { results?: LookupRow[] };
    for (const r of json.results ?? []) {
      const id = String(r.collectionId ?? r.trackId ?? "");
      if (id && r.feedUrl) out.set(id, r.feedUrl);
    }
  } catch {
    /* leave feedUrls unresolved → rows render but aren't openable */
  }
  return out;
}

export async function getTopPodcasts(
  country: string,
  genreId?: string,
  limit = 24,
): Promise<ItunesPodcast[]> {
  const genrePart = genreId ? `/genre=${genreId}` : "";
  const url = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}${genrePart}/json`;
  const res = await afetch(url);
  if (!res.ok) throw new Error(`iTunes charts → ${res.status}`);
  const json = (await res.json()) as { feed?: { entry?: ChartEntry | ChartEntry[] } };

  const raw = json.feed?.entry;
  const entries: ChartEntry[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const rows = entries.map((e) => {
    const images = e["im:image"] ?? [];
    return {
      collectionId: e.id?.attributes?.["im:id"] ?? "",
      title: e["im:name"]?.label ?? "Untitled",
      author: e["im:artist"]?.label ?? null,
      image: images.length ? (images[images.length - 1]?.label ?? null) : null,
    };
  });

  const feedUrls = await resolveFeedUrls(rows.map((r) => r.collectionId).filter(Boolean));

  // Drop chart rows whose feed couldn't be resolved — they can't be opened or
  // subscribed to, so there's nothing actionable to show.
  return rows
    .map((r) => ({
      feedUrl: feedUrls.get(r.collectionId) ?? "",
      title: r.title,
      author: r.author,
      image: r.image,
    }))
    .filter((p) => p.feedUrl !== "");
}
