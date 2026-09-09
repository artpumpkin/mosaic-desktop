// CCleaner-style disk cleanup, implemented natively (no external CLI tools).
//
// Three phases, each surfaced as its own set of #[tauri::command]s:
//   A. Mosaic's own cache  — the librqbit stream cache under app_data_dir.
//   B. Known-safe system junk — a CURATED allowlist of regenerable caches/logs
//      (macOS), plus emptying the Trash.
//   C. Big-file + duplicate finder — walk a user-chosen root, surface large or
//      identical files for the user to review.
//
// Safety model (the whole point of the feature being "supervised"):
//   * Scanning is read-only. Nothing is removed without an explicit, confirmed
//     selection from the UI.
//   * Everything moves to the system Trash via the `trash` crate (recoverable).
//     The ONE permanent action is emptying the Trash bucket, clearly flagged.
//   * The frontend is never trusted: Phase B re-resolves its paths server-side
//     from the allowlist, and every path is run through `Guards` (canonicalize,
//     system-critical denylist, ownership check) before it can be trashed.
//
// Progress for the slow Phase-C walks is streamed to the UI via the
// `cleanup://progress` Tauri event (the first emit/listen pair in this app).

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::torrent::TorrentEngine;

/// Tracks in-flight Phase-C scans so the UI can stop one mid-walk. Each scan
/// registers its `scan_id → cancel flag`; the long walk/hash loops poll the
/// flag and bail early, returning whatever they found so far.
#[derive(Default)]
pub struct CleanupState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CleanupState {
    fn register(&self, scan_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .unwrap()
            .insert(scan_id.to_string(), flag.clone());
        flag
    }
    fn finish(&self, scan_id: &str) {
        self.cancels.lock().unwrap().remove(scan_id);
    }
    fn cancel(&self, scan_id: &str) {
        if let Some(flag) = self.cancels.lock().unwrap().get(scan_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Signal a running scan (by its `scan_id`) to stop as soon as possible.
#[tauri::command]
pub fn cleanup_cancel_scan(state: State<'_, CleanupState>, scan_id: String) {
    state.cancel(&scan_id);
}

// ---- Wire types (snake_case to match the rest of the app's IPC) -------------

#[derive(Serialize, Clone)]
pub struct CacheItem {
    pub id: String,
    pub label: String,
    pub description: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub removable: bool,
}

#[derive(Serialize, Clone)]
pub struct CacheScan {
    pub items: Vec<CacheItem>,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct JunkBucket {
    pub id: String,
    pub label: String,
    pub description: String,
    pub caveat: Option<String>,
    pub paths: Vec<String>,
    pub size_bytes: u64,
    pub file_count: u64,
    /// "trash" (recoverable) | "empty_trash" (permanent).
    pub action: String,
}

#[derive(Serialize, Clone)]
pub struct JunkScan {
    pub buckets: Vec<JunkBucket>,
    pub total_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct LargeFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size_bytes: u64,
    pub paths: Vec<String>,
    pub reclaimable_bytes: u64,
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub scan_id: String,
    /// "walking" | "hashing" | "done"
    pub phase: String,
    pub files_seen: u64,
    pub bytes_seen: u64,
    pub current_dir: String,
}

#[derive(Serialize, Clone)]
pub struct TrashFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize, Clone, Default)]
pub struct TrashResult {
    pub trashed: Vec<String>,
    pub failed: Vec<TrashFailure>,
    pub freed_bytes: u64,
}

impl TrashResult {
    fn merge(&mut self, other: TrashResult) {
        self.trashed.extend(other.trashed);
        self.failed.extend(other.failed);
        self.freed_bytes += other.freed_bytes;
    }
}

// ---- Filesystem helpers -----------------------------------------------------

/// Actual on-disk size of a file, NOT its apparent length. Sparse files —
/// VM/container disk images like Docker.raw or `rootfs.img` — report a huge
/// `len()` (the max they could grow to) while occupying far fewer real blocks.
/// `st_blocks` (512-byte units) is what `du` and Finder report, so we use it
/// to avoid showing a "926 GB" file on a disk that only has 663 GB used.
#[cfg(unix)]
fn disk_size(meta: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.blocks().saturating_mul(512)
}
#[cfg(not(unix))]
fn disk_size(meta: &fs::Metadata) -> u64 {
    meta.len()
}

/// (total bytes on disk, file count) for a path. For a file: its allocated
/// size. For a directory: the recursive sum, never following symlinks (so we
/// don't escape the tree or double-count). Unreadable entries (e.g.
/// TCC-protected) are skipped rather than failing the whole scan.
fn path_size(p: &Path) -> (u64, u64) {
    let meta = match fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    if meta.file_type().is_symlink() {
        return (0, 1);
    }
    if meta.is_file() {
        return (disk_size(&meta), 1);
    }
    let mut bytes = 0u64;
    let mut count = 0u64;
    for entry in WalkDir::new(p)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Ok(m) = entry.metadata() {
                bytes += disk_size(&m);
                count += 1;
            }
        }
    }
    (bytes, count)
}

