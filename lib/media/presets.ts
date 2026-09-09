// The operation catalog: per media kind, the operations the UI offers, the
// controls each exposes, and a builder turning the chosen options into a
// JobSpec (the {input}/{output}/{models} placeholders are resolved in Rust).

import type { JobSpec, MediaKind, OptValues, ToolName } from "./types";

export type { OptValues };

export type Control =
  | {
      kind: "select";
      key: string;
      label: string;
      options: { value: string; label: string }[];
      default: string;
    }
  | {
      kind: "range";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      default: number;
      suffix?: string;
    }
  | { kind: "toggle"; key: string; label: string; default: boolean };

export interface Operation {
  id: string;
  label: string;
  hint?: string;
  requires: ToolName[];
  controls: Control[];
  build: (input: string, o: OptValues) => JobSpec;
}

export interface KindDef {
  kind: MediaKind;
  label: string;
  /** Lowercase, no leading dot. */
  extensions: string[];
  operations: Operation[];
}

const FF = ["-progress", "pipe:1", "-nostats"];

// Container → (video codec, audio codec) for ffmpeg conversions.
const VIDEO_CODECS: Record<string, { v: string; a: string }> = {
  mp4: { v: "libx264", a: "aac" },
  mkv: { v: "libx264", a: "aac" },
  mov: { v: "libx264", a: "aac" },
  webm: { v: "libvpx-vp9", a: "libopus" },
};

