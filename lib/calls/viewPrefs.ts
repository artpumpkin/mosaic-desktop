"use client";

export type LayoutMode = "theater" | "spotlight" | "sideBySide";
export type CamSize = "sm" | "md" | "lg";
export type Corner = "tl" | "tr" | "bl" | "br";
export type ScreenFit = "contain" | "cover";

export const SPLIT_MIN = 0.15;
export const SPLIT_MAX = 0.5;

export type ViewPrefs = {
  layout: LayoutMode;
  camsVisible: boolean;
  camSize: CamSize;
  camCorner: Corner;
  camOffset: { dx: number; dy: number } | null;
  screenFit: ScreenFit;
  splitRatio: number;
};

export const DEFAULT_PREFS: ViewPrefs = {
  layout: "theater",
  camsVisible: true,
  camSize: "md",
  camCorner: "tr",
  camOffset: null,
  screenFit: "contain",
  splitRatio: 0.25,
};

const STORAGE_KEY = "mosaic.calls.viewPrefs";

export function loadPrefs(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ViewPrefs> & {
      layout?: string;
    };
    const layout: LayoutMode =
      parsed.layout === "theater" ||
      parsed.layout === "spotlight" ||
      parsed.layout === "sideBySide"
        ? parsed.layout
        : "theater";
    const splitRatio = Math.min(
      SPLIT_MAX,
      Math.max(SPLIT_MIN, parsed.splitRatio ?? DEFAULT_PREFS.splitRatio),
    );
    return { ...DEFAULT_PREFS, ...parsed, layout, splitRatio };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: ViewPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota/private-mode errors
  }
}

export const CAM_TILE_WIDTHS: Record<CamSize, number> = {
  sm: 96,
  md: 144,
  lg: 200,
};