fn dir_entries(dir: &Path) -> Vec<PathBuf> {
    match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).map(|e| e.path()).collect(),
        Err(_) => Vec::new(),
    }
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn resolve_root(app: &AppHandle, root: Option<String>) -> Result<PathBuf, String> {
    match root {
        Some(r) if !r.trim().is_empty() => Ok(PathBuf::from(r)),
        _ => app.path().home_dir().map_err(|e| format!("home_dir: {e}")),
    }
}

#[cfg(unix)]
fn owner_uid(p: &Path) -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    fs::symlink_metadata(p).ok().map(|m| m.uid())
}

/// Move a path to the system Trash. On macOS we explicitly use the in-process
/// `NSFileManager.trashItemAtURL` API instead of the `trash` crate's DEFAULT
/// method, which shells out to `osascript`/Finder ("tell application Finder to
/// delete"). The Finder route triggers a macOS Automation/authorization prompt
/// on essentially every call — that's the repeated "enter your password"
/// dialog. NSFileManager runs in-process and only prompts when the OS genuinely
/// requires it (and not at all once Mosaic has Full Disk Access).
fn trash_delete(path: &Path) -> Result<(), String> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| e.to_string())
}

// ---- Server-side guards (never trust paths from the frontend) ---------------

/// Resolved trust context for one command invocation.
struct Guards {
    app_data: PathBuf,
    home: PathBuf,
    #[cfg(unix)]
    home_uid: Option<u32>,
}

