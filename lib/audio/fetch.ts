// Fetch shim for the Audio hub (podcast RSS feeds + iTunes search). Same
// rationale as lib/manga/fetch.ts: in the Tauri runtime we use the http
// plugin's fetch (bypasses CORS, gated by the capability allowlist); in a
// plain browser (`next dev`) we fall back to native fetch. Podcast feeds
// frequently lack CORS headers, so the Tauri path is what makes this work in
// the shipped app.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

function inTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

export function afetch(input: string, init?: RequestInit): Promise<Response> {
  const f = inTauri() ? tauriFetch : window.fetch.bind(window);
  return f(input, init as never);
}
