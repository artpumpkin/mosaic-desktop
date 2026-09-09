// Keyboard shortcuts for the mpv player. Mirrors the bindings most
// players use (YouTube / IINA / Stremio):
//
//   Space, K        play/pause
//   J               seek -10s
//   L               seek +10s
//   Left arrow      seek -5s
//   Right arrow     seek +5s
//   Up arrow        volume +5
//   Down arrow      volume -5
//   M               toggle mute
//   F               toggle fullscreen
//   Escape          exit fullscreen (no-op when windowed)
//   0-9             jump to N*10% of duration
//
// Skips the listener when focus is in an input/textarea/contenteditable
// so typing doesn't accidentally scrub.

"use client";

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { mpv, VOLUME_MAX } from "../mpv";
import { trackAction } from "../playerDebug";
import { logger } from "../logger";

function swallow(label: string) {
  return (err: unknown) => {
    logger.warn("player/hotkeys", `${label} failed`, { err: String(err) });
  };
}

// Run an action under trackAction with a "hotkey: " prefix so the
// debug timeline distinguishes keyboard-driven actions from button
// clicks.
function hot<T>(label: string, ctx: Record<string, unknown>, p: Promise<T>) {
  return trackAction(`hotkey: ${label}`, ctx, p);
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

export type MpvHotkeysOptions = {
  /** Set to false to disable the hotkeys entirely (e.g. when no player
   *  is active). Default true. */
  enabled?: boolean;
};

export function useMpvHotkeys(options: MpvHotkeysOptions = {}) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;
    // Track last-known state so seek-relative and volume-relative
    // commands have something to base off of. mpv's own `seek`
    // command takes a relative offset directly so we don't strictly
    // need the time-pos here, but volume nudges do.
    let lastVolume = 100;
    let lastMuted = false;
    let lastDuration = 0;
    let lastEof = false;

    const offState = mpv.onState((s) => {
      if (s.volume != null) lastVolume = s.volume;
      if (s.muted != null) lastMuted = s.muted;
      if (s.duration != null) lastDuration = s.duration;
      lastEof = s.eof;
    });

    const handler = async (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // Ignore when modifier keys are held — those are reserved for
      // app-level shortcuts (Cmd+R reload, etc).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      // Number keys: jump to N*10% of duration.
      if (/^[0-9]$/.test(key)) {
        const pct = parseInt(key, 10) / 10;
        if (lastDuration > 0) {
          e.preventDefault();
          hot(`seek ${key}0%`, { to: lastDuration * pct }, mpv.seek(lastDuration * pct)).catch(
            swallow("seek"),
          );
        }
        return;
      }

      switch (key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          if (lastEof) {
            // Ended (keep-open parks on the last frame): replay from 0
            // rather than toggling the (already-false) pause flag.
            hot(
              "replay",
              {},
              mpv.seek(0, "absolute").then(() => mpv.setProperty("pause", false)),
            ).catch(swallow("replay"));
          } else {
            hot("toggle pause", {}, mpv.command("cycle", ["pause"])).catch(
              swallow("cycle pause"),
            );
          }
          break;
        case "j":
        case "J":
          e.preventDefault();
          hot("seek -10", {}, mpv.seek(-10, "relative")).catch(swallow("seek"));
          break;
        case "l":
        case "L":
          e.preventDefault();
          hot("seek +10", {}, mpv.seek(10, "relative")).catch(swallow("seek"));
          break;
        case "ArrowLeft":
          e.preventDefault();
          hot("seek -5", {}, mpv.seek(-5, "relative")).catch(swallow("seek"));
          break;
        case "ArrowRight":
          e.preventDefault();
          hot("seek +5", {}, mpv.seek(5, "relative")).catch(swallow("seek"));
          break;
        case "ArrowUp": {
          e.preventDefault();
          // Cap at VOLUME_MAX (shared with the slider) so the keyboard
          // can't push volume to a value the slider can't represent.
          const next = Math.min(VOLUME_MAX, lastVolume + 5);
          hot("vol +5", { to: next }, mpv.setProperty("volume", next)).catch(
            swallow("volume"),
          );
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const next = Math.max(0, lastVolume - 5);
          hot("vol -5", { to: next }, mpv.setProperty("volume", next)).catch(
            swallow("volume"),
          );
          break;
        }
        case "m":
        case "M":
          e.preventDefault();
          hot(
            "toggle mute",
            { wasMuted: lastMuted },
            mpv.setProperty("mute", !lastMuted),
          ).catch(swallow("mute"));
          break;
        case "f":
        case "F":
          e.preventDefault();
          // mpv's own `fullscreen` property is a no-op under vo=libmpv
          // (we own the surface, mpv has no window to flip). Drive the
          // Tauri window directly — same path the button uses.
          hot("toggle fullscreen", {}, mpv.toggleFullscreen()).catch(
            swallow("fullscreen"),
          );
          break;
        case "Escape":
          // Escape exits fullscreen if we're in it. Don't preventDefault
          // unconditionally so non-fullscreen Escape still closes open
          // menus / modals elsewhere in the app.
          {
            const win = getCurrentWindow();
            hot(
              "escape: exit fullscreen?",
              {},
              win.isFullscreen().then((fs) => {
                if (fs) {
                  e.preventDefault();
                  return win.setFullscreen(false);
                }
              }),
            ).catch(swallow("escape-exit-fullscreen"));
          }
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      offState();
    };
  }, [enabled]);
}