export const MEDIA_KINDS: KindDef[] = [
  {
    kind: "image",
    label: "Images",
    extensions: ["jpg", "jpeg", "png", "webp", "avif", "heic", "heif", "tif", "tiff", "gif", "bmp"],
    operations: [
      {
        id: "compress",
        label: "Compress",
        hint: "Re-encode at a lower quality to shrink file size.",
        requires: ["magick"],
        controls: [
          { kind: "range", key: "quality", label: "Quality", min: 30, max: 100, step: 1, default: 80, suffix: "%" },
        ],
        build: (input, o) => {
          // Format-aware: JPEG/WebP honor -quality; PNG's "quality" is just
          // zlib level, so push it to max + best filter instead.
          const ext = (input.split(".").pop() ?? "").toLowerCase();
          const args: string[] = ["{input}", "-strip"];
          if (ext === "png") {
            args.push("-define", "png:compression-level=9", "-define", "png:compression-filter=5");
          } else {
            args.push("-quality", String(o.quality));
            if (ext === "jpg" || ext === "jpeg")
              args.push("-sampling-factor", "4:2:0", "-interlace", "JPEG");
          }
          args.push("{output}");
          return { tool: "magick", input, outputSuffix: "compressed", progress: "indeterminate", args };
        },
      },
      {
        id: "convert",
        label: "Convert",
        hint: "Change the file format.",
        requires: ["magick"],
        controls: [
          {
            kind: "select",
            key: "format",
            label: "To format",
            default: "webp",
            options: [
              { value: "webp", label: "WebP" },
              { value: "jpg", label: "JPEG" },
              { value: "png", label: "PNG" },
              { value: "avif", label: "AVIF" },
              { value: "tiff", label: "TIFF" },
              { value: "pdf", label: "PDF (one page)" },
            ],
          },
          { kind: "range", key: "quality", label: "Quality", min: 30, max: 100, step: 1, default: 90, suffix: "%" },
        ],
        build: (input, o) => ({
          tool: "magick",
          input,
          outputSuffix: "",
          outputExt: String(o.format),
          progress: "indeterminate",
          args: ["{input}", "-quality", String(o.quality), "{output}"],
        }),
      },
      {
        id: "resize",
        label: "Resize",
        hint: "Scale down by percentage or to a maximum dimension.",
        requires: ["magick"],
        controls: [
          {
            kind: "select",
            key: "geometry",
            label: "Resize to",
            default: "1920x1920>",
            options: [
              { value: "75%", label: "75%" },
              { value: "50%", label: "50%" },
              { value: "25%", label: "25%" },
              { value: "3840x3840>", label: "Max 3840px" },
              { value: "1920x1920>", label: "Max 1920px" },
              { value: "1280x1280>", label: "Max 1280px" },
              { value: "800x800>", label: "Max 800px" },
            ],
          },
        ],
        build: (input, o) => ({
          tool: "magick",
          input,
          outputSuffix: "resized",
          progress: "indeterminate",
          args: ["{input}", "-resize", String(o.geometry), "{output}"],
        }),
      },
      {
        id: "enhance",
        label: "Enhance",
        hint: "Classic auto-correction: levels, denoise, sharpen, color.",
        requires: ["magick"],
        controls: [
          { kind: "toggle", key: "autoLevel", label: "Auto contrast", default: true },
          { kind: "toggle", key: "sharpen", label: "Sharpen", default: true },
          { kind: "toggle", key: "denoise", label: "Denoise", default: false },
          { kind: "range", key: "saturation", label: "Saturation", min: 80, max: 150, step: 1, default: 112, suffix: "%" },
        ],
        build: (input, o) => {
          const args: string[] = ["{input}"];
          if (o.autoLevel) args.push("-auto-level", "-sigmoidal-contrast", "3x50%");
          if (o.denoise) args.push("-enhance");
          if (o.sharpen) args.push("-unsharp", "0x1.2+1.0+0.02");
          if (Number(o.saturation) !== 100) args.push("-modulate", `100,${o.saturation}`);
          args.push("{output}");
          return { tool: "magick", input, outputSuffix: "enhanced", progress: "indeterminate", args };
        },
      },
      {
        id: "upscale",
        label: "Upscale (AI)",
        hint: "Real-ESRGAN super-resolution. Slower, needs a GPU.",
        requires: ["realesrgan-ncnn-vulkan"],
        controls: [
          {
            kind: "select",
            key: "scale",
            label: "Scale",
            default: "4",
            options: [
              { value: "2", label: "2×" },
              { value: "4", label: "4×" },
            ],
          },
          {
            kind: "select",
            key: "model",
            label: "Model",
            default: "realesrgan-x4plus",
            options: [
              { value: "realesrgan-x4plus", label: "General (photo)" },
              { value: "realesrgan-x4plus-anime", label: "Anime / art" },
              { value: "realesr-animevideov3", label: "Anime video" },
            ],
          },
        ],
        build: (input, o) => ({
          tool: "realesrgan-ncnn-vulkan",
          input,
          outputSuffix: "upscaled",
          outputExt: "png",
          progress: "realesrgan",
          args: ["-i", "{input}", "-o", "{output}", "-s", String(o.scale), "-n", String(o.model), "-m", "{models}"],
        }),
      },
    ],
  },

  {
    kind: "video",
    label: "Video",
    extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "flv", "wmv", "mpg", "mpeg"],
    operations: [
      {
        id: "compress",
        label: "Compress",
        hint: "Re-encode at a target quality (CRF) to shrink file size.",
        requires: ["ffmpeg"],
        controls: [
          {
            kind: "select",
            key: "crf",
            label: "Quality",
            default: "23",
            options: [
              { value: "20", label: "High (larger)" },
              { value: "23", label: "Balanced" },
              { value: "28", label: "Small" },
              { value: "32", label: "Tiny" },
            ],
          },
          {
            kind: "select",
            key: "codec",
            label: "Codec",
            default: "libx264",
            options: [
              { value: "libx264", label: "H.264" },
              { value: "libx265", label: "H.265 (smaller)" },
            ],
          },
          {
            kind: "select",
            key: "preset",
            label: "Speed",
            default: "medium",
            options: [
              { value: "fast", label: "Fast" },
              { value: "medium", label: "Medium" },
              { value: "slow", label: "Slow (best)" },
            ],
          },
        ],
        build: (input, o) => {
          const args = ["-y", "-i", "{input}", "-c:v", String(o.codec), "-crf", String(o.crf), "-preset", String(o.preset)];
          if (o.codec === "libx265") args.push("-tag:v", "hvc1");
          args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", ...FF, "{output}");
          return { tool: "ffmpeg", input, outputSuffix: "compressed", outputExt: "mp4", progress: "ffmpeg", args };
        },
      },
      {
        id: "convert",
        label: "Convert",
        hint: "Change the container/format.",
        requires: ["ffmpeg"],
        controls: [
          {
            kind: "select",
            key: "format",
            label: "To format",
            default: "mp4",
            options: [
              { value: "mp4", label: "MP4" },
              { value: "mkv", label: "MKV" },
              { value: "mov", label: "MOV" },
              { value: "webm", label: "WebM" },
            ],
          },
        ],
        build: (input, o) => {
          const fmt = String(o.format);
          const c = VIDEO_CODECS[fmt] ?? VIDEO_CODECS.mp4;
          const args = ["-y", "-i", "{input}", "-c:v", c.v, "-crf", "23", "-c:a", c.a, ...FF, "{output}"];
          return { tool: "ffmpeg", input, outputSuffix: "", outputExt: fmt, progress: "ffmpeg", args };
        },
      },
      {
        id: "resize",
        label: "Resize",
        hint: "Downscale to a standard resolution.",
        requires: ["ffmpeg"],
        controls: [
          {
            kind: "select",
            key: "height",
            label: "Resolution",
            default: "1080",
            options: [
              { value: "2160", label: "2160p (4K)" },
              { value: "1080", label: "1080p" },
              { value: "720", label: "720p" },
              { value: "480", label: "480p" },
            ],
          },
        ],
        build: (input, o) => ({
          tool: "ffmpeg",
          input,
          outputSuffix: `${o.height}p`,
          outputExt: "mp4",
          progress: "ffmpeg",
          args: ["-y", "-i", "{input}", "-vf", `scale=-2:${o.height}`, "-c:v", "libx264", "-crf", "23", "-preset", "medium", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", ...FF, "{output}"],
        }),
      },
      {
        id: "extract-audio",
        label: "Extract audio",
        hint: "Save the audio track only.",
        requires: ["ffmpeg"],
        controls: [
          {
            kind: "select",
            key: "format",
            label: "Audio format",
            default: "mp3",
            options: [
              { value: "mp3", label: "MP3" },
              { value: "m4a", label: "M4A (AAC)" },
            ],
          },
        ],
        build: (input, o) => {
          const fmt = String(o.format);
          const codec = fmt === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "aac", "-b:a", "192k"];
          return {
            tool: "ffmpeg",
            input,
            outputSuffix: "audio",
            outputExt: fmt,
            progress: "ffmpeg",
            args: ["-y", "-i", "{input}", "-vn", ...codec, ...FF, "{output}"],
          };
        },
      },
    ],
  },

  {
    kind: "audio",
    label: "Audio",
    extensions: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma", "aiff"],
    operations: [
      {
        id: "convert",
        label: "Convert / compress",
        hint: "Re-encode to another format or bitrate.",
        requires: ["ffmpeg"],
        controls: [
          {
            kind: "select",
            key: "format",
            label: "To format",
            default: "mp3",
            options: [
              { value: "mp3", label: "MP3" },
              { value: "m4a", label: "M4A (AAC)" },
              { value: "opus", label: "Opus" },
              { value: "flac", label: "FLAC (lossless)" },
              { value: "wav", label: "WAV (lossless)" },
            ],
          },
          {
            kind: "select",
            key: "bitrate",
            label: "Bitrate",
            default: "192k",
            options: [
              { value: "128k", label: "128 kbps" },
              { value: "192k", label: "192 kbps" },
              { value: "256k", label: "256 kbps" },
              { value: "320k", label: "320 kbps" },
            ],
          },
        ],
        build: (input, o) => {
          const fmt = String(o.format);
          const br = String(o.bitrate);
          let codec: string[];
          if (fmt === "mp3") codec = ["-c:a", "libmp3lame", "-b:a", br];
          else if (fmt === "m4a") codec = ["-c:a", "aac", "-b:a", br];
          else if (fmt === "opus") codec = ["-c:a", "libopus", "-b:a", br];
          else if (fmt === "flac") codec = ["-c:a", "flac"];
          else codec = ["-c:a", "pcm_s16le"]; // wav
          return {
            tool: "ffmpeg",
            input,
            outputSuffix: "",
            outputExt: fmt,
            progress: "ffmpeg",
            args: ["-y", "-i", "{input}", "-vn", ...codec, ...FF, "{output}"],
          };
        },
      },
    ],
  },

  {
    kind: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    operations: [
      {
        id: "compress",
        label: "Compress",
        hint: "Down-sample images and re-encode to shrink the PDF.",
        requires: ["gs"],
        controls: [
          {
            kind: "select",
            key: "preset",
            label: "Target",
            default: "ebook",
            options: [
              { value: "screen", label: "Screen (smallest)" },
              { value: "ebook", label: "eBook" },
              { value: "printer", label: "Printer" },
              { value: "prepress", label: "Prepress (best)" },
            ],
          },
        ],
        build: (input, o) => ({
          tool: "gs",
          input,
          outputSuffix: "compressed",
          outputExt: "pdf",
          progress: "indeterminate",
          args: [
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            `-dPDFSETTINGS=/${o.preset}`,
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-sOutputFile={output}",
            "{input}",
          ],
        }),
      },
      {
        id: "to-images",
        label: "PDF → images",
        hint: "Render each page to an image file.",
        requires: ["magick"],
        controls: [
          {
            kind: "select",
            key: "format",
            label: "Image format",
            default: "png",
            options: [
              { value: "png", label: "PNG" },
              { value: "jpg", label: "JPEG" },
            ],
          },
          {
            kind: "select",
            key: "dpi",
            label: "Resolution",
            default: "150",
            options: [
              { value: "100", label: "100 DPI" },
              { value: "150", label: "150 DPI" },
              { value: "300", label: "300 DPI" },
            ],
          },
        ],
        build: (input, o) => ({
          tool: "magick",
          input,
          outputSuffix: "page",
          outputExt: String(o.format),
          progress: "indeterminate",
          multiOutput: true,
          args: ["-density", String(o.dpi), "{input}", "{output}"],
        }),
      },
    ],
  },
];

