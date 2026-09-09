// Shared cache helper for Cinemeta/Torrentio JSON responses. Mirrors the
// pattern in lib/tv/api.ts (readCache/writeCache) but keyed by URL and with
// per-entry TTLs since catalog data evolves at different rates than stream
// availability.

type CacheEntry<T> = {
  fetchedAt: number;
  data: T;
};

const CACHE_PREFIX = "mosaic.movies.cache:";

export async function fetchJsonCached<T>(
  url: string,
  ttlMs: number,
): Promise<T> {
  const key = CACHE_PREFIX + url;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      if (
        parsed &&
        typeof parsed.fetchedAt === "number" &&
        Date.now() - parsed.fetchedAt < ttlMs
      ) {
        return parsed.data;
      }
    }
  } catch {
    /* corrupt cache — fall through */
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const data = (await res.json()) as T;
  try {
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* quota — acceptable; refetch next time */
  }
  return data;
}

export function clearMoviesCache() {
  try {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) toDelete.push(k);
    }
    for (const k of toDelete) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
