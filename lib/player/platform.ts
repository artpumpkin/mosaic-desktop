"use client";
import { useEffect, useState } from "react";
import { platform } from "@tauri-apps/plugin-os";

// The libmpv player (tauri-plugin-mpv-player) only has a native
// implementation on macOS — `attach` returns "not yet implemented for this
// platform" elsewhere. So we render the mpv surface on macOS-in-Tauri and
// fall back to the browser's native <video> on Windows/Linux (and in a plain
// browser, e.g. the dev preview, where there's no native plugin at all).
export function detectMpvSupported(): boolean {
  if (typeof window === "undefined") return false;
  const inTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  if (!inTauri) return false;
  try {
    return platform() === "macos";
  } catch {
    return /Macintosh|Mac OS X/.test(navigator.userAgent || "");
  }
}

// Resolves after mount (false during SSR + first paint) so the consuming tree
// renders a stable placeholder first, then commits to one player path. This
// avoids mounting MpvPlayer (which eagerly attaches) on the wrong platform and
// avoids a native↔mpv swap mid-session.
export function useMpvSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(detectMpvSupported());
  }, []);
  return supported;
}
