// Resolve media tools from the managed directory or the user's installation.
// Only immutable, checksum-pinned assets can be installed automatically;
// other tools surface package-manager instructions. No native tools are bundled.

use std::collections::HashSet;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use futures_util::StreamExt;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

/// The managed CLI tools, in display order. Mirrored in `lib/media/types.ts`.
pub const TOOLS: &[&str] = &[
    "ffmpeg",
    "ffprobe",
    "magick",
    "gs",
    "realesrgan-ncnn-vulkan",
    "yt-dlp",
];

pub fn tool_filename(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

#[cfg(unix)]
pub fn ensure_exec(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(p) {
        let mode = meta.permissions().mode();
        if mode & 0o111 == 0 {
            let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode | 0o755));
        }
    }
}
#[cfg(not(unix))]
pub fn ensure_exec(_p: &Path) {}

// ---- Managed install location -------------------------------------------

/// `{app_data}/tools` — per-user, writable, survives app updates. Binaries
/// live at the root; Real-ESRGAN models go in the `models/` subdir.
fn install_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("tools"))
}

/// The directory passed to Real-ESRGAN as `{models}`. Prefers the managed
/// install, then the legacy bundled resources dir.
pub fn models_dir(app: &AppHandle) -> String {
    if let Some(path) = std::env::var_os("MOSAIC_MODELS_DIR") {
        let path = PathBuf::from(path);
        if path.is_absolute() && path.is_dir() {
            return path.to_string_lossy().into_owned();
        }
    }
    if let Some(dir) = install_dir(app) {
        let m = dir.join("models");
        if m.is_dir() {
            return m.to_string_lossy().into_owned();
        }
    }
    app.path()
        .resource_dir()
        .map(|d| d.join("media-models").to_string_lossy().into_owned())
        .unwrap_or_else(|_| "media-models".to_string())
}

/// Search `$PATH` (plus the well-known Homebrew/system dirs that a macOS GUI
/// app's minimal PATH usually omits) for a tool the user already installed.
fn find_on_path(name: &str) -> Option<PathBuf> {
    let fname = tool_filename(name);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    #[cfg(target_os = "macos")]
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(d));
    }
    for d in dirs {
        let p = d.join(&fname);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Resolve a tool to an executable path. See module docs for the order.
pub fn resolve_tool(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let fname = tool_filename(name);

    // 1. Managed install dir.
    if let Some(dir) = install_dir(app) {
        let p = dir.join(&fname);
        if p.exists() {
            ensure_exec(&p);
            return Some(p);
        }
    }
    // 2. System PATH (already-installed / Homebrew).
    if let Some(p) = find_on_path(name) {
        return Some(p);
    }
    // 3. Legacy bundled resources.
    if let Ok(rd) = app.path().resource_dir() {
        let p = rd.join("binaries").join(&fname);
        if p.exists() {
            ensure_exec(&p);
            return Some(p);
        }
    }
    // 4. Dev tree: `…/src-tauri/target/<profile>/<exe>` → up 3 dirs is `src-tauri`.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(base) = exe.ancestors().nth(3) {
            let p = base.join("binaries").join(&fname);
            if p.exists() {
                ensure_exec(&p);
                return Some(p);
            }
        }
    }
    None
}

// ---- Download manifest ----------------------------------------------------

/// One file to lift out of a downloaded zip: match an entry by basename
/// (case-insensitive) and write it into the install dir as `dest`.
struct Member {
    src: &'static str,
    dest: &'static str,
}

/// How to install a tool on the current platform.
struct DownloadSpec {
    url: &'static str,
    sha256: &'static str,
    /// Files to lift out of the archive. When `raw` is set, only the single
    /// `dest` of the first member is used (the download *is* the binary).
    members: &'static [Member],
    /// Also extract every `*.param` / `*.bin` into the `models/` subdir.
    models: bool,
    /// The download is the executable itself (no archive) — write it verbatim
    /// to `members[0].dest`.
    raw: bool,
}

// Only immutable release assets with recorded publisher digests can be installed.
// Other tools use the user's package manager / PATH installation.
fn spec_for(tool: &str) -> Option<DownloadSpec> {
    if tool != "yt-dlp" {
        return None;
    }
    #[cfg(target_os = "macos")]
    return Some(DownloadSpec {
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos",
        sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
        members: &[Member {
            src: "yt-dlp",
            dest: "yt-dlp",
        }],
        models: false,
        raw: true,
    });
    #[cfg(target_os = "windows")]
    return Some(DownloadSpec {
        url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe",
        sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
        members: &[Member {
            src: "yt-dlp.exe",
            dest: "yt-dlp.exe",
        }],
        models: false,
        raw: true,
    });
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    None
}

