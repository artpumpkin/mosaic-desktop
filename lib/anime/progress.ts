// Watch-progress + favorites + recents for the Anime section. Same behavior
// and shape as Movies (lib/movies/progress.ts) but namespaced under
// `mosaic.anime.*`, so anime continue-watching never mixes into the Movies
// rail. Built on the shared factory to avoid forking the logic.

import { createWatchProgressStore } from "@/lib/media/watchProgressStore";

export const animeProgress = createWatchProgressStore("mosaic.anime");

export const {
  getProgress,
  saveProgress,
  clearProgress,
  clearAllProgress,
  updateTrackPrefs,
  listInProgress,
  loadFavorites,
  saveFavorites,
  clearAllFavorites,
  loadRecents,
  pushRecent,
  clearAllRecents,
  throttledSaver,
  progressCount,
  recentsCount,
  favoritesCount,
  loadWatched,
  markWatched,
  unmarkWatched,
  clearAllWatched,
  watchedCount,
} = animeProgress;
