// Fetch shim for manga connectors.
//
// In the Tauri runtime we use @tauri-apps/plugin-http's fetch, which bypasses
// CORS (and is gated by the capability allowlist). In a plain browser (e.g.
// `next dev` for UI work) that plugin's IPC isn't available, so we fall back
// to the native fetch. MangaDex's API sends `Access-Control-Allow-Origin: *`,
// so the built-in source works in the browser too — handy for development.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

function inTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    // Tauri v2 exposes this internal on the window.
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

export function mfetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const f = inTauri() ? tauriFetch : window.fetch.bind(window);
  return f(input, init as never);
}