impl Guards {
    const SYSTEM_ROOTS: &'static [&'static str] = &[
        "/System",
        "/Library",
        "/usr",
        "/bin",
        "/sbin",
        "/etc",
        "/var",
        "/private/var/folders",
        "/Applications",
        "/opt",
        "/cores",
    ];

    fn new(app: &AppHandle) -> Result<Self, String> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("app_data_dir: {e}"))?;
        let home = app
            .path()
            .home_dir()
            .map_err(|e| format!("home_dir: {e}"))?;
        Ok(Self {
            #[cfg(unix)]
            home_uid: owner_uid(&home),
            app_data,
            home,
        })
    }

    /// Canonicalize the PARENT and re-append the final component, so a path
    /// that is itself a symlink resolves to the link (we remove the link, not
    /// its target) and `..` segments can't smuggle us out of an allowed root.
    fn canonicalize_target(&self, raw: &str) -> Result<PathBuf, String> {
        let p = Path::new(raw);
        if !p.is_absolute() {
            return Err("path must be absolute".into());
        }
        let parent = p.parent().ok_or("path has no parent")?;
        let name = p.file_name().ok_or("path has no file name")?;
        let canon_parent =
            fs::canonicalize(parent).map_err(|e| format!("canonicalize parent: {e}"))?;
        Ok(canon_parent.join(name))
    }

    /// Backstop applied to EVERY deletion, including server-resolved Phase-B
    /// paths: never the filesystem/system roots, never anything inside Mosaic's
    /// own app-data dir (db + encryption key live there), only files we own.
    fn check_system_critical(&self, canon: &Path) -> Result<(), String> {
        if canon == Path::new("/") {
            return Err("refusing to touch the filesystem root".into());
        }
        for r in Self::SYSTEM_ROOTS {
            if canon.starts_with(r) {
                return Err(format!("refusing system path under {r}"));
            }
        }
        if canon.starts_with(&self.app_data) {
            return Err("refusing to touch Mosaic's own data directory".into());
        }
        #[cfg(unix)]
        {
            if let (Some(hu), Some(tu)) = (self.home_uid, owner_uid(canon)) {
                if hu != tu {
                    return Err("refusing: file is not owned by the current user".into());
                }
            }
        }
        Ok(())
    }

    /// Stricter check for arbitrary user-selected Phase-C paths: also refuses
    /// the home root and whole real-data folders as a unit (individual files
    /// *inside* them, picked deliberately in the finder, are still allowed).
    fn check_user_path(&self, canon: &Path) -> Result<(), String> {
        self.check_system_critical(canon)?;
        let protected = [
            self.home.clone(),
            self.home.join("Documents"),
            self.home.join("Desktop"),
            self.home.join("Downloads"),
            self.home.join("Pictures"),
            self.home.join("Movies"),
            self.home.join("Music"),
            self.home.join("Library"),
        ];
        for d in &protected {
            if canon == d.as_path() {
                return Err(format!(
                    "refusing to delete the whole {} folder",
                    d.display()
                ));
            }
        }
        Ok(())
    }
}

// ---- Phase A: Mosaic's own cache --------------------------------------------

