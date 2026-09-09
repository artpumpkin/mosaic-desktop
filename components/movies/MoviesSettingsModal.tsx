"use client";
// Movies settings = the shared MediaSettingsModal wired with movie data rows.
import MediaSettingsModal from "@/components/browse/MediaSettingsModal";
import {
  moviesContinueCount,
  clearMoviesContinueWatching,
  clearMoviesFavorites,
  clearMoviesRecents,
} from "@/lib/clearData";

// Movies persists to these localStorage keys (see lib/movies/progress.ts).
const FAV_KEY = "mosaic.movies.favorites";
const RECENTS_KEY = "mosaic.movies.recents";

function jsonLen(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.length : 0;
  } catch {
    return 0;
  }
}

export default function MoviesSettingsModal({
  open,
  onClose,
  onDataChanged,
}: {
  open: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
}) {
  return (
    <MediaSettingsModal
      open={open}
      onClose={onClose}
      onDataChanged={onDataChanged}
      title="Movies settings"
      description="Manage your streaming token and locally-stored movies data."
      rows={[
        {
          key: "continue",
          label: "Continue watching",
          desc: "Resume progress",
          count: moviesContinueCount,
          done: "Continue-watching cleared",
          run: clearMoviesContinueWatching,
        },
        {
          key: "favorites",
          label: "Favorites",
          desc: "Starred movies & series",
          count: () => jsonLen(FAV_KEY),
          done: "Favorites cleared",
          run: clearMoviesFavorites,
        },
        {
          key: "recents",
          label: "Recently picked",
          desc: "Recently-opened titles",
          count: () => jsonLen(RECENTS_KEY),
          done: "Recently-picked cleared",
          run: clearMoviesRecents,
        },
      ]}
      clearAllLabel="Clear all movies data"
      clearAllDesc="Continue-watching, favorites & recents"
      clearAllDone="All movies data cleared"
      onClearAll={() => {
        clearMoviesContinueWatching();
        clearMoviesFavorites();
        clearMoviesRecents();
      }}
    />
  );
}
