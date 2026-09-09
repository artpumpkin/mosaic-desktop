"use client";

// React UI entry — components + hooks. Requires `react`, `lucide-react`,
// and `clsx` (peer deps). Imported as `tauri-plugin-mpv-api/react`.

export { MpvPlayer, type MpvPlayerRef } from "./MpvPlayer";
export { PlayerControls } from "./PlayerControls";
export { PlayerStatsOverlay } from "./PlayerStatsOverlay";
export { PlayerActionFeedback } from "./PlayerActionFeedback";
export { MpvDebugPanel } from "./MpvDebugPanel";
export { useFullscreen } from "./useFullscreen";
export { useMpvHotkeys, type MpvHotkeysOptions } from "./useMpvHotkeys";
export { useUiFps } from "../playerDebug";