#[tauri::command]
pub async fn cleanup_scan_app_cache(app: AppHandle) -> Result<CacheScan, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let torrents = dir.join("torrents");
        let (bytes, count) = if torrents.exists() {
            path_size(&torrents)
        } else {
            (0, 0)
        };
        let item = CacheItem {
            id: "torrents".into(),
            label: "Stream cache".into(),
            description:
                "Video pieces downloaded by the built-in torrent streamer. Safe to clear — \
                 streams re-download on demand (the next movie restarts the engine, ~10s)."
                    .into(),
            path: torrents.display().to_string(),
            size_bytes: bytes,
            file_count: count,
            removable: true,
        };
        CacheScan {
            total_bytes: item.size_bytes,
            items: vec![item],
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_clear_app_cache(
    app: AppHandle,
    engine: State<'_, TorrentEngine>,
    ids: Vec<String>,
) -> Result<TrashResult, String> {
    crate::security::confirm_cleanup(
        &app,
        format!(
            "Move the selected Mosaic cache folders to the Trash?\n{}",
            ids.join(", ")
        ),
    )
    .await?;
    let mut res = TrashResult::default();
    if ids.iter().any(|i| i == "torrents") {
        // Stop every torrent and DROP the librqbit session so its open handles
        // on `torrents/` are released before we move the dir to the Trash.
        let dir = crate::torrent::shutdown_session_for_clear(&app, &*engine).await?;
        let part = tauri::async_runtime::spawn_blocking(move || {
            let mut out = TrashResult::default();
            if dir.exists() {
                let (bytes, _) = path_size(&dir);
                match trash_delete(&dir) {
                    Ok(()) => {
                        out.trashed.push(dir.display().to_string());
                        out.freed_bytes += bytes;
                    }
                    Err(reason) => out.failed.push(TrashFailure {
                        path: dir.display().to_string(),
                        reason,
                    }),
                }
            }
            out
        })
        .await
        .map_err(|e| e.to_string())?;
        res.merge(part);
    }
    Ok(res)
}

// ---- Phase B: curated system-junk allowlist (macOS) -------------------------

#[cfg(target_os = "macos")]
struct BucketSpec {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    caveat: Option<&'static str>,
    /// "trash" | "empty_trash"
    action: &'static str,
    /// Directories whose *contents* (top-level entries) this bucket targets.
    dirs: Vec<PathBuf>,
}

/// A deliberately small, high-confidence allowlist of regenerable caches. We
/// target the *contents* of each dir (apps recreate the dir itself), never the
/// dir. Notably EXCLUDED: ~/Library/Application Support (real data), the pnpm
/// store (hardlinked into node_modules — deleting corrupts installs),
/// CoreSimulator/Devices, Xcode Archives, and anything system/SIP-protected.
#[cfg(target_os = "macos")]
fn macos_buckets(home: &Path) -> Vec<BucketSpec> {
    let lib = home.join("Library");
    let caches = lib.join("Caches");
    let dev = lib.join("Developer");
    vec![
        BucketSpec {
            id: "user_caches",
            label: "User app caches",
            description: "Cached data apps store under ~/Library/Caches. Rebuilt as needed.",
            caveat: Some("A currently-running app may immediately recreate its cache."),
            action: "trash",
            dirs: vec![caches.clone()],
        },
        BucketSpec {
            id: "user_logs",
            label: "User logs",
            description: "Diagnostic logs under ~/Library/Logs.",
            caveat: None,
            action: "trash",
            dirs: vec![lib.join("Logs")],
        },
        BucketSpec {
            id: "trash",
            label: "Empty Trash",
            description: "Permanently remove everything currently in your Trash.",
            caveat: Some("Permanent — these items cannot be recovered."),
            action: "empty_trash",
            dirs: vec![home.join(".Trash")],
        },
        BucketSpec {
            id: "xcode_deriveddata",
            label: "Xcode DerivedData",
            description: "Intermediate build products. Xcode regenerates them on the next build.",
            caveat: Some("Don't clean during an active build."),
            action: "trash",
            dirs: vec![dev.join("Xcode/DerivedData")],
        },
        BucketSpec {
            id: "ios_device_support",
            label: "Xcode device support",
            description:
                "Cached symbols for attached iOS/watchOS devices; re-downloaded on connect.",
            caveat: None,
            action: "trash",
            dirs: vec![
                dev.join("Xcode/iOS DeviceSupport"),
                dev.join("Xcode/watchOS DeviceSupport"),
            ],
        },
        BucketSpec {
            id: "coresimulator_caches",
            label: "CoreSimulator caches",
            description: "Simulator caches only — never your simulator devices or their data.",
            caveat: None,
            action: "trash",
            dirs: vec![dev.join("CoreSimulator/Caches")],
        },
        BucketSpec {
            id: "swiftpm_cache",
            label: "SwiftPM cache",
            description: "Swift Package Manager download cache; re-fetched on next resolve.",
            caveat: None,
            action: "trash",
            dirs: vec![caches.join("org.swift.swiftpm")],
        },
        BucketSpec {
            id: "homebrew_cache",
            label: "Homebrew downloads",
            description: "Cached Homebrew bottle/source downloads; re-downloaded when needed.",
            caveat: None,
            action: "trash",
            dirs: vec![caches.join("Homebrew")],
        },
        BucketSpec {
            id: "npm_cache",
            label: "npm cache",
            description: "npm's content-addressable download cache; repopulates automatically.",
            caveat: None,
            action: "trash",
            dirs: vec![home.join(".npm/_cacache")],
        },
        BucketSpec {
            id: "yarn_cache",
            label: "Yarn cache",
            description: "Yarn package cache.",
            caveat: None,
            action: "trash",
            dirs: vec![caches.join("Yarn"), home.join(".yarn/cache")],
        },
        BucketSpec {
            id: "pip_cache",
            label: "pip cache",
            description: "Python pip download/wheel cache.",
            caveat: None,
            action: "trash",
            dirs: vec![caches.join("pip")],
        },
        BucketSpec {
            id: "gradle_cache",
            label: "Gradle caches",
            description: "Gradle build/download caches; re-downloaded on next build.",
            caveat: None,
            action: "trash",
            dirs: vec![home.join(".gradle/caches")],
        },
        BucketSpec {
            id: "cocoapods_cache",
            label: "CocoaPods cache",
            description: "CocoaPods spec/pod download cache.",
            caveat: None,
            action: "trash",
            dirs: vec![caches.join("CocoaPods")],
        },
        BucketSpec {
            id: "browser_caches",
            label: "Browser caches",
            description: "Disk caches for Safari, Chrome, Firefox, and Brave.",
            caveat: Some("Quit the browser first for a complete sweep."),
            action: "trash",
            dirs: vec![
                caches.join("com.apple.Safari"),
                caches.join("Google/Chrome"),
                caches.join("Firefox"),
                caches.join("BraveSoftware"),
            ],
        },
    ]
}

#[tauri::command]
pub async fn cleanup_scan_system_junk(app: AppHandle) -> Result<JunkScan, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("home_dir: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut buckets: Vec<JunkBucket> = Vec::new();
        let mut total = 0u64;
        #[cfg(target_os = "macos")]
        {
            for spec in macos_buckets(&home) {
                let entries: Vec<PathBuf> = spec
                    .dirs
                    .iter()
                    .filter(|d| d.exists())
                    .flat_map(|d| dir_entries(d))
                    .collect();
                let mut bytes = 0u64;
                let mut count = 0u64;
                let mut paths = Vec::with_capacity(entries.len());
                for e in &entries {
                    let (b, c) = path_size(e);
                    bytes += b;
                    count += c;
                    paths.push(e.display().to_string());
                }
                total += bytes;
                buckets.push(JunkBucket {
                    id: spec.id.into(),
                    label: spec.label.into(),
                    description: spec.description.into(),
                    caveat: spec.caveat.map(|s| s.to_string()),
                    paths,
                    size_bytes: bytes,
                    file_count: count,
                    action: spec.action.into(),
                });
            }
        }
        let _ = &home;
        JunkScan {
            buckets,
            total_bytes: total,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_clean_system_junk(
    app: AppHandle,
    bucket_ids: Vec<String>,
) -> Result<TrashResult, String> {
    if bucket_ids.len() > 32 {
        return Err("Too many cleanup categories".into());
    }
    crate::security::confirm_cleanup(
        &app,
        format!(
            "Clean these categories? Selecting the Trash category permanently empties it.\n{}",
            bucket_ids.join(", ")
        ),
    )
    .await?;
    let guards = Guards::new(&app)?;
    #[allow(unused_variables)]
    let home = guards.home.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut res = TrashResult::default();
        #[cfg(target_os = "macos")]
        {
            // Re-resolve targets server-side from the allowlist — the client's
            // `bucket_ids` only select which buckets, never which paths.
            for spec in macos_buckets(&home)
                .into_iter()
                .filter(|s| bucket_ids.iter().any(|b| b == s.id))
            {
                let permanent = spec.action == "empty_trash";
                let entries: Vec<PathBuf> = spec
                    .dirs
                    .iter()
                    .filter(|d| d.exists())
                    .flat_map(|d| dir_entries(d))
                    .collect();
                for entry in entries {
                    let raw = entry.display().to_string();
                    let canon = match guards.canonicalize_target(&raw) {
                        Ok(c) => c,
                        Err(e) => {
                            res.failed.push(TrashFailure {
                                path: raw,
                                reason: e,
                            });
                            continue;
                        }
                    };
                    if let Err(e) = guards.check_system_critical(&canon) {
                        res.failed.push(TrashFailure {
                            path: raw,
                            reason: e,
                        });
                        continue;
                    }
                    let (bytes, _) = path_size(&entry);
                    let outcome = if permanent {
                        if entry.is_dir()
                            && !entry
                                .symlink_metadata()
                                .map(|m| m.file_type().is_symlink())
                                .unwrap_or(false)
                        {
                            fs::remove_dir_all(&entry).map_err(|e| e.to_string())
                        } else {
                            fs::remove_file(&entry).map_err(|e| e.to_string())
                        }
                    } else {
                        trash_delete(&entry)
                    };
                    match outcome {
                        Ok(()) => {
                            res.trashed.push(raw);
                            res.freed_bytes += bytes;
                        }
                        Err(reason) => res.failed.push(TrashFailure { path: raw, reason }),
                    }
                }
            }
        }
        res
    })
    .await
    .map_err(|e| e.to_string())
}

// ---- Phase C: big-file + duplicate finder -----------------------------------

#[tauri::command]
pub async fn cleanup_scan_large_files(
    app: AppHandle,
    state: State<'_, CleanupState>,
    root: Option<String>,
    min_size_bytes: u64,
    limit: usize,
    scan_id: String,
) -> Result<Vec<LargeFile>, String> {
    let root = resolve_root(&app, root)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let limit = limit.max(1);
    let emit_app = app.clone();
    let cancel = state.register(&scan_id);
    let cancel_id = scan_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Min-heap capped at `limit` keeps memory flat on huge trees: we only
        // ever retain the `limit` largest files seen so far.
        let mut heap: BinaryHeap<Reverse<(u64, u64, String)>> = BinaryHeap::new();
        let mut files_seen = 0u64;
        let mut bytes_seen = 0u64;
        let mut since = 0u64;
        let mut last = Instant::now();
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.path() != app_data)
        {
            if cancel.load(Ordering::Relaxed) {
                break; // user stopped the scan — return what we have so far
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue, // unreadable (e.g. TCC) — skip, never abort
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let size = disk_size(&meta);
            files_seen += 1;
            bytes_seen += size;
            since += 1;
            if size >= min_size_bytes {
                heap.push(Reverse((
                    size,
                    modified_ms(&meta),
                    entry.path().display().to_string(),
                )));
                if heap.len() > limit {
                    heap.pop();
                }
            }
            if since >= 500 || last.elapsed().as_millis() >= 100 {
                let _ = emit_app.emit(
                    "cleanup://progress",
                    ScanProgress {
                        scan_id: scan_id.clone(),
                        phase: "walking".into(),
                        files_seen,
                        bytes_seen,
                        current_dir: entry
                            .path()
                            .parent()
                            .map(|p| p.display().to_string())
                            .unwrap_or_default(),
                    },
                );
                since = 0;
                last = Instant::now();
            }
        }
        let _ = emit_app.emit(
            "cleanup://progress",
            ScanProgress {
                scan_id: scan_id.clone(),
                phase: "done".into(),
                files_seen,
                bytes_seen,
                current_dir: String::new(),
            },
        );
        let mut files: Vec<LargeFile> = heap
            .into_iter()
            .map(|Reverse((size, mtime, path))| LargeFile {
                path,
                size_bytes: size,
                modified_ms: mtime,
            })
            .collect();
        files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        files
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(&cancel_id);
    result
}

fn hash_prefix(p: &Path, n: usize) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let mut buf = vec![0u8; n];
    let read = std::io::Read::read(&mut f, &mut buf).ok()?;
    let mut h = Sha256::new();
    h.update(&buf[..read]);
    Some(format!("{:x}", h.finalize()))
}

