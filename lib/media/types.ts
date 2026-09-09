// Shared media-optimization contract. Hand-synced with the Rust side in
// `src-tauri/src/media.rs` (the repo convention — no codegen).

export type ToolName =
  | "ffmpeg"
  | "ffprobe"
  | "magick"
  | "gs"
  | "realesrgan-ncnn-vulkan"
  | "yt-dlp";

export type ProgressKind = "ffmpeg" | "realesrgan" | "indeterminate";

/** A single unit of work. The frontend fills `args` with `{input}` /
 *  `{output}` placeholders; Rust derives the real output path beside the
 *  original and substitutes them before spawning the bundled tool. */
export interface JobSpec {
  tool: ToolName;
  input: string;
  /** Stem suffix, e.g. "compressed" → `photo-compressed.jpg`. */
  outputSuffix: string;
  /** Override output extension (format conversion). Omit to keep the input's. */
  outputExt?: string | null;
  args: string[];
  progress: ProgressKind;
  /** For tools that emit many files (PDF→images). */
  multiOutput?: boolean;
}

export type MediaProgress =
  | { type: "progress"; fraction: number } // -1 = indeterminate
  | { type: "done"; outputPath: string; inBytes: number; outBytes: number }
  | { type: "failed"; message: string }
  | { type: "canceled" };

export interface ToolInfo {
  name: ToolName;
  available: boolean;
  version: string | null;
  /** Where it resolved from: a download we manage, the system PATH, or absent. */
  source: "managed" | "path" | "none";
  /** True when an in-app installer exists for this platform. */
  installable: boolean;
  /** Disk size of the managed install (binary + any models), if managed. */
  sizeBytes?: number | null;
  /** Package-manager command shown when not installable in-app. */
  hint?: string | null;
}

/** Install progress streamed over a Channel from `tools_install`. Mirrors the
 *  Rust `InstallProgress` enum in `src-tauri/src/tools.rs`. */
export type InstallProgress =
  | { type: "downloading"; received: number; total: number } // total 0 = unknown
  | { type: "extracting" }
  | { type: "done"; version: string | null }
  | { type: "failed"; message: string }
  | { type: "canceled" };

export type MediaKind = "image" | "video" | "pdf" | "audio";

export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

/** Operation option values, keyed by control key. Defined here (not in
 *  presets) so QueueItem can reference it without a circular import. */
export type OptValues = Record<string, string | number | boolean>;

export interface QueueItem {
  id: number;
  path: string;
  name: string;
  kind: MediaKind;
  /** Per-file operation + options (initialized from the kind default). */
  opId: string;
  opts: OptValues;
  /** True once the user edits this file individually; such files stop
   *  tracking changes to the kind default. */
  customized?: boolean;
  status: JobStatus;
  /** 0..1, or -1 for indeterminate. */
  fraction: number;
  /** undefined = not loaded yet, null = no preview available. */
  thumb?: string | null;
  /** Projected output size (heuristic or exact). */
  estBytes?: number;
  estApprox?: boolean;
  inBytes?: number;
  outBytes?: number;
  outputPath?: string;
  error?: string;
}
