// Podcast subscriptions + episode resume positions. localStorage, same
// rationale as the other media sections (tiny volumes, zero round-trips).

import type { PodcastSubscription } from "./types";

const SUBS_KEY = "mosaic.podcasts.subscriptions";
const PROGRESS_KEY = "mosaic.podcasts.progress";
const FAV_EPISODES_KEY = "mosaic.podcasts.favoriteEpisodes";

// --- subscriptions --------------------------------------------------------

export function loadSubscriptions(): PodcastSubscription[] {
  try {
    const raw = localStorage.getItem(SUBS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (s) => s && typeof s.feedUrl === "string" && typeof s.title === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveSubscriptions(subs: PodcastSubscription[]) {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(subs));
  } catch {
    /* ignore */
  }
}

export function isSubscribed(feedUrl: string): boolean {
  return loadSubscriptions().some((s) => s.feedUrl === feedUrl);
}

export function addSubscription(sub: PodcastSubscription) {
  const subs = loadSubscriptions().filter((s) => s.feedUrl !== sub.feedUrl);
  saveSubscriptions([sub, ...subs]);
}

export function removeSubscription(feedUrl: string) {
  saveSubscriptions(loadSubscriptions().filter((s) => s.feedUrl !== feedUrl));
}

// --- favorite episodes ----------------------------------------------------
// A flat, cross-show list of starred episodes (distinct from subscriptions,
// which follow a whole show). Stores enough to play + render a row without
// re-fetching the feed.

export type FavoriteEpisode = {
  id: string;
  title: string;
  audioUrl: string;
  image: string | null;
  durationSec: number | null;
  publishedAt: number | null;
  feedUrl: string;
  feedTitle: string;
  addedAt: number;
};

export function loadFavoriteEpisodes(): FavoriteEpisode[] {
  try {
    const raw = localStorage.getItem(FAV_EPISODES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter(
          (e) =>
            e && typeof e.id === "string" && typeof e.audioUrl === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveFavoriteEpisodes(list: FavoriteEpisode[]) {
  try {
    localStorage.setItem(FAV_EPISODES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function isEpisodeFavorite(id: string): boolean {
  return loadFavoriteEpisodes().some((e) => e.id === id);
}

// Add or remove by id; returns the new favorite state (true = now favorited).
export function toggleFavoriteEpisode(ep: FavoriteEpisode): boolean {
  const list = loadFavoriteEpisodes();
  if (list.some((e) => e.id === ep.id)) {
    saveFavoriteEpisodes(list.filter((e) => e.id !== ep.id));
    return false;
  }
  saveFavoriteEpisodes([ep, ...list]);
  return true;
}

// --- episode resume position ----------------------------------------------

export type EpisodeProgress = {
  position: number; // seconds
  duration: number; // seconds
  updatedAt: number;
};

type ProgressMap = Record<string, EpisodeProgress>;

function readProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function getEpisodeProgress(id: string): EpisodeProgress | null {
  return readProgress()[id] ?? null;
}

export function saveEpisodeProgress(id: string, position: number, duration: number) {
  if (!duration || duration < 30) return;
  const map = readProgress();
  // Near the end → drop, so a finished episode doesn't resume at the credits.
  if (position >= duration - 20) {
    delete map[id];
  } else {
    map[id] = { position, duration, updatedAt: Date.now() };
  }
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

// Throttle timeupdate writes (mirrors the video sections' throttledSaver).
export function throttledEpisodeSaver(intervalMs: number) {
  let last = 0;
  return (id: string, position: number, duration: number) => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    saveEpisodeProgress(id, position, duration);
  };
}