fn hash_full(p: &Path) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let read = std::io::Read::read(&mut f, &mut buf).ok()?;
        if read == 0 {
            break;
        }
        h.update(&buf[..read]);
    }
    Some(format!("{:x}", h.finalize()))
}

#[tauri::command]
pub async fn cleanup_scan_duplicates(
    app: AppHandle,
    state: State<'_, CleanupState>,
    root: Option<String>,
    min_size_bytes: u64,
    scan_id: String,
) -> Result<Vec<DuplicateGroup>, String> {
    let root = resolve_root(&app, root)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let emit_app = app.clone();
    let cancel = state.register(&scan_id);
    let cancel_id = scan_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Pass 1: bucket candidates by exact size (cheap; kills most files).
        let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
        let mut files_seen = 0u64;
        let mut bytes_seen = 0u64;
        let mut since = 0u64;
        let mut last = Instant::now();
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| e.path() != app_data)
        {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let size = disk_size(&meta);
            files_seen += 1;
            bytes_seen += size;
            since += 1;
            if size >= min_size_bytes {
                by_size
                    .entry(size)
                    .or_default()
                    .push(entry.path().to_path_buf());
            }
            if since >= 500 || last.elapsed().as_millis() >= 100 {
                let _ = emit_app.emit(
                    "cleanup://progress",
                    ScanProgress {
                        scan_id: scan_id.clone(),
                        phase: "walking".into(),
                        files_seen,
                        bytes_seen,
                        current_dir: entry
                            .path()
                            .parent()
                            .map(|p| p.display().to_string())
                            .unwrap_or_default(),
                    },
                );
                since = 0;
                last = Instant::now();
            }
        }

        // Pass 2: within each size bucket, prefilter by a 4 KiB prefix hash,
        // then confirm survivors with a full streamed hash.
        let mut groups: Vec<DuplicateGroup> = Vec::new();
        let mut hashed = 0u64;
        for (size, paths) in by_size {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if paths.len() < 2 {
                continue;
            }
            let mut by_prefix: HashMap<String, Vec<PathBuf>> = HashMap::new();
            for p in paths {
                if let Some(h) = hash_prefix(&p, 4096) {
                    by_prefix.entry(h).or_default().push(p);
                }
                hashed += 1;
                if hashed % 200 == 0 {
                    let _ = emit_app.emit(
                        "cleanup://progress",
                        ScanProgress {
                            scan_id: scan_id.clone(),
                            phase: "hashing".into(),
                            files_seen: hashed,
                            bytes_seen,
                            current_dir: String::new(),
                        },
                    );
                }
            }
            for (_, sub) in by_prefix {
                if sub.len() < 2 {
                    continue;
                }
                let mut by_full: HashMap<String, Vec<PathBuf>> = HashMap::new();
                for p in sub {
                    if let Some(h) = hash_full(&p) {
                        by_full.entry(h).or_default().push(p);
                    }
                    hashed += 1;
                }
                for (h, dups) in by_full {
                    if dups.len() < 2 {
                        continue;
                    }
                    let count = dups.len() as u64;
                    groups.push(DuplicateGroup {
                        hash: h,
                        size_bytes: size,
                        reclaimable_bytes: size * (count - 1),
                        paths: dups.iter().map(|p| p.display().to_string()).collect(),
                    });
                }
            }
        }
        let _ = emit_app.emit(
            "cleanup://progress",
            ScanProgress {
                scan_id: scan_id.clone(),
                phase: "done".into(),
                files_seen: hashed,
                bytes_seen,
                current_dir: String::new(),
            },
        );
        groups.sort_by(|a, b| b.reclaimable_bytes.cmp(&a.reclaimable_bytes));
        groups
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(&cancel_id);
    result
}

