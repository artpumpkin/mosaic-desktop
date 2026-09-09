// Thin wrappers over the Rust media commands. Progress streams back over a
// Tauri `Channel` (same pattern as lib/calls/macSystemAudio.ts).

import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  InstallProgress,
  JobSpec,
  MediaProgress,
  ToolInfo,
  ToolName,
} from "./types";

/** Run one job. Resolves when the job finishes (done / failed / canceled);
 *  `onProgress` receives every progress event including the terminal one. */
export function runJob(
  jobId: number,
  spec: JobSpec,
  onProgress: (p: MediaProgress) => void,
): Promise<void> {
  const onEvent = new Channel<MediaProgress>();
  onEvent.onmessage = onProgress;
  // camelCase keys map to the Rust snake_case params (job_id, spec, on_event).
  return invoke<void>("media_run_job", { jobId, spec, onEvent });
}

export function cancelJob(jobId: number): Promise<void> {
  return invoke<void>("media_cancel", { jobId });
}

/** Per-tool availability + install status (managed install → system PATH). */
export function toolsStatus(): Promise<ToolInfo[]> {
  return invoke<ToolInfo[]>("tools_status");
}

/** Download + install a tool on demand. Resolves when the install finishes
 *  (done / failed / canceled); `onProgress` receives every event. */
export function installTool(
  tool: ToolName,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const onEvent = new Channel<InstallProgress>();
  onEvent.onmessage = onProgress;
  return invoke<void>("tools_install", { tool, onEvent });
}

export function cancelInstall(tool: ToolName): Promise<void> {
  return invoke<void>("tools_cancel_install", { tool });
}

export function uninstallTool(tool: ToolName): Promise<void> {
  return invoke<void>("tools_uninstall", { tool });
}

export function revealInFolder(path: string): Promise<void> {
  return invoke<void>("media_reveal", { path });
}

export function fileSize(path: string): Promise<number> {
  return invoke<number>("media_file_size", { path });
}

/** Small preview as a data URL (null if unsupported). */
export function thumbnail(path: string, maxSize?: number): Promise<string | null> {
  return invoke<string | null>("media_thumbnail", { path, maxSize: maxSize ?? null });
}

export interface EstimateResult {
  bytes: number;
  approximate: boolean;
}

/** Exact projected output size via a trial encode. For video, pass
 *  `sampleSeconds` to cap the trial and extrapolate. */
export function estimate(spec: JobSpec, sampleSeconds?: number): Promise<EstimateResult> {
  return invoke<EstimateResult>("media_estimate", {
    spec,
    sampleSeconds: sampleSeconds ?? null,
  });
}

export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
