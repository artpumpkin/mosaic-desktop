// Recents + favorites persistence for the TV section. Extracted from
// app/tv/page.tsx so the Dashboard "Up next" rail (lib/continue/aggregate.ts)
// can read the same data without duplicating the storage contract.
//
// Recents are stored as enriched entries (id + name + logo + timestamp) rather
// than bare ids so the Dashboard can render a real channel name/logo without
// loading the whole IPTV dataset. Legacy string[] payloads (the pre-extraction
// format) are tolerated on read and upgraded on the next write.

export type TvRecent = {
  id: string;
  name: string;
  logo: string | null;
  at: number; // epoch ms
};

// TV and Radio keep separate history/favorites — station ids and channel ids
// live in different namespaces and shouldn't bleed into each other's lists
// (or onto the Dashboard, which reads the "tv" kind only).
export type MediaKind = "tv" | "radio";

const RECENTS_KEY = "mosaic.tv.recent";
const FAVORITES_KEY = "mosaic.tv.favorites";
const RADIO_RECENTS_KEY = "mosaic.radio.recent";
const RADIO_FAVORITES_KEY = "mosaic.radio.favorites";
export const TV_RECENTS_MAX = 12;

function recentsKey(kind: MediaKind): string {
  return kind === "radio" ? RADIO_RECENTS_KEY : RECENTS_KEY;
}

function favoritesKey(kind: MediaKind): string {
  return kind === "radio" ? RADIO_FAVORITES_KEY : FAVORITES_KEY;
}

export function loadTvRecents(kind: MediaKind = "tv"): TvRecent[] {
  try {
    const raw = localStorage.getItem(recentsKey(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((e): TvRecent | null => {
        // Legacy format: a bare channel-id string.
        if (typeof e === "string") return { id: e, name: e, logo: null, at: 0 };
        if (e && typeof e.id === "string") {
          return {
            id: e.id,
            name: typeof e.name === "string" ? e.name : e.id,
            logo: typeof e.logo === "string" ? e.logo : null,
            at: typeof e.at === "number" ? e.at : 0,
          };
        }
        return null;
      })
      .filter((e): e is TvRecent => e !== null);
  } catch {
    return [];
  }
}

export function saveTvRecents(entries: TvRecent[], kind: MediaKind = "tv") {
  try {
    localStorage.setItem(
      recentsKey(kind),
      JSON.stringify(entries.slice(0, TV_RECENTS_MAX)),
    );
  } catch {
    /* ignore */
  }
}

export function loadTvFavorites(kind: MediaKind = "tv"): string[] {
  try {
    const raw = localStorage.getItem(favoritesKey(kind));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function saveTvFavorites(ids: string[], kind: MediaKind = "tv") {
  try {
    localStorage.setItem(favoritesKey(kind), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}