/// Reveal a path in Finder (selects it in its containing folder), via the
/// macOS `open -R`. Read-only — it never modifies anything.
#[tauri::command]
pub async fn cleanup_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("reveal: {e}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
    Ok(())
}

/// Move arbitrary user-selected paths to the Trash. The single most
/// safety-critical command — applies the full `check_user_path` guard to every
/// path and never trusts the frontend.
#[tauri::command]
pub async fn cleanup_trash_paths(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<TrashResult, String> {
    if paths.len() > 1000 {
        return Err("Select at most 1,000 files at a time".into());
    }
    crate::security::confirm_cleanup(
        &app,
        format!(
            "Move {} selected items to the Trash?\n{}",
            paths.len(),
            paths
                .iter()
                .take(12)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        ),
    )
    .await?;
    let guards = Guards::new(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut res = TrashResult::default();
        for raw in paths {
            let canon = match guards.canonicalize_target(&raw) {
                Ok(c) => c,
                Err(e) => {
                    res.failed.push(TrashFailure {
                        path: raw,
                        reason: e,
                    });
                    continue;
                }
            };
            if let Err(e) = guards.check_user_path(&canon) {
                res.failed.push(TrashFailure {
                    path: raw,
                    reason: e,
                });
                continue;
            }
            // Re-stat at delete time: a path that vanished between scan and now
            // is a no-op success, not an error.
            if fs::symlink_metadata(&canon).is_err() {
                res.trashed.push(raw);
                continue;
            }
            let (bytes, _) = path_size(&canon);
            match trash_delete(&canon) {
                Ok(()) => {
                    res.trashed.push(raw);
                    res.freed_bytes += bytes;
                }
                Err(reason) => res.failed.push(TrashFailure { path: raw, reason }),
            }
        }
        res
    })
    .await
    .map_err(|e| e.to_string())
}

