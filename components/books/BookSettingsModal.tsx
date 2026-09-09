"use client";
import MediaSettingsModal from "@/components/browse/MediaSettingsModal";
import {
  clearAllProgress,
  clearAllFavorites,
  clearAllRecents,
  progressCount,
  favoritesCount,
  recentsCount,
} from "@/lib/books/progress";
import { clearLocalLibrary, localLibraryCount } from "@/lib/books/library";

export default function BookSettingsModal({
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
      title="Books settings"
      description="Manage locally-stored reading data and your EPUB library cache."
      rows={[
        {
          key: "history",
          label: "Reading progress",
          desc: "Saved positions in books",
          count: () => safe(progressCount),
          done: "Reading progress cleared",
          run: clearAllProgress,
        },
        {
          key: "favorites",
          label: "Favorites",
          desc: "Starred books",
          count: () => safe(favoritesCount),
          done: "Favorites cleared",
          run: clearAllFavorites,
        },
        {
          key: "recents",
          label: "Recently opened",
          desc: "Recently-viewed titles",
          count: () => safe(recentsCount),
          done: "Recently-opened cleared",
          run: clearAllRecents,
        },
        {
          key: "library",
          label: "Local library",
          desc: "Scanned EPUB entries & links",
          count: () => safe(localLibraryCount),
          done: "Local library cleared",
          run: clearLocalLibrary,
        },
      ]}
      clearAllLabel="Clear all books data"
      clearAllDesc="Progress, favorites, recents & local library"
      clearAllDone="All books data cleared"
      onClearAll={() => {
        clearAllProgress();
        clearAllFavorites();
        clearAllRecents();
        clearLocalLibrary();
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