/// Package-manager suggestion shown when a tool isn't installable in-app.
fn install_hint(tool: &str) -> Option<String> {
    if spec_for(tool).is_some() {
        return None;
    }
    let pkg = match tool {
        "magick" => "imagemagick",
        "gs" => "ghostscript",
        "ffmpeg" | "ffprobe" => "ffmpeg",
        "realesrgan-ncnn-vulkan" => {
            return Some(
                "Install Real-ESRGAN from its upstream source and put its executable on PATH"
                    .into(),
            )
        }
        "yt-dlp" => "yt-dlp",
        _ => return None,
    };
    if cfg!(target_os = "macos") {
        Some(format!("brew install {pkg}"))
    } else {
        Some(format!("Install {pkg} and ensure it's on your PATH"))
    }
}

// ---- Status ---------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    name: String,
    available: bool,
    version: Option<String>,
    /// "managed" (downloaded by us) | "path" (system) | "none".
    source: &'static str,
    /// True when we have an upstream installer for this platform.
    installable: bool,
    /// Disk size of the managed install (binary + any models), if managed.
    size_bytes: Option<u64>,
    /// Package-manager command when not installable in-app.
    hint: Option<String>,
}

/// Run a tool's version flag. realesrgan has no version flag (bare invocation
/// prints usage to stderr and exits non-zero), so "spawns at all" = available.
async fn probe_version(app: &AppHandle, name: &str, path: &Path) -> (bool, Option<String>) {
    let version_args: &[&str] = match name {
        "gs" | "yt-dlp" => &["--version"],
        "realesrgan-ncnn-vulkan" => &[],
        _ => &["-version"],
    };
    match app.shell().command(path).args(version_args).output().await {
        Ok(output) => {
            let text = if !output.stdout.is_empty() {
                String::from_utf8_lossy(&output.stdout)
            } else {
                String::from_utf8_lossy(&output.stderr)
            };
            let first = text.lines().next().unwrap_or("").trim().to_string();
            (true, if first.is_empty() { None } else { Some(first) })
        }
        Err(_) => (false, None),
    }
}

/// Total size of the managed files for a tool (binary + models for realesrgan).
fn managed_size(app: &AppHandle, tool: &str, bin: &Path) -> u64 {
    let mut total = std::fs::metadata(bin).map(|m| m.len()).unwrap_or(0);
    if tool == "realesrgan-ncnn-vulkan" {
        if let Some(dir) = install_dir(app) {
            if let Ok(entries) = std::fs::read_dir(dir.join("models")) {
                for e in entries.flatten() {
                    total += e.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
    }
    total
}

#[tauri::command]
pub async fn tools_status(app: AppHandle) -> Result<Vec<ToolStatus>, String> {
    let mut out = Vec::with_capacity(TOOLS.len());
    for &name in TOOLS {
        let fname = tool_filename(name);
        let managed = install_dir(&app)
            .map(|d| d.join(&fname))
            .filter(|p| p.exists());

        let (source, path, size_bytes) = if let Some(p) = managed {
            ensure_exec(&p);
            let size = managed_size(&app, name, &p);
            ("managed", Some(p), Some(size))
        } else if let Some(p) = find_on_path(name) {
            ("path", Some(p), None)
        } else {
            ("none", None, None)
        };

        let (available, version) = match &path {
            Some(p) => probe_version(&app, name, p).await,
            None => (false, None),
        };

        out.push(ToolStatus {
            name: name.to_string(),
            available,
            version,
            source: if available { source } else { "none" },
            installable: spec_for(name).is_some(),
            size_bytes,
            hint: install_hint(name),
        });
    }
    Ok(out)
}

// ---- Install ---------------------------------------------------------------

#[derive(serde::Serialize, Clone)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum InstallProgress {
    /// `total` is 0 when the server doesn't send a Content-Length.
    Downloading {
        received: u64,
        total: u64,
    },
    Extracting,
    Done {
        version: Option<String>,
    },
    Failed {
        message: String,
    },
    Canceled,
}

/// Tools whose install the user has asked to cancel. The download loop checks
/// and clears its own entry.
#[derive(Default)]
pub struct InstallState {
    canceling: Mutex<HashSet<String>>,
}

fn take_cancel(state: &State<'_, InstallState>, tool: &str) -> bool {
    state.canceling.lock().unwrap().remove(tool)
}

#[tauri::command]
pub async fn tools_install(
    app: AppHandle,
    state: State<'_, InstallState>,
    on_event: Channel<InstallProgress>,
    tool: String,
) -> Result<(), String> {
    let fail = |on_event: &Channel<InstallProgress>, msg: String| -> Result<(), String> {
        let _ = on_event.send(InstallProgress::Failed {
            message: msg.clone(),
        });
        Err(msg)
    };

    if !TOOLS.contains(&tool.as_str()) {
        return fail(&on_event, format!("unknown tool: {tool}"));
    }
    let spec = match spec_for(&tool) {
        Some(s) => s,
        None => {
            return fail(
                &on_event,
                format!("{tool} has no in-app installer on this platform"),
            )
        }
    };
    let dir = match install_dir(&app) {
        Some(d) => d,
        None => return fail(&on_event, "could not resolve app data dir".into()),
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return fail(&on_event, format!("could not create install dir: {e}"));
    }

    // Download to a temp file, streaming progress.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!("mosaic-tool-{tool}-{nanos}.zip"));

    let resp = match reqwest::Client::new().get(spec.url).send().await {
        Ok(r) => r,
        Err(e) => return fail(&on_event, format!("download failed: {e}")),
    };
    if !resp.status().is_success() {
        return fail(
            &on_event,
            format!("download failed: HTTP {}", resp.status()),
        );
    }
    let total = resp.content_length().unwrap_or(0);
    let _ = on_event.send(InstallProgress::Downloading { received: 0, total });

    let mut file = match File::create(&tmp) {
        Ok(f) => f,
        Err(e) => return fail(&on_event, format!("could not write temp file: {e}")),
    };
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if take_cancel(&state, &tool) {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            let _ = on_event.send(InstallProgress::Canceled);
            return Ok(());
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                return fail(&on_event, format!("download interrupted: {e}"));
            }
        };
        if received.saturating_add(chunk.len() as u64) > 256 * 1024 * 1024 {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            return fail(&on_event, "Download exceeds 256 MiB".into());
        }
        digest.update(&chunk);
        if let Err(e) = io::Write::write_all(&mut file, &chunk) {
            let _ = std::fs::remove_file(&tmp);
            return fail(&on_event, format!("write error: {e}"));
        }
        received += chunk.len() as u64;
        // Throttle progress events to ~every 512 KB.
        if received - last_emit >= 512 * 1024 {
            last_emit = received;
            let _ = on_event.send(InstallProgress::Downloading { received, total });
        }
    }
    drop(file);
    if format!("{:x}", digest.finalize()) != spec.sha256 {
        let _ = std::fs::remove_file(&tmp);
        return fail(
            &on_event,
            "Download checksum did not match the reviewed release".into(),
        );
    }

    let _ = on_event.send(InstallProgress::Extracting);
    let result = if spec.raw {
        // The download is the binary itself — move it into place verbatim.
        let dest = dir.join(spec.members[0].dest);
        std::fs::rename(&tmp, &dest)
            .or_else(|_| std::fs::copy(&tmp, &dest).map(|_| ()))
            .map(|_| ensure_exec(&dest))
            .map_err(|e| format!("install failed: {e}"))
    } else {
        // Extract (blocking) on a worker thread so we don't stall the runtime.
        let dir2 = dir.clone();
        let tmp2 = tmp.clone();
        let members: Vec<(String, String)> = spec
            .members
            .iter()
            .map(|m| (m.src.to_string(), m.dest.to_string()))
            .collect();
        let want_models = spec.models;
        match tauri::async_runtime::spawn_blocking(move || {
            extract_zip(&tmp2, &dir2, &members, want_models)
        })
        .await
        {
            Ok(r) => r.map_err(|e| format!("extract failed: {e}")),
            Err(e) => Err(format!("extract task failed: {e}")),
        }
    };
    let _ = std::fs::remove_file(&tmp);

    if let Err(e) = result {
        return fail(&on_event, e);
    }

    // Probe the freshly-installed binary so the UI can show its version.
    let fname = tool_filename(&tool);
    let bin = dir.join(&fname);
    ensure_exec(&bin);
    let (_, version) = probe_version(&app, &tool, &bin).await;
    let _ = on_event.send(InstallProgress::Done { version });
    Ok(())
}

