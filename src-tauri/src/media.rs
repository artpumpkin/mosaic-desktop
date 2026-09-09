// Media optimization engine.
//
// Runs bundled CLI tools (ffmpeg/ffprobe, ImageMagick `magick`, Ghostscript
// `gs`, Real-ESRGAN) to convert / compress / resize / enhance local media.
// The frontend builds the exact argument vector for an operation (see
// `lib/media/presets.ts`) using `{input}` / `{output}` placeholders; this
// module owns everything that must stay on the Rust side: resolving the
// bundled binary, deriving a collision-safe output path *beside the
// original*, spawning the process, parsing progress, and cancellation.
//
// Why the frontend builds argv: adding a new operation then becomes a pure
// TS change. Spawning from Rust (not the JS shell API) means none of this is
// gated by the shell capability scope — Tauri's ACL only guards the JS→Rust
// `invoke` boundary, which our own `media_*` commands pass through normally.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Tool resolution and on-demand installation live in `tools.rs`. The media
// engine just resolves a path (managed install → system PATH → dev tree) and
// spawns it; a missing tool reports unavailable and its operations disable in
// the UI rather than breaking the whole app.
use crate::tools::{resolve_tool, TOOLS};

/// Shared state: live job children keyed by the frontend-assigned job id, so
/// `media_cancel` can kill a running process. Nothing else is persisted —
/// the JS side owns the queue; Rust runs one unit of work per invocation.
#[derive(Default)]
pub struct MediaEngine {
    jobs: Mutex<HashMap<u64, CommandChild>>,
}

/// Progress events streamed back over the per-job `Channel`. Mirrored in
/// `lib/media/types.ts` (the repo convention — no codegen).
#[derive(serde::Serialize, Clone)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum MediaProgress {
    /// fraction in 0..=1, or -1.0 for indeterminate (magick / gs).
    Progress {
        fraction: f64,
    },
    Done {
        output_path: String,
        in_bytes: u64,
        out_bytes: u64,
    },
    Failed {
        message: String,
    },
    Canceled,
}

/// How to interpret the tool's output stream for progress.
#[derive(serde::Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProgressKind {
    /// ffmpeg `-progress pipe:1` → parse `out_time_us`/`out_time_ms` vs a
    /// duration probed up front with ffprobe.
    Ffmpeg,
    /// realesrgan prints `xx.xx%` lines to stderr.
    Realesrgan,
    /// magick / gs: no granular progress; emit indeterminate then done.
    Indeterminate,
}

/// One job. The frontend fills `args` with `{input}` / `{output}` tokens.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSpec {
    /// Sidecar name: one of TOOLS.
    tool: String,
    /// Absolute path to the source file.
    input: String,
    /// Suffix appended to the stem, e.g. "compressed" → `photo-compressed.jpg`.
    output_suffix: String,
    /// Override the output extension (for format conversion). None = keep input's.
    #[serde(default)]
    output_ext: Option<String>,
    /// Argument vector with `{input}` / `{output}` placeholders.
    args: Vec<String>,
    progress: ProgressKind,
    /// True for tools that emit multiple files (PDF→images): `{output}` is
    /// turned into a `…-%03d.ext` pattern and collision/size checks are skipped.
    #[serde(default)]
    multi_output: bool,
}

/// Derive an output path *beside the original*: `dir/{stem}-{suffix}.{ext}`,
/// appending `-1`, `-2`… until it doesn't collide with an existing file.
fn derive_output(input: &Path, suffix: &str, new_ext: Option<&str>) -> PathBuf {
    let dir = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = new_ext
        .map(|e| e.trim_start_matches('.').to_string())
        .or_else(|| input.extension().and_then(|e| e.to_str()).map(String::from))
        .unwrap_or_default();

    let with_ext = |name: String| -> PathBuf {
        if ext.is_empty() {
            dir.join(name)
        } else {
            dir.join(format!("{name}.{ext}"))
        }
    };

    // An empty suffix is used for format conversions (`photo.png` → `photo.webp`),
    // where the new extension alone distinguishes the output.
    let base = if suffix.is_empty() {
        stem.to_string()
    } else {
        format!("{stem}-{suffix}")
    };
    let mut candidate = with_ext(base.clone());
    let mut n = 1;
    while candidate.exists() {
        candidate = with_ext(format!("{base}-{n}"));
        n += 1;
    }
    candidate
}

