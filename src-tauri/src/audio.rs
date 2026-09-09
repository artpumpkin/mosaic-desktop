// Local music library scanner. Walks a user-chosen folder for audio files and
// reads tags + duration via the bundled/managed ffprobe (resolved the same way
// the Media Optimizer resolves its tools). Playback happens on the frontend
// through the Tauri asset protocol (convertFileSrc), so this module only needs
// to enumerate + describe the files.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

use crate::tools::resolve_tool;

const AUDIO_EXTS: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus", "wma", "aiff", "aif", "alac",
];

// Bounds so a huge / deep tree can't hang the scan or the per-file ffprobe loop.
const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 8;

#[derive(Serialize)]
pub struct AudioTrack {
    path: String,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>, // seconds
}

// Streamed to the UI over the `audio://scan` event so the Library tab can show
// real-time scan progress (mirrors the Cleanup section's `cleanup://progress`).
#[derive(Serialize, Clone)]
pub struct AudioScanProgress {
    phase: String, // "collecting" | "probing" | "done"
    done: usize,
    total: usize,
    current: String, // file name currently being probed
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let p = entry.path();
        if p.is_dir() {
            collect(&p, out, depth + 1);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if AUDIO_EXTS.contains(&ext.to_lowercase().as_str()) {
                out.push(p);
            }
        }
    }
}

fn tag<'a>(tags: &'a serde_json::Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = tags.get(k).and_then(|v| v.as_str()) {
            if !v.trim().is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn audio_scan_library(app: AppHandle, dir: String) -> Result<Vec<AudioTrack>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("Not a directory: {dir}"));
    }

    let _ = app.emit(
        "audio://scan",
        AudioScanProgress {
            phase: "collecting".into(),
            done: 0,
            total: 0,
            current: String::new(),
        },
    );

    let mut files = Vec::new();
    collect(&root, &mut files, 0);
    files.sort();

    let total = files.len();
    let ffprobe = resolve_tool(&app, "ffprobe");
    let mut tracks = Vec::with_capacity(total);

    for (i, f) in files.into_iter().enumerate() {
        let path_str = f.to_string_lossy().to_string();
        let stem = f
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        // Throttle: emit on the first file, then every 5th, then the last —
        // enough for a smooth bar without flooding the event bus.
        if i == 0 || i % 5 == 0 || i + 1 == total {
            let _ = app.emit(
                "audio://scan",
                AudioScanProgress {
                    phase: "probing".into(),
                    done: i,
                    total,
                    current: stem.clone(),
                },
            );
        }

        let mut track = AudioTrack {
            path: path_str.clone(),
            title: stem,
            artist: None,
            album: None,
            duration: None,
        };

        // Enrich with tags + duration when ffprobe is available. Without it we
        // still return a playable, filename-titled track.
        if let Some(ref probe) = ffprobe {
            let cmd = app.shell().command(probe).args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                &path_str,
            ]);
            if let Ok(out) = cmd.output().await {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    let fmt = &json["format"];
                    track.duration = fmt
                        .get("duration")
                        .and_then(|d| d.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    let tags = &fmt["tags"];
                    if let Some(t) = tag(tags, &["title", "TITLE", "Title"]) {
                        track.title = t;
                    }
                    track.artist = tag(tags, &["artist", "ARTIST", "Artist", "album_artist"]);
                    track.album = tag(tags, &["album", "ALBUM", "Album"]);
                }
            }
        }

        tracks.push(track);
    }

    let _ = app.emit(
        "audio://scan",
        AudioScanProgress {
            phase: "done".into(),
            done: total,
            total,
            current: String::new(),
        },
    );

    Ok(tracks)
}
