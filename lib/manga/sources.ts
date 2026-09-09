// Manga source definitions + state helpers. Mirrors lib/tv/sources.ts, with
// two built-in API sources (MangaDex, Comick) and support for user-added
// instances of the generic `suwayomi` kind. The state is persisted as JSON
// under "manga:sources" (see lib/settings.ts).

import type { MangaSource, MangaSourcesState } from "./types";

export const BUILTIN_MANGADEX_ID = "mangadex";
export const BUILTIN_COMICK_ID = "comick";

export const BUILTIN_MANGADEX: MangaSource = {
  id: BUILTIN_MANGADEX_ID,
  kind: "mangadex",
  name: "MangaDex (built-in)",
  url: "",
  enabled: true,
};

export const BUILTIN_COMICK: MangaSource = {
  id: BUILTIN_COMICK_ID,
  kind: "comick",
  name: "Comick (built-in)",
  url: "",
  enabled: true,
};

export const BUILTIN_SOURCES: MangaSource[] = [BUILTIN_MANGADEX, BUILTIN_COMICK];
export const BUILTIN_IDS = new Set(BUILTIN_SOURCES.map((s) => s.id));

export const DEFAULT_MANGA_SOURCES_STATE: MangaSourcesState = {
  custom: [],
  order: [BUILTIN_MANGADEX_ID, BUILTIN_COMICK_ID],
  activeId: BUILTIN_MANGADEX_ID,
  disabledBuiltins: [],
};

// Built-ins (with their enabled flag derived from disabledBuiltins) + custom,
// sorted by the saved priority order. Unknown ids keep insertion order last.
export function allSources(state: MangaSourcesState): MangaSource[] {
  const builtins = BUILTIN_SOURCES.map((b) => ({
    ...b,
    enabled: !state.disabledBuiltins.includes(b.id),
  }));
  const merged = [...builtins, ...state.custom];
  const rank = new Map(state.order.map((id, i) => [id, i]));
  return merged
    .slice()
    .sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}

export function enabledSources(state: MangaSourcesState): MangaSource[] {
  return allSources(state).filter((s) => s.enabled);
}

export function resolveActiveSource(state: MangaSourcesState): MangaSource {
  return (
    allSources(state).find((s) => s.id === state.activeId) ?? BUILTIN_MANGADEX
  );
}
