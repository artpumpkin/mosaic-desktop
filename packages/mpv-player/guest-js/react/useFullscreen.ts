// Hook that tracks whether the Tauri main window is in fullscreen mode.
//
// Used by MpvPlayer + PlayerControls so they can re-layout when the
// window goes fullscreen:
//   - MpvPlayer's placeholder div escapes the page layout AND reserves
//     a bottom strip so the native NSView doesn't paint over the
//     controls bar.
//   - PlayerControls promotes itself to a fixed bottom overlay so it
//     stays visible.
//
// Polling/observation strategy: `window.onResized` fires reliably on
// the macOS fullscreen transition (the window's content rect changes).
// We re-query `isFullscreen()` on every resize — cheaper than tracking
// the exact transition, and not racey because the state always settles
// to the right value after the final resize event.
//
// SHARED listener: multiple components use this hook (MpvPlayer,
// PlayerControls, …). Registering one `onResized` per consumer meant N
// `isFullscreen()` IPC round-trips on EVERY resize event — multiplied
// across a resize-drag that's a lot of redundant bridge traffic. Instead
// we keep a single module-level listener + value and fan out to all
// subscribers. One listener total, regardless of how many hooks mount.

"use client";

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "../logger";

let sharedValue = false;
let initialized = false;
const subscribers = new Set<(v: boolean) => void>();

function notify(v: boolean) {
  if (v === sharedValue) return;
  sharedValue = v;
  for (const fn of subscribers) {
    try {
      fn(v);
    } catch {
      /* ignore */
    }
  }
}

// Lazily start the single shared listener on first subscriber. Kept alive
// for the app session (the window outlives any individual player mount),
// which also sidesteps async re-init races on remount.
function ensureListener() {
  if (initialized) return;
  initialized = true;
  const win = getCurrentWindow();
  void (async () => {
    try {
      notify(await win.isFullscreen());
      await win.onResized(async () => {
        try {
          notify(await win.isFullscreen());
        } catch (e) {
          logger.warn("player/fullscreen", "isFullscreen failed", {
            e: String(e),
          });
        }
      });
    } catch (e) {
      logger.warn("player/fullscreen", "listener failed", { e: String(e) });
    }
  })();
}

export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(sharedValue);

  useEffect(() => {
    // Seed with the latest shared value in case it changed between render
    // and effect (or this is a late mount after the listener settled).
    setFullscreen(sharedValue);
    subscribers.add(setFullscreen);
    ensureListener();
    return () => {
      subscribers.delete(setFullscreen);
    };
  }, []);

  return fullscreen;
}