/// Turn a derived single-file output into a multi-file pattern for magick,
/// e.g. `…/doc-pages.png` → `…/doc-pages-%03d.png`.
fn to_pattern(output: &Path) -> String {
    let dir = output.parent().unwrap_or_else(|| Path::new("."));
    let stem = output
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("page");
    let ext = output.extension().and_then(|e| e.to_str()).unwrap_or("png");
    dir.join(format!("{stem}-%03d.{ext}"))
        .to_string_lossy()
        .into_owned()
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/// ffmpeg `-progress` emits key=value lines. `out_time_us` is microseconds;
/// the older `out_time_ms` field is *also* microseconds (a long-standing
/// ffmpeg quirk), so both divide by 1e6.
fn ffmpeg_fraction(line: &str, duration: f64) -> Option<f64> {
    if duration <= 0.0 {
        return None;
    }
    let line = line.trim();
    for prefix in ["out_time_us=", "out_time_ms="] {
        if let Some(v) = line.strip_prefix(prefix) {
            if let Ok(us) = v.trim().parse::<f64>() {
                return Some((us / 1_000_000.0 / duration).clamp(0.0, 1.0));
            }
        }
    }
    None
}

/// realesrgan prints lines like `  12.50%` to stderr.
fn realesrgan_fraction(line: &str) -> Option<f64> {
    let t = line.trim().trim_end_matches('%').trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

/// Probe media duration (seconds) with the bundled ffprobe. Returns 0.0 on
/// any failure — the caller then falls back to indeterminate progress.
async fn probe_duration(app: &AppHandle, input: &str) -> f64 {
    let path = match resolve_tool(app, "ffprobe") {
        Some(p) => p,
        None => return 0.0,
    };
    let cmd = app.shell().command(path).args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input,
    ]);
    match cmd.output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0),
        Err(_) => 0.0,
    }
}