export function kindForExtension(ext: string): MediaKind | null {
  const e = ext.toLowerCase().replace(/^\./, "");
  for (const k of MEDIA_KINDS) if (k.extensions.includes(e)) return k.kind;
  return null;
}

export function defaultOptions(op: Operation): OptValues {
  const o: OptValues = {};
  for (const c of op.controls) o[c.key] = c.default;
  return o;
}

export function findOperation(kind: MediaKind, opId: string): Operation {
  const def = MEDIA_KINDS.find((k) => k.kind === kind)!;
  return def.operations.find((o) => o.id === opId) ?? def.operations[0];
}

// Ops whose output size can't be meaningfully predicted ahead of time.
const NON_ESTIMABLE = new Set(["upscale", "to-images"]);

export function isEstimable(op: Operation): boolean {
  return !NON_ESTIMABLE.has(op.id);
}

/** Seconds of trial to encode for an exact video estimate (undefined = run
 *  the op in full, which is fine for fast image/pdf/audio ops). */
export function sampleSecondsFor(kind: MediaKind): number | undefined {
  return kind === "video" ? 6 : undefined;
}

// Coarse multipliers for the instant (pre-trial) estimate. Always shown with
// a "~" and replaced by the exact figure when the user asks for it.
function heuristicRatio(kind: MediaKind, opId: string, o: OptValues): number | null {
  if (kind === "image") {
    if (opId === "compress") return Math.max(0.15, Number(o.quality) / 100 - 0.15);
    if (opId === "resize") {
      const g = String(o.geometry);
      if (g.endsWith("%")) {
        const p = parseFloat(g) / 100;
        return Math.min(1, p * p);
      }
      return 0.55; // max-dimension shrink, source size unknown
    }
    if (opId === "convert") return 0.7;
    if (opId === "enhance") return 1.0;
  }
  if (kind === "video") {
    if (opId === "compress") {
      const crf = Number(o.crf);
      const table: Record<number, number> = { 20: 0.75, 23: 0.5, 28: 0.3, 32: 0.18 };
      return table[crf] ?? 0.5;
    }
    if (opId === "resize") {
      const h = Number(o.height);
      const table: Record<number, number> = { 2160: 1.0, 1080: 0.5, 720: 0.3, 480: 0.15 };
      return table[h] ?? 0.5;
    }
    if (opId === "convert") return 0.85;
    if (opId === "extract-audio") return 0.12;
  }
  if (kind === "audio") return 0.6;
  if (kind === "pdf") {
    const table: Record<string, number> = { screen: 0.3, ebook: 0.5, printer: 0.7, prepress: 0.9 };
    return table[String(o.preset)] ?? 0.5;
  }
  return null;
}

export function heuristicBytes(
  kind: MediaKind,
  opId: string,
  o: OptValues,
  originalBytes: number,
): number | null {
  if (!originalBytes) return null;
  const r = heuristicRatio(kind, opId, o);
  return r == null ? null : Math.round(originalBytes * r);
}
