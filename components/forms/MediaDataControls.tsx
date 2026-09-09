"use client";
// Clear-stored-data controls for the Settings page. Two-click confirm per row
// (click "Clear" → "Confirm?" → click again within a few seconds) so a stray
// click can't wipe data, with toast feedback. Pages re-read their storage on
// next mount, so cleared data disappears the next time you open the section.

import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  clearMoviesContinueWatching,
  clearMoviesFavorites,
  clearTvFavoritesAndRecents,
  clearTvListCache,
  clearAllMediaData,
} from "@/lib/clearData";

type Action = {
  key: string;
  label: string;
  desc: string;
  done: string; // toast on success
  run: () => void | Promise<void>;
};

const ACTIONS: Action[] = [
  {
    key: "cw",
    label: "Continue watching",
    desc: "Movies & shows resume list",
    done: "Continue-watching cleared",
    run: clearMoviesContinueWatching,
  },
  {
    key: "favm",
    label: "Movie favorites",
    desc: "Starred movies & series",
    done: "Movie favorites cleared",
    run: clearMoviesFavorites,
  },
  {
    key: "tv",
    label: "TV favorites & recents",
    desc: "Starred + recently-watched channels",
    done: "TV favorites & recents cleared",
    run: clearTvFavoritesAndRecents,
  },
  {
    key: "tvcache",
    label: "Cached channel lists",
    desc: "Re-downloads on next open",
    done: "Cached channel lists cleared",
    run: clearTvListCache,
  },
];

export function MediaDataControls() {
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trigger = async (key: string, run: () => void | Promise<void>, done: string) => {
    if (armed !== key) {
      setArmed(key);
      window.setTimeout(
        () => setArmed((cur) => (cur === key ? null : cur)),
        3500,
      );
      return;
    }
    setArmed(null);
    setBusy(true);
    try {
      await run();
      toast("ok", done);
    } catch {
      toast("err", "Couldn't clear that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {ACTIONS.map((a) => (
        <div
          key={a.key}
          className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0"
        >
          <div className="min-w-0">
            <div className="text-sm text-neutral-200">{a.label}</div>
            <div className="text-xs text-neutral-500 truncate">{a.desc}</div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => trigger(a.key, a.run, a.done)}
            className={
              armed === a.key
                ? "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/20 border border-rose-400/40 text-rose-200 hover:bg-rose-500/30"
                : "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/10 text-neutral-300 hover:bg-white/[0.08] disabled:opacity-50"
            }
          >
            <Trash2 size={13} />
            {armed === a.key ? "Confirm?" : "Clear"}
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-white/10">
        <div className="min-w-0">
          <div className="text-sm text-rose-200/90 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Clear all media data
          </div>
          <div className="text-xs text-neutral-500 truncate">
            Everything above, for Movies + TV
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => trigger("all", clearAllMediaData, "All media data cleared")}
          className={
            armed === "all"
              ? "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/30 border border-rose-400/50 text-rose-100 hover:bg-rose-500/40"
              : "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-rose-500/10 border border-rose-400/30 text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
          }
        >
          <Trash2 size={13} />
          {armed === "all" ? "Confirm wipe?" : "Clear all"}
        </button>
      </div>
    </div>
  );
}
