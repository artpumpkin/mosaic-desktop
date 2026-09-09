// Typed front-end bindings for the native cleanup commands (src-tauri/src/cleanup.rs).
// Tauri maps camelCase JS args → snake_case Rust params automatically, but the
// returned structs keep their snake_case field names, so the mirror types below
// match the Rust serde shapes verbatim.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---- Mirror types -----------------------------------------------------------

export type CacheItem = {
  id: string;
  label: string;
  description: string;
  path: string;
  size_bytes: number;
  file_count: number;
  removable: boolean;
};
export type CacheScan = { items: CacheItem[]; total_bytes: number };

export type JunkBucket = {
  id: string;
  label: string;
  description: string;
  caveat: string | null;
  paths: string[];
  size_bytes: number;
  file_count: number;
  action: "trash" | "empty_trash";
};
export type JunkScan = { buckets: JunkBucket[]; total_bytes: number };

export type LargeFile = {
  path: string;
  size_bytes: number;
  modified_ms: number;
};

export type DuplicateGroup = {
  hash: string;
  size_bytes: number;
  paths: string[];
  reclaimable_bytes: number;
};

export type ScanProgress = {
  scan_id: string;
  phase: "walking" | "hashing" | "done";
  files_seen: number;
  bytes_seen: number;
  current_dir: string;
};

export type TrashFailure = { path: string; reason: string };
export type TrashResult = {
  trashed: string[];
  failed: TrashFailure[];
  freed_bytes: number;
};

// ---- Command wrappers -------------------------------------------------------

export const scanAppCache = () => invoke<CacheScan>("cleanup_scan_app_cache");

export const clearAppCache = (ids: string[]) =>
  invoke<TrashResult>("cleanup_clear_app_cache", { ids });

export const scanSystemJunk = () =>
  invoke<JunkScan>("cleanup_scan_system_junk");

export const cleanSystemJunk = (bucketIds: string[]) =>
  invoke<TrashResult>("cleanup_clean_system_junk", { bucketIds });

export const scanLargeFiles = (
  scanId: string,
  minSizeBytes: number,
  limit = 100,
  root?: string,
) =>
  invoke<LargeFile[]>("cleanup_scan_large_files", {
    root: root ?? null,
    minSizeBytes,
    limit,
    scanId,
  });

export const scanDuplicates = (
  scanId: string,
  minSizeBytes: number,
  root?: string,
) =>
  invoke<DuplicateGroup[]>("cleanup_scan_duplicates", {
    root: root ?? null,
    minSizeBytes,
    scanId,
  });

export const trashPaths = (paths: string[]) =>
  invoke<TrashResult>("cleanup_trash_paths", { paths });

/** Opens the macOS Full Disk Access settings pane (grant once to stop prompts). */
export const openFullDiskAccess = () =>
  invoke<void>("cleanup_open_full_disk_access");

/** Signal a running large-file / duplicate scan to stop (returns partial results). */
export const cancelScan = (scanId: string) =>
  invoke<void>("cleanup_cancel_scan", { scanId });

/** Reveal a file in Finder (selects it in its folder). */
export const revealInFinder = (path: string) =>
  invoke<void>("cleanup_reveal", { path });

// ---- Progress events --------------------------------------------------------

export function newScanId(): string {
  return crypto.randomUUID();
}

/**
 * Subscribe to `cleanup://progress`, invoking `cb` only for the given
 * `scanId` (stale events from a previous scan are ignored). Returns an
 * unlisten function to call on unmount / completion.
 */
export function onScanProgress(
  scanId: string,
  cb: (p: ScanProgress) => void,
): Promise<() => void> {
  return listen<ScanProgress>("cleanup://progress", (e) => {
    if (e.payload.scan_id === scanId) cb(e.payload);
  });
}
