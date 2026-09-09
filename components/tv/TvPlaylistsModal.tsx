"use client";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Tv, ListPlus, Radio, Plus, X } from "lucide-react";
import { getTvSources } from "@/lib/settings";
import { useFinanceData } from "@/lib/query/useFinanceData";
import {
  ActiveTvSourceForm,
  AddTvSourceForm,
  PlaylistsTable,
} from "@/components/forms/TvSourcesForms";

/**
 * Manage-playlists surface, presented as a modal over the TV page instead of a
 * separate /tv/settings route. Mirrors the settings page content; the TV page
 * stays in sync via the `tv:sources` invalidation bus, so no callback wiring is
 * needed beyond closing the modal.
 */
export default function TvPlaylistsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data, reload } = useFinanceData(["tv:sources"], getTvSources);

  // Close on Escape for parity with the other modals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 md:p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-violet-500/20 text-violet-300">
                <Tv size={15} />
              </span>
              TV playlists
            </h2>
            <p className="text-sm text-neutral-400 mt-1.5">
              Add your own M3U playlists alongside the built-in iptv-org source.
              Switch between them anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-neutral-400 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {data && (
          <>
            <section>
              <h3 className="font-medium mb-2 flex items-center gap-2">
                <Radio size={16} className="text-violet-300" /> Active source
              </h3>
              <p className="text-sm text-neutral-400 mb-4">
                Channels currently shown on the TV page come from this source.
              </p>
              <ActiveTvSourceForm state={data} />
            </section>

            <section>
              <h3 className="font-medium mb-2 flex items-center gap-2">
                <ListPlus size={16} className="text-violet-300" /> Your playlists
              </h3>
              <p className="text-sm text-neutral-400 mb-4">
                M3U playlists you&apos;ve added. Click pencil to rename or change
                the URL.
              </p>
              <PlaylistsTable state={data} />
            </section>

            <section>
              <h3 className="font-medium mb-2 flex items-center gap-2">
                <Plus size={16} className="text-violet-300" /> Add a playlist
              </h3>
              <p className="text-sm text-neutral-400 mb-4">
                Paste an M3U URL from your IPTV provider. EPG (XMLTV) is optional
                and stored for future use.
              </p>
              <AddTvSourceForm onAdded={reload} />
            </section>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
