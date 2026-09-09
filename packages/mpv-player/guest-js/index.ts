// Core entry — framework-agnostic. The mpv handle, types, event-count
// helper, and the injectable logger. No React, no "use client": these
// modules guard browser APIs and are safe to import anywhere.
//
// React UI (MpvPlayer, PlayerControls, …) lives under the `/react`
// sub-path export (see guest-js/react/index.ts).

export {
  mpv,
  getEventCounts,
  type MpvState,
  type MpvBounds,
  type MpvHandle,
} from "./mpv";

export {
  logger,
  setLogger,
  setPlayerDebug,
  isPlayerDebug,
  formatEntry,
  type LogEntry,
  type LogLevel,
  type PlayerLogger,
} from "./logger";