/// Unpack the wanted members (matched by basename) into `dir`. When
/// `want_models`, every `*.param` / `*.bin` entry is written to `dir/models/`.
fn extract_zip(
    zip_path: &Path,
    dir: &Path,
    members: &[(String, String)],
    want_models: bool,
) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let models_dir = dir.join("models");
    if want_models {
        std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    }
    let mut found = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let base = name.rsplit(['/', '\\']).next().unwrap_or(&name).to_string();
        let base_lower = base.to_lowercase();

        let dest = members
            .iter()
            .find(|(src, _)| src.to_lowercase() == base_lower)
            .map(|(_, d)| dir.join(d))
            .or_else(|| {
                if want_models && (base_lower.ends_with(".param") || base_lower.ends_with(".bin")) {
                    Some(models_dir.join(&base))
                } else {
                    None
                }
            });

        if let Some(dest) = dest {
            let mut out = File::create(&dest).map_err(|e| e.to_string())?;
            io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            ensure_exec(&dest);
            found += 1;
        }
    }
    if found == 0 {
        return Err("no expected files found in archive".into());
    }
    Ok(())
}

#[tauri::command]
pub fn tools_cancel_install(state: State<'_, InstallState>, tool: String) {
    state.canceling.lock().unwrap().insert(tool);
}

#[tauri::command]
pub fn tools_uninstall(app: AppHandle, tool: String) -> Result<(), String> {
    let dir = install_dir(&app).ok_or("could not resolve app data dir")?;
    let bin = dir.join(tool_filename(&tool));
    if bin.exists() {
        std::fs::remove_file(&bin).map_err(|e| e.to_string())?;
    }
    if tool == "realesrgan-ncnn-vulkan" {
        let _ = std::fs::remove_dir_all(dir.join("models"));
    }
    Ok(())
}
