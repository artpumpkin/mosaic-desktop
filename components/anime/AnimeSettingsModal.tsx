"use client";
// Anime settings = the shared MediaSettingsModal wired with anime data rows.
import MediaSettingsModal from "@/components/browse/MediaSettingsModal";
import {
  clearAllProgress,
  clearAllFavorites,
  clearAllRecents,
  clearAllWatched,
  progressCount,
  favoritesCount,
  recentsCount,
  watchedCount,
} from "@/lib/anime/progress";

export default function AnimeSettingsModal({
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
      title="Anime settings"
      description="Manage your streaming token and locally-stored anime data."
      rows={[
        {
          key: "history",
          label: "Watch history",
          desc: "Resume progress + watched marks",
          count: () => safe(progressCount) + safe(watchedCount),
          done: "Watch history cleared",
          run: () => {
            clearAllProgress();
            clearAllWatched();
          },
        },
        {
          key: "favorites",
          label: "Favorites",
          desc: "Starred anime",
          count: () => safe(favoritesCount),
          done: "Favorites cleared",
          run: clearAllFavorites,
        },
        {
          key: "recents",
          label: "Recently watched",
          desc: "Recently-opened titles",
          count: () => safe(recentsCount),
          done: "Recently-watched cleared",
          run: clearAllRecents,
        },
      ]}
      clearAllLabel="Clear all anime data"
      clearAllDesc="History, favorites & recently-watched"
      clearAllDone="All anime data cleared"
      onClearAll={() => {
        clearAllProgress();
        clearAllWatched();
        clearAllFavorites();
        clearAllRecents();
      }}
    />
  );
}

function safe(fn: () => number): number {
  try {
    return fn() || 0;
  } catch {
    return 0;
  }
}