#[tauri::command]
pub async fn media_run_job(
    app: AppHandle,
    engine: State<'_, MediaEngine>,
    on_event: Channel<MediaProgress>,
    job_id: u64,
    spec: JobSpec,
) -> Result<(), String> {
    crate::security::check_file_scope(&app, &spec.input)?;
    crate::media_guard::validate(
        &spec.tool,
        &spec.args,
        &spec.output_suffix,
        spec.output_ext.as_deref(),
    )?;
    if !TOOLS.contains(&spec.tool.as_str()) {
        let msg = format!("unknown tool: {}", spec.tool);
        let _ = on_event.send(MediaProgress::Failed {
            message: msg.clone(),
        });
        return Err(msg);
    }

    let input_path = PathBuf::from(&spec.input);
    let in_bytes = file_size(&input_path);
    let output_path = derive_output(&input_path, &spec.output_suffix, spec.output_ext.as_deref());
    let output_str = if spec.multi_output {
        to_pattern(&output_path)
    } else {
        output_path.to_string_lossy().into_owned()
    };

    // Real-ESRGAN needs its model directory; `{models}` resolves to the
    // managed install (or legacy bundled resources) — see `tools::models_dir`.
    let models_dir = crate::tools::models_dir(&app);

    // Substitute placeholders.
    let argv: Vec<String> = spec
        .args
        .iter()
        .map(|a| {
            a.replace("{input}", &spec.input)
                .replace("{output}", &output_str)
                .replace("{models}", &models_dir)
        })
        .collect();

    // For ffmpeg jobs, probe duration so we can report a real fraction.
    let duration = if spec.progress == ProgressKind::Ffmpeg {
        probe_duration(&app, &spec.input).await
    } else {
        0.0
    };

    let tool_path = resolve_tool(&app, &spec.tool).ok_or_else(|| {
        let msg = format!("{} is not installed", spec.tool);
        let _ = on_event.send(MediaProgress::Failed {
            message: msg.clone(),
        });
        msg
    })?;
    let cmd = app.shell().command(tool_path).args(argv);

    let (mut rx, child) = cmd.spawn().map_err(|e| {
        let msg = format!("failed to start {}: {e}", spec.tool);
        let _ = on_event.send(MediaProgress::Failed {
            message: msg.clone(),
        });
        msg
    })?;

    engine.jobs.lock().unwrap().insert(job_id, child);

    if spec.progress == ProgressKind::Indeterminate {
        let _ = on_event.send(MediaProgress::Progress { fraction: -1.0 });
    }

    let mut stderr_tail: Vec<String> = Vec::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                if spec.progress == ProgressKind::Ffmpeg {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(f) = ffmpeg_fraction(&line, duration) {
                        let _ = on_event.send(MediaProgress::Progress { fraction: f });
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                if spec.progress == ProgressKind::Realesrgan {
                    if let Some(f) = realesrgan_fraction(&line) {
                        let _ = on_event.send(MediaProgress::Progress { fraction: f });
                    }
                }
                // Keep the last few stderr lines for error reporting.
                stderr_tail.push(line.trim().to_string());
                if stderr_tail.len() > 8 {
                    stderr_tail.remove(0);
                }
            }
            CommandEvent::Error(e) => {
                stderr_tail.push(e);
                if stderr_tail.len() > 8 {
                    stderr_tail.remove(0);
                }
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    // Drop the (now-dead) child handle. If `media_cancel` already removed it,
    // this is a no-op.
    let was_present = engine.jobs.lock().unwrap().remove(&job_id).is_some();

    if exit_code == Some(0) {
        let out_bytes = if spec.multi_output {
            0
        } else {
            file_size(&output_path)
        };
        let _ = on_event.send(MediaProgress::Done {
            output_path: output_str,
            in_bytes,
            out_bytes,
        });
        Ok(())
    } else if !was_present {
        // The child was killed via media_cancel (removed from the map there).
        let _ = on_event.send(MediaProgress::Canceled);
        // Best-effort cleanup of a partial output.
        if !spec.multi_output {
            let _ = std::fs::remove_file(&output_path);
        }
        Ok(())
    } else {
        let tail = stderr_tail.join("\n");
        let msg = if tail.trim().is_empty() {
            format!("{} exited with code {:?}", spec.tool, exit_code)
        } else {
            tail
        };
        if !spec.multi_output {
            let _ = std::fs::remove_file(&output_path);
        }
        let _ = on_event.send(MediaProgress::Failed {
            message: msg.clone(),
        });
        Err(msg)
    }
}

#[tauri::command]
pub fn media_cancel(engine: State<'_, MediaEngine>, job_id: u64) -> Result<(), String> {
    // Remove first (so media_run_job's post-loop sees it gone and reports
    // Canceled), then kill — `kill` consumes the child.
    let child = engine.jobs.lock().unwrap().remove(&job_id);
    if let Some(child) = child {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// File size in bytes (picked paths are outside the fs-plugin scope, so we
/// stat from Rust directly).
#[tauri::command]
pub fn media_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Reveal a file in the OS file manager (Finder / Explorer), selecting it.
#[tauri::command]
pub fn media_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(format!("/select,{path}"));
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        // No reliable cross-DE "select" — open the containing directory.
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| ".".to_string());
        let mut c = std::process::Command::new("xdg-open");
        c.arg(parent);
        c
    };
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Coarse media kind from a file extension (for picking the thumbnail tool).
fn kind_of(path: &str) -> &'static str {
    let e = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match e.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "avif" | "heic" | "heif" | "tif" | "tiff" | "gif"
        | "bmp" => "image",
        "mp4" | "mov" | "mkv" | "webm" | "avi" | "m4v" | "flv" | "wmv" | "mpg" | "mpeg" => "video",
        "pdf" => "pdf",
        _ => "other",
    }
}