/// Open the macOS "Full Disk Access" settings pane so the user can grant
/// Mosaic persistent access to TCC-protected folders (Safari/Mail caches, etc.)
/// — granting it once removes the repeated per-folder permission prompts.
/// No-op on other platforms.
#[tauri::command]
pub async fn cleanup_open_full_disk_access() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .map_err(|e| format!("open settings: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guards() -> Guards {
        Guards {
            app_data: PathBuf::from(
                "/Users/test/Library/Application Support/com.artpumpkin.mosaic",
            ),
            home: PathBuf::from("/Users/test"),
            // None disables the ownership check so these tests stay hermetic.
            #[cfg(unix)]
            home_uid: None,
        }
    }

    #[test]
    fn refuses_system_roots_and_app_data() {
        let g = guards();
        assert!(g.check_system_critical(Path::new("/")).is_err());
        assert!(g
            .check_system_critical(Path::new("/System/Library/x"))
            .is_err());
        assert!(g.check_system_critical(Path::new("/Library/Foo")).is_err());
        assert!(g.check_system_critical(Path::new("/usr/bin/zsh")).is_err());
        // Mosaic's own data dir (and the db/key inside it) is off-limits.
        assert!(g
            .check_system_critical(Path::new(
                "/Users/test/Library/Application Support/com.artpumpkin.mosaic/finance.db"
            ))
            .is_err());
        // A regular user cache file is fine.
        assert!(g
            .check_system_critical(Path::new("/Users/test/Library/Caches/foo/bar"))
            .is_ok());
    }

    #[test]
    fn user_path_protects_whole_folders_but_allows_files_inside() {
        let g = guards();
        // Whole real-data roots: refused.
        assert!(g.check_user_path(Path::new("/Users/test")).is_err());
        assert!(g
            .check_user_path(Path::new("/Users/test/Documents"))
            .is_err());
        assert!(g.check_user_path(Path::new("/Users/test/Library")).is_err());
        assert!(g
            .check_user_path(Path::new("/Users/test/Downloads"))
            .is_err());
        // Individual files chosen in the finder: allowed.
        assert!(g
            .check_user_path(Path::new("/Users/test/Documents/big.iso"))
            .is_ok());
        assert!(g
            .check_user_path(Path::new("/Users/test/Downloads/movie.mkv"))
            .is_ok());
        // System paths still refused via the shared backstop.
        assert!(g.check_user_path(Path::new("/System/x")).is_err());
    }
}
