export type TvSourceKind = "iptv-org" | "m3u";

export type TvSource = {
  id: string;
  kind: TvSourceKind;
  name: string;
  url: string;
  epgUrl?: string | null;
};

export const BUILTIN_IPTV_ORG_ID = "iptv-org";

export const BUILTIN_IPTV_ORG: TvSource = {
  id: BUILTIN_IPTV_ORG_ID,
  kind: "iptv-org",
  name: "iptv-org (built-in)",
  url: "",
  epgUrl: null,
};

export type TvSourcesState = {
  custom: TvSource[];
  activeId: string;
};

export const DEFAULT_TV_SOURCES_STATE: TvSourcesState = {
  custom: [],
  activeId: BUILTIN_IPTV_ORG_ID,
};

export function resolveActiveSource(state: TvSourcesState): TvSource {
  if (state.activeId === BUILTIN_IPTV_ORG_ID) return BUILTIN_IPTV_ORG;
  return (
    state.custom.find((s) => s.id === state.activeId) ?? BUILTIN_IPTV_ORG
  );
}

export function allSources(state: TvSourcesState): TvSource[] {
  return [BUILTIN_IPTV_ORG, ...state.custom];
}