/// Generate a small preview for a file and return it as a base64 data URL.
/// Uses magick (images/pdf) or ffmpeg (a video frame), so it also previews
/// formats the webview can't render natively (HEIC, AVIF, TIFF…). Returns
/// None for audio / unsupported / on any tool failure.
///
/// The thumbnail is written to a temp file and read back with `std::fs`
/// rather than captured from the tool's stdout — the shell plugin reads
/// stdout line-by-line (splitting on 0x0A/0x0D), which silently corrupts
/// binary image data.
#[tauri::command]
pub async fn media_thumbnail(
    app: AppHandle,
    path: String,
    max_size: Option<u32>,
) -> Result<Option<String>, String> {
    let max = max_size.unwrap_or(480);
    let geom = format!("{max}x{max}");
    let (ext, mime) = match kind_of(&path) {
        "image" | "pdf" => ("webp", "image/webp"),
        "video" => ("jpg", "image/jpeg"),
        _ => return Ok(None),
    };
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("mosaic-thumb-{nanos}.{ext}"));
    let tmp_str = tmp.to_string_lossy().into_owned();

    let (tool, args): (&str, Vec<String>) = match kind_of(&path) {
        "image" => (
            "magick",
            vec![
                format!("{path}[0]"),
                "-auto-orient".into(),
                "-thumbnail".into(),
                geom,
                "-quality".into(),
                "72".into(),
                tmp_str.clone(),
            ],
        ),
        "pdf" => (
            "magick",
            vec![
                "-density".into(),
                "100".into(),
                format!("{path}[0]"),
                "-thumbnail".into(),
                geom,
                "-quality".into(),
                "72".into(),
                tmp_str.clone(),
            ],
        ),
        "video" => (
            "ffmpeg",
            vec![
                "-v".into(),
                "error".into(),
                "-y".into(),
                "-i".into(),
                path.clone(),
                "-frames:v".into(),
                "1".into(),
                "-vf".into(),
                format!("scale={max}:-2"),
                tmp_str.clone(),
            ],
        ),
        _ => return Ok(None),
    };

    let tool_path = match resolve_tool(&app, tool) {
        Some(p) => p,
        None => return Ok(None),
    };
    let ran = app.shell().command(tool_path).args(args).output().await;
    let ok = matches!(ran, Ok(o) if o.status.success());
    if !ok {
        let _ = std::fs::remove_file(&tmp);
        return Ok(None);
    }
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    if bytes.is_empty() {
        return Ok(None);
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{mime};base64,{b64}")))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateResult {
    bytes: u64,
    approximate: bool,
}

/// Predict the output size by trial-encoding to a temp file. For video,
/// `sample_seconds` caps the trial to a short slice and extrapolates by the
/// full duration (approximate); other kinds run in full (exact, and fast).
#[tauri::command]
pub async fn media_estimate(
    app: AppHandle,
    spec: JobSpec,
    sample_seconds: Option<f64>,
) -> Result<EstimateResult, String> {
    crate::security::check_file_scope(&app, &spec.input)?;
    crate::media_guard::validate(
        &spec.tool,
        &spec.args,
        &spec.output_suffix,
        spec.output_ext.as_deref(),
    )?;
    let tool_path =
        resolve_tool(&app, &spec.tool).ok_or_else(|| format!("{} is not installed", spec.tool))?;

    let ext = spec
        .output_ext
        .clone()
        .or_else(|| {
            Path::new(&spec.input)
                .extension()
                .and_then(|e| e.to_str())
                .map(String::from)
        })
        .unwrap_or_else(|| "out".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("mosaic-est-{nanos}.{ext}"));
    let tmp_str = tmp.to_string_lossy().into_owned();

    let models_dir = crate::tools::models_dir(&app);

    let mut argv: Vec<String> = spec
        .args
        .iter()
        .map(|a| {
            a.replace("{input}", &spec.input)
                .replace("{output}", &tmp_str)
                .replace("{models}", &models_dir)
        })
        .collect();

    // Video: cap the trial duration and extrapolate.
    let mut approximate = false;
    let mut scale_factor = 1.0_f64;
    if let Some(secs) = sample_seconds {
        if spec.tool == "ffmpeg" && secs > 0.0 && !argv.is_empty() {
            let duration = probe_duration(&app, &spec.input).await;
            if duration > secs {
                // Insert `-t <secs>` just before the output (last) argument.
                let pos = argv.len() - 1;
                argv.insert(pos, secs.to_string());
                argv.insert(pos, "-t".into());
                approximate = true;
                scale_factor = duration / secs;
            }
        }
    }

    let out = app
        .shell()
        .command(tool_path)
        .args(argv)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        let tail = String::from_utf8_lossy(&out.stderr);
        let tail = tail.lines().last().unwrap_or("").trim();
        return Err(if tail.is_empty() {
            format!("estimate failed for {}", spec.tool)
        } else {
            tail.to_string()
        });
    }

    let raw = file_size(&tmp);
    let _ = std::fs::remove_file(&tmp);
    let bytes = (raw as f64 * scale_factor).round() as u64;
    Ok(EstimateResult { bytes, approximate })
}
