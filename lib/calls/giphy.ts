// Giphy's old public demo key was revoked. Each user now needs their own
// free key from https://developers.giphy.com/dashboard/. Keys are stored
// per-machine in localStorage so you only set it once.
const STORAGE_KEY = "mosaic.calls.giphyKey";

export function getGiphyKey(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setGiphyKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
  else window.localStorage.removeItem(STORAGE_KEY);
}

export class GiphyAuthError extends Error {
  constructor() {
    super("Giphy API key missing or invalid");
    this.name = "GiphyAuthError";
  }
}

const BASE = "https://api.giphy.com/v1/gifs";

export type GiphyResult = {
  id: string;
  previewUrl: string;
  fullUrl: string;
  title: string;
};

type GiphyRaw = {
  id: string;
  title: string;
  images: {
    fixed_width_small: { url: string };
    original: { url: string };
  };
};

async function call(path: string): Promise<GiphyResult[]> {
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 401 || res.status === 403) throw new GiphyAuthError();
  if (!res.ok) throw new Error(`Giphy ${res.status}`);
  const json = (await res.json()) as { data: GiphyRaw[] };
  return json.data.map((g) => ({
    id: g.id,
    title: g.title,
    previewUrl: g.images.fixed_width_small.url,
    fullUrl: g.images.original.url,
  }));
}

export function searchGiphy(query: string): Promise<GiphyResult[]> {
  const key = getGiphyKey();
  if (!key) return Promise.reject(new GiphyAuthError());
  const q = query.trim();
  if (!q) return call(`/trending?api_key=${key}&limit=24&rating=g`);
  return call(
    `/search?api_key=${key}&q=${encodeURIComponent(q)}&limit=24&rating=g`,
  );
}
