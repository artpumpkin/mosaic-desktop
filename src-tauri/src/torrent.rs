// Lightweight torrent streaming engine, used by the Movies/Series section so
// Real-Debrid stays optional (matches Stremio's bundled-libtorrent UX).
//
// Design:
// 1. A single shared librqbit::Session is created lazily on the first
//    torrent_start call and persists for the app's lifetime. The download
//    folder is `app_data_dir/torrents/`.
// 2. Tauri commands (torrent_start / torrent_status / torrent_stop /
//    torrent_stop_all) drive lifecycle from the JS side.
// 3. A custom URI scheme protocol — `torrent-stream://localhost/{info_hash}/{file_idx}`
//    — serves byte ranges of the requested file to the WebView's <video>
//    element. We reuse the same pattern as `wt-proxy://`, capping per-request
//    reads to PROXY_CHUNK_BYTES so we never buffer a whole movie in RAM.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::Arc;

use librqbit::{
    api::{Api, TorrentIdOrHash},
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::sync::Mutex;

// Grep-friendly terminal logging for the torrent engine + streaming server.
// All lines share the `[torrent]` prefix followed by a Unix-ms timestamp.

/// Unix epoch milliseconds — stamped on every `[torrent]` log line.
fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

macro_rules! tlog {
    ($($arg:tt)*) => {
        eprintln!("[torrent] {} {}", now_ms(), format_args!($($arg)*))
    };
}

// 4MB chunks — same value as the wt-proxy stream cap, so WebKit's <video>
// pipeline issues follow-up Range requests at its natural cadence instead
// of us holding an entire file in memory before responding.
const STREAM_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

// Public BitTorrent trackers appended to every bare magnet we get from
// Torrentio. Torrentio hands us only `magnet:?xt=urn:btih:<hash>` with no
// `tr=` entries — that means librqbit can only discover peers via DHT,
// which bootstraps slowly on cold start (the long "Finding peers…"
// spinner the user sees on the first stream). Tagging every magnet with
// this curated list of well-known public trackers brings playback start
// times in line with Stremio, which does the same thing internally.
// Sourced from the ngosang/trackerslist "best" set; keep it short — too
// many trackers slow down the announce phase.
const PUBLIC_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.theoks.net:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://tracker.dler.com:6969/announce",
    "udp://opentracker.io:6969/announce",
];

fn magnet_with_trackers(info_hash: &str) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    let mut url = format!("magnet:?xt=urn:btih:{info_hash}");
    for tr in PUBLIC_TRACKERS {
        url.push_str("&tr=");
        url.push_str(&utf8_percent_encode(tr, NON_ALPHANUMERIC).to_string());
    }
    url
}

/// Shared torrent engine. One per app launch, initialized lazily on the first
/// `torrent_start` invocation. Behind a tokio Mutex because Session::add_torrent
/// is async and we don't want two concurrent adds of the same info_hash.
pub struct TorrentEngine {
    inner: Mutex<Option<EngineInner>>,
    /// Port of the local HTTP streaming server (see `start_http_server`).
    /// 0 until the server has bound. libmpv (Movies on macOS) can't read the
    /// `torrent-stream://` custom scheme — it fetches from this server instead.
    http_port: AtomicU16,
}

struct EngineInner {
    session: Arc<Session>,
    api: Api,
    handles: HashMap<String, Arc<ManagedTorrent>>,
}

impl TorrentEngine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            http_port: AtomicU16::new(0),
        }
    }

    pub fn set_http_port(&self, port: u16) {
        self.http_port.store(port, Ordering::Relaxed);
    }
}

async fn ensure_session(app: &AppHandle, engine: &TorrentEngine) -> Result<(), String> {
    let mut guard = engine.inner.lock().await;
    if guard.is_some() {
        return Ok(());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("torrents");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create torrents dir: {e}"))?;

    // Tuned for streaming. Big wins over `Session::new(dir)` defaults:
    //   - upnp port forwarding → router opens an inbound TCP port, so we
    //     get peers connecting to *us* on top of the outbound ones we
    //     dial. Without this we're effectively in "passive" mode and only
    //     get half the swarm. This is the single biggest knob for speed.
    //   - fastresume → reuse on-disk piece state across runs / re-adds
    //     so flipping streams within the same torrent doesn't re-hash.
    //   - session-wide trackers → librqbit announces to these for every
    //     torrent, removing the need to pin them onto each magnet URL
    //     individually (and avoiding magnet-parse edge cases on librqbit's
    //     side that we suspect caused the recent SIGABRT crash).
    //   - defer_writes_up_to → buffer up to 64MB of writes in RAM so
    //     SSD jitter doesn't stall reads on the playing video.
    let trackers: std::collections::HashSet<url::Url> = PUBLIC_TRACKERS
        .iter()
        .filter_map(|s| url::Url::parse(s).ok())
        .collect();

    let opts = SessionOptions {
        fastresume: true,
        dht: Some(librqbit::DhtSessionConfig {
            persistence: None,
            ..Default::default()
        }),
        trackers,
        // Don't persist the DHT routing table. librqbit's persistence also
        // pins the UDP port it listens on (stored in ~/Library/Caches/
        // com.rqbit.dht/dht.json as e.g. "0.0.0.0:53324") and re-binds that
        // exact port on every launch. If anything already holds it at startup
        // — a lingering previous instance, or another process that grabbed
        // that ephemeral port — DhtState bind fails, Session::new_with_opts
        // returns "error initializing persistent DHT", and EVERY torrent_start
        // then fails with "no engine" (no retry, no fallback) — torrents are
        // bricked for the whole session. Disabling persistence makes DHT bind
        // a fresh free port each launch; it bootstraps from well-known nodes
        // in a few seconds (hidden by prewarm), and peers also come from the
        // configured trackers, so the routing-table reuse we give up is
        // marginal next to never being able to bind.
        ..SessionOptions::default()
    };
    let session = Session::new_with_opts(dir, opts)
        .await
        .map_err(|e| format!("librqbit session init: {e}"))?;
    let api = Api::new(session.clone(), None);
    *guard = Some(EngineInner {
        session,
        api,
        handles: HashMap::new(),
    });
    Ok(())
}

#[derive(Serialize)]
pub struct TorrentStartResult {
    pub stream_url: String,
    pub info_hash: String,
    pub file_idx: usize,
}

#[tauri::command]
pub async fn torrent_start(
    app: AppHandle,
    engine: State<'_, TorrentEngine>,
    info_hash: String,
    file_idx: Option<u32>,
) -> Result<TorrentStartResult, String> {
    let t0 = std::time::Instant::now();
    tlog!(
        "torrent_start ENTER info_hash={} file_idx={:?}",
        info_hash.trim().to_lowercase(),
        file_idx
    );
    ensure_session(&app, &engine).await?;
    tlog!(
        "torrent_start session ready ({} ms)",
        t0.elapsed().as_millis()
    );

    let normalized_hash = info_hash.trim().to_lowercase();
    if normalized_hash.len() != 40 {
        tlog!(
            "torrent_start EXIT err: bad info_hash len {} ({} ms)",
            normalized_hash.len(),
            t0.elapsed().as_millis()
        );
        return Err(format!(
            "info_hash must be 40 hex chars, got {} chars",
            normalized_hash.len()
        ));
    }

    let magnet = magnet_with_trackers(&normalized_hash);
    let only_files = file_idx.map(|i| vec![i as usize]);

    let mut guard = engine.inner.lock().await;
    let inner = guard
        .as_mut()
        .ok_or_else(|| "engine not initialized".to_string())?;

    tlog!(
        "torrent_start add_torrent begin (blocks on magnet→metadata) ({} ms)",
        t0.elapsed().as_millis()
    );
    let resp = inner
        .session
        .add_torrent(
            AddTorrent::from_url(&magnet),
            Some(AddTorrentOptions {
                only_files,
                overwrite: true,
                ..Default::default()
            }),
        )
        .await
        .map_err(|e| {
            tlog!(
                "torrent_start EXIT err: add_torrent: {e} ({} ms)",
                t0.elapsed().as_millis()
            );
            format!("add_torrent: {e}")
        })?;
    tlog!(
        "torrent_start add_torrent returned ({} ms)",
        t0.elapsed().as_millis()
    );

    let handle: Arc<ManagedTorrent> = match resp {
        AddTorrentResponse::Added(_, h) | AddTorrentResponse::AlreadyManaged(_, h) => h,
        AddTorrentResponse::ListOnly(_) => {
            tlog!(
                "torrent_start EXIT err: list-only response ({} ms)",
                t0.elapsed().as_millis()
            );
            return Err("librqbit returned list-only response".into());
        }
    };

    inner.handles.insert(normalized_hash.clone(), handle);
    drop(guard);

    let chosen_idx = file_idx.unwrap_or(0) as usize;
    let stream_url = format!("torrent-stream://localhost/{normalized_hash}/{chosen_idx}");
    tlog!(
        "torrent_start EXIT ok stream_url={} ({} ms)",
        stream_url,
        t0.elapsed().as_millis()
    );
    Ok(TorrentStartResult {
        stream_url,
        info_hash: normalized_hash,
        file_idx: chosen_idx,
    })
}

#[derive(Serialize, Default)]
pub struct TorrentStatus {
    pub downloaded_bytes: u64,
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
    /// Bytes per second (live download). Zero when paused or finished.
    pub download_rate_bps: u64,
    pub state: String,
    pub finished: bool,
    pub error: Option<String>,
    pub active: bool,
    /// Peers currently exchanging data with us.
    pub peers_live: u32,
    /// Peers we've seen in the swarm (via tracker/DHT) — closest analogue to
    /// "seeders + leechers" surfaced in mainstream torrent clients.
    pub peers_seen: u32,
    /// Peers we're mid-handshake with.
    pub peers_connecting: u32,
}

#[tauri::command]
pub async fn torrent_status(
    engine: State<'_, TorrentEngine>,
    info_hash: String,
) -> Result<TorrentStatus, String> {
    let hash = info_hash.trim().to_lowercase();
    let guard = engine.inner.lock().await;
    let Some(inner) = guard.as_ref() else {
        return Ok(TorrentStatus::default());
    };
    let Some(_handle) = inner.handles.get(&hash) else {
        return Ok(TorrentStatus::default());
    };
    let id = TorrentIdOrHash::parse(&hash).map_err(|e| format!("bad info_hash: {e}"))?;
    let stats = inner
        .api
        .api_stats_v1(id)
        .map_err(|e| format!("stats: {e}"))?;
    let (peers_live, peers_seen, peers_connecting, uploaded_bytes) = stats
        .live
        .as_ref()
        .map(|l| {
            let ps = &l.snapshot.peer_stats;
            (
                ps.live as u32,
                ps.seen as u32,
                ps.connecting as u32,
                l.snapshot.uploaded_bytes,
            )
        })
        .unwrap_or((0, 0, 0, 0));
    Ok(TorrentStatus {
        downloaded_bytes: stats.progress_bytes,
        uploaded_bytes,
        total_bytes: stats.total_bytes,
        download_rate_bps: stats
            .live
            .as_ref()
            .map(|l| (l.download_speed.mbps * 1024.0 * 1024.0 / 8.0) as u64)
            .unwrap_or(0),
        state: format!("{:?}", stats.state),
        finished: stats.finished,
        error: stats.error,
        active: true,
        peers_live,
        peers_seen,
        peers_connecting,
    })
}

#[tauri::command]
pub async fn torrent_stop(
    engine: State<'_, TorrentEngine>,
    info_hash: String,
) -> Result<(), String> {
    // Drop the torrent from the active session but KEEP the downloaded
    // chunks on disk (`with_files: false`). This way the user switching
    // streams and coming back doesn't re-download the same first 100MB —
    // librqbit reuses the cached pieces on the next add_torrent. Files
    // for sources the user never returns to leak to disk until app
    // restart; that's an acceptable tradeoff for the dramatic UX win.
    let t0 = std::time::Instant::now();
    let hash = info_hash.trim().to_lowercase();
    tlog!("torrent_stop ENTER hash={}", hash);
    let mut guard = engine.inner.lock().await;
    let Some(inner) = guard.as_mut() else {
        tlog!(
            "torrent_stop EXIT (no engine) ({} ms)",
            t0.elapsed().as_millis()
        );
        return Ok(());
    };
    let removed = inner.handles.remove(&hash).is_some();
    if removed {
        if let Ok(id) = TorrentIdOrHash::parse(&hash) {
            let _ = inner.session.delete(id, false).await;
        }
    }
    tlog!(
        "torrent_stop EXIT hash={} removed={} ({} ms)",
        hash,
        removed,
        t0.elapsed().as_millis()
    );
    Ok(())
}

#[tauri::command]
pub async fn torrent_stop_all(engine: State<'_, TorrentEngine>) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let mut guard = engine.inner.lock().await;
    let Some(inner) = guard.as_mut() else {
        return Ok(());
    };
    let drained: Vec<String> = inner.handles.keys().cloned().collect();
    tlog!("torrent_stop_all ENTER count={}", drained.len());
    for hash in &drained {
        inner.handles.remove(hash);
        if let Ok(id) = TorrentIdOrHash::parse(hash) {
            let _ = inner.session.delete(id, true).await;
        }
    }
    tlog!(
        "torrent_stop_all EXIT count={} ({} ms)",
        drained.len(),
        t0.elapsed().as_millis()
    );
    Ok(())
}

/// Used by the Cleanup feature to clear the stream cache safely. Stops every
/// active torrent (deleting its files via librqbit), then DROPS the in-memory
/// `Session` so its open file handles on `torrents/` are released — letting the
/// caller move the directory to the Trash without racing librqbit I/O. We hold
/// the engine mutex across the whole sequence so no concurrent `torrent_start`
/// or stream read can re-init the session mid-clear. The directory is NOT
/// recreated here: the next `torrent_start → ensure_session` re-creates it and
/// a fresh session lazily (a cold start, ~10s). Returns the `torrents/` path.
pub async fn shutdown_session_for_clear(
    app: &AppHandle,
    engine: &TorrentEngine,
) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("torrents");
    let mut guard = engine.inner.lock().await;
    if let Some(inner) = guard.as_mut() {
        let drained: Vec<String> = inner.handles.keys().cloned().collect();
        tlog!(
            "shutdown_session_for_clear stopping {} torrent(s)",
            drained.len()
        );
        for hash in &drained {
            inner.handles.remove(hash);
            if let Ok(id) = TorrentIdOrHash::parse(hash) {
                let _ = inner.session.delete(id, true).await;
            }
        }
    }
    // Drop the whole EngineInner (and its Arc<Session>) so file handles on
    // `torrents/` are released before the caller trashes the directory.
    let _ = guard.take();
    drop(guard);
    Ok(dir)
}

// ---- Custom URI scheme: torrent-stream://localhost/{info_hash}/{file_idx} ----
//
// WebKit's <video> element triggers Range requests on this scheme; we read
// the requested range out of librqbit's FileStream and respond inline. Same
// chunked-response pattern as wt-proxy:// — we cap each response at
// STREAM_CHUNK_BYTES so the renderer drives streaming via follow-up ranges
// rather than us buffering whole files.

fn respond_error(responder: tauri::UriSchemeResponder, status: u16, msg: &str) {
    let body = msg.as_bytes().to_vec();
    if let Ok(response) = tauri::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Type", "text/plain")
        .body(body)
    {
        responder.respond(response);
    }
}

fn parse_path(path: &str) -> Option<(String, usize)> {
    // Expected shape: "/{info_hash}/{file_idx}" (info_hash = 40 hex chars).
    let trimmed = path.trim_start_matches('/');
    let mut parts = trimmed.splitn(2, '/');
    let hash = parts.next()?.to_lowercase();
    let idx = parts.next()?.parse::<usize>().ok()?;
    if hash.len() != 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some((hash, idx))
}

fn parse_range(range_header: Option<&str>, total: u64) -> (u64, u64) {
    // Return (start, end_inclusive) capped to STREAM_CHUNK_BYTES.
    let cap_end = |start: u64, requested_end: Option<u64>| -> u64 {
        let chunk_end = start.saturating_add(STREAM_CHUNK_BYTES - 1);
        let upper = total.saturating_sub(1);
        let mut end = chunk_end.min(upper);
        if let Some(req) = requested_end {
            end = end.min(req);
        }
        end
    };
    let Some(raw) = range_header else {
        return (0, cap_end(0, None));
    };
    let bytes_part = raw.strip_prefix("bytes=").unwrap_or(raw);
    let Some((s, e)) = bytes_part.split_once('-') else {
        return (0, cap_end(0, None));
    };
    let start: u64 = s.trim().parse().unwrap_or(0);
    let end_opt: Option<u64> = e.trim().parse().ok();
    (start, cap_end(start, end_opt))
}

/// One served byte-range: the body plus everything needed to build the
/// response headers. Used by the WebKit custom-scheme handler (native <video>
/// fallback). The libmpv HTTP server no longer uses this — it streams the full
/// range continuously via `StreamBody` instead of buffering a capped chunk.
struct RangeChunk {
    status: u16,
    start: u64,
    actual_end: u64,
    total: u64,
    body: Vec<u8>,
}

/// Read the requested byte range out of librqbit's FileStream. `Err` carries
/// an (http_status, message) pair the callers turn into an error response.
async fn read_range(
    app: &AppHandle,
    hash: &str,
    file_idx: usize,
    range_header: Option<&str>,
) -> Result<RangeChunk, (u16, String)> {
    let engine = app.state::<TorrentEngine>();
    let guard = engine.inner.lock().await;
    let inner = guard
        .as_ref()
        .ok_or((503u16, "engine not initialized".to_string()))?;
    if !inner.handles.contains_key(hash) {
        return Err((404, "torrent not active".to_string()));
    }
    let api = inner.api.clone();
    drop(guard);

    let id = TorrentIdOrHash::parse(hash).map_err(|e| (400u16, format!("bad info_hash: {e}")))?;
    // On a cold add, librqbit re-checks the on-disk data and sits in an
    // "initializing" state for several seconds; `api_stream` returns
    // "invalid state: initializing" during that window. Returning 500 makes
    // mpv choke on its first request and stall forever. Instead, poll until
    // the torrent is ready (or time out) so the request simply blocks like a
    // normal slow-start — mpv then gets its bytes once init completes.
    let init_t0 = std::time::Instant::now();
    let mut attempts: u32 = 0;
    let mut stream = {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            attempts += 1;
            match api.api_stream(id, file_idx).await {
                Ok(s) => {
                    if attempts > 1 {
                        tlog!(
                            "api_stream ok after {} attempts ({} ms init wait) hash={} idx={}",
                            attempts,
                            init_t0.elapsed().as_millis(),
                            hash,
                            file_idx
                        );
                    }
                    break s;
                }
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("initializing") && std::time::Instant::now() < deadline {
                        // Log first retry + every ~2s so the terminal shows the
                        // torrent is stuck "initializing", not silently hung.
                        if attempts == 1 || attempts % 7 == 0 {
                            tlog!(
                                "api_stream retry (initializing) attempt={} ({} ms) hash={} idx={}",
                                attempts,
                                init_t0.elapsed().as_millis(),
                                hash,
                                file_idx
                            );
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        continue;
                    }
                    tlog!(
                        "api_stream ERROR attempt={} ({} ms): {msg} hash={} idx={}",
                        attempts,
                        init_t0.elapsed().as_millis(),
                        hash,
                        file_idx
                    );
                    return Err((500, format!("api_stream: {msg}")));
                }
            }
        }
    };
    let _ = (init_t0, attempts); // retry timing already logged above
    let total = stream.len();
    let (start, end) = parse_range(range_header, total);
    let len = end.saturating_sub(start).saturating_add(1);

    // Distinct ENTER marker: logged the instant we know the intended byte span,
    // BEFORE the (possibly blocking) seek+read. If a request hangs on librqbit
    // IO, you'll see this line with no matching `http ->` response — that's the
    // signature of a read that blocked on un-downloaded bytes (issue #2).
    tlog!(
        "read_range serving {}-{} (len {}) of {} hash={} idx={} range_hdr={}",
        start,
        end,
        len,
        total,
        hash,
        file_idx,
        range_header.unwrap_or("(none→full)")
    );

    stream
        .seek(SeekFrom::Start(start))
        .await
        .map_err(|e| (500u16, format!("seek: {e}")))?;

    // Time the actual range read — a long read here (vs. the init wait above)
    // means the bytes for this offset aren't downloaded yet (relevant when a
    // seek jumps to an un-downloaded region — issue #2).
    let read_t0 = std::time::Instant::now();
    let mut buf = vec![0u8; len as usize];
    let mut filled = 0usize;
    while filled < buf.len() {
        match stream.read(&mut buf[filled..]).await {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) => {
                tlog!("read ERROR at {}+{}: {e} hash={}", start, filled, hash);
                return Err((500, format!("read: {e}")));
            }
        }
    }
    buf.truncate(filled);
    let read_ms = read_t0.elapsed().as_millis();
    if read_ms > 500 {
        tlog!(
            "read SLOW {} ms for {} bytes at offset {} hash={} (waited on swarm for this range)",
            read_ms,
            filled,
            start,
            hash
        );
    }

    Ok(RangeChunk {
        status: if range_header.is_some() { 206 } else { 200 },
        start,
        actual_end: start + filled.saturating_sub(1) as u64,
        total,
        body: buf,
    })
}

pub async fn stream_handle_request(
    app: AppHandle,
    uri: tauri::http::Uri,
    headers: tauri::http::HeaderMap,
    responder: tauri::UriSchemeResponder,
) {
    let Some((hash, file_idx)) = parse_path(uri.path()) else {
        respond_error(responder, 400, "bad torrent-stream path");
        return;
    };
    let range_header = headers.get("range").and_then(|v| v.to_str().ok());
    match read_range(&app, &hash, file_idx, range_header).await {
        Ok(chunk) => {
            let mut builder = tauri::http::Response::builder()
                .status(chunk.status)
                .header("Content-Type", "video/mp4")
                .header("Accept-Ranges", "bytes")
                .header("Content-Length", chunk.body.len().to_string())
                .header("Access-Control-Allow-Origin", "*");
            if chunk.status == 206 {
                builder = builder.header(
                    "Content-Range",
                    format!("bytes {}-{}/{}", chunk.start, chunk.actual_end, chunk.total),
                );
            }
            match builder.body(chunk.body) {
                Ok(response) => responder.respond(response),
                Err(e) => respond_error(responder, 500, &format!("build: {e}")),
            }
        }
        Err((status, msg)) => respond_error(responder, status, &msg),
    }
}

// ---- Local HTTP streaming server (for libmpv) ----
//
// libmpv has its own network stack and can't fetch the `torrent-stream://`
// custom WebKit scheme, so the Movies player on macOS streams from this plain
// HTTP server instead. Same path shape as the scheme (`/{info_hash}/{idx}`)
// and the same range-reading core, so the frontend just swaps the URL prefix.
// Bound to 127.0.0.1 on an ephemeral port; never exposed beyond localhost.

/// Base URL of the streaming server, e.g. `http://127.0.0.1:54321`. Empty
/// until the server has bound. The frontend rewrites a torrent-stream:// URL's
/// prefix to this on the mpv path.
#[tauri::command]
pub fn torrent_http_base(engine: State<'_, TorrentEngine>) -> String {
    let port = engine.http_port.load(Ordering::Relaxed);
    if port == 0 {
        String::new()
    } else {
        format!(
            "http://127.0.0.1:{port}/{}",
            crate::security::loopback_token()
        )
    }
}

/// Bind the streaming server and spawn its accept loop. Returns the bound
/// port so the caller can record it in `TorrentEngine::http_port`.
pub fn start_http_server(app: AppHandle) -> std::io::Result<u16> {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            let app = app.clone();
            // One thread per request: range reads block on librqbit IO, and
            // a media player may have a couple of ranges in flight at once.
            crate::security::spawn_media_request(request, move |request| {
                handle_http_request(app, request)
            });
        }
    });
    Ok(port)
}

/// Parse a Range header into an inclusive `(start, end)` WITHOUT the 4 MB cap.
/// The streaming server serves the entire requested span over one persistent
/// connection (`bytes=N-` → `N..=EOF`). The old cap is exactly what made mpv
/// read a single chunk, go idle, and stall a few seconds in (issues #1/#2).
fn parse_range_full(range_header: Option<&str>, total: u64) -> (u64, u64) {
    let upper = total.saturating_sub(1);
    let Some(raw) = range_header else {
        return (0, upper);
    };
    let bytes_part = raw.strip_prefix("bytes=").unwrap_or(raw);
    let Some((s, e)) = bytes_part.split_once('-') else {
        return (0, upper);
    };
    let start = s.trim().parse::<u64>().unwrap_or(0).min(upper);
    let end = e
        .trim()
        .parse::<u64>()
        .ok()
        .map(|x| x.min(upper))
        .unwrap_or(upper);
    (start, end.max(start))
}

/// Blocking `Read` adapter that streams a librqbit async FileStream onto a
/// tiny_http response. Each `read` drives one async read to completion on the
/// Tauri runtime — we're on a plain tiny_http worker thread (never inside the
/// runtime), so `block_on` is safe and sequential. librqbit's read blocks
/// until the requested bytes have downloaded, so this feeds the socket
/// continuously as data arrives. That continuous delivery is the whole fix:
/// mpv reads straight through instead of getting one 4 MB chunk + EOF.
struct StreamBody<S> {
    stream: S,
    remaining: u64,
    served: Arc<AtomicU64>,
}

impl<S: tokio::io::AsyncRead + Unpin> std::io::Read for StreamBody<S> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.remaining == 0 {
            return Ok(0);
        }
        let cap = (buf.len() as u64).min(self.remaining) as usize;
        let n = tauri::async_runtime::block_on(self.stream.read(&mut buf[..cap]))?;
        if n == 0 {
            self.remaining = 0;
            return Ok(0);
        }
        self.remaining -= n as u64;
        self.served.fetch_add(n as u64, Ordering::Relaxed);
        Ok(n)
    }
}

fn handle_http_request(app: AppHandle, request: tiny_http::Request) {
    let Some(authorized) = crate::security::authorized_loopback_path(request.url()) else {
        let _ = request.respond(tiny_http::Response::empty(403));
        return;
    };
    let path = format!("/{}", authorized.split('?').next().unwrap_or(""));
    let Some((hash, file_idx)) = parse_path(&path) else {
        let _ = request.respond(
            tiny_http::Response::from_string("bad torrent-stream path").with_status_code(400),
        );
        return;
    };
    let range_header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());
    let is_head = request.method() == &tiny_http::Method::Head;

    let t0 = std::time::Instant::now();
    let method = request.method().as_str().to_string();
    tlog!(
        "http {} {} range={}",
        method,
        path,
        range_header.as_deref().unwrap_or("(none)"),
    );

    // Open the file stream (waiting out librqbit's "initializing" window), then
    // STREAM the whole requested range over this one persistent connection.
    let opened = tauri::async_runtime::block_on(async {
        let engine = app.state::<TorrentEngine>();
        let api = {
            let guard = engine.inner.lock().await;
            let inner = guard
                .as_ref()
                .ok_or((503u16, "engine not initialized".to_string()))?;
            if !inner.handles.contains_key(&hash) {
                return Err((404u16, "torrent not active".to_string()));
            }
            inner.api.clone()
        };
        let id =
            TorrentIdOrHash::parse(&hash).map_err(|e| (400u16, format!("bad info_hash: {e}")))?;
        let init_t0 = std::time::Instant::now();
        let deadline = init_t0 + std::time::Duration::from_secs(60);
        let mut attempts = 0u32;
        let stream = loop {
            attempts += 1;
            match api.api_stream(id, file_idx).await {
                Ok(s) => {
                    if attempts > 1 {
                        tlog!(
                            "api_stream ok after {} attempts ({} ms) hash={} idx={}",
                            attempts,
                            init_t0.elapsed().as_millis(),
                            hash,
                            file_idx
                        );
                    }
                    break s;
                }
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("initializing") && std::time::Instant::now() < deadline {
                        if attempts == 1 || attempts % 7 == 0 {
                            tlog!(
                                "api_stream retry (initializing) attempt={} ({} ms) hash={} idx={}",
                                attempts,
                                init_t0.elapsed().as_millis(),
                                hash,
                                file_idx
                            );
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        continue;
                    }
                    return Err((500u16, format!("api_stream: {msg}")));
                }
            }
        };
        let total = stream.len();
        Ok::<_, (u16, String)>((stream, total))
    });

    let (mut stream, total) = match opened {
        Ok(v) => v,
        Err((status, msg)) => {
            tlog!(
                "http -> ERROR {status} {msg} ({} ms)",
                t0.elapsed().as_millis()
            );
            let _ = request.respond(tiny_http::Response::from_string(msg).with_status_code(status));
            return;
        }
    };

    let (start, end) = parse_range_full(range_header.as_deref(), total);
    let len = end.saturating_sub(start).saturating_add(1);

    // Seek to the start offset (blocks only if that offset isn't downloaded).
    if let Err(e) = tauri::async_runtime::block_on(stream.seek(SeekFrom::Start(start))) {
        tlog!("http -> ERROR seek: {e} ({} ms)", t0.elapsed().as_millis());
        let _ = request
            .respond(tiny_http::Response::from_string(format!("seek: {e}")).with_status_code(500));
        return;
    }

    tlog!(
        "http -> 206 streaming {}-{}/{} (len {}, opened {} ms){}",
        start,
        end,
        total,
        len,
        t0.elapsed().as_millis(),
        if range_header.is_none() {
            " [no-range hdr → full file]"
        } else {
            ""
        }
    );

    // Headers. We deliberately force Identity (Content-Length) encoding below:
    // tiny_http switches to chunked for bodies ≥32 KB, and a length-less
    // chunked response reads as a NON-seekable stream to mpv.
    let mut headers: Vec<tiny_http::Header> = Vec::new();
    for (k, v) in [
        ("Content-Type", "video/mp4".to_string()),
        ("Accept-Ranges", "bytes".to_string()),
        ("Access-Control-Allow-Origin", "*".to_string()),
        ("Content-Range", format!("bytes {start}-{end}/{total}")),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            headers.push(h);
        }
    }

    if is_head {
        // Headers only — advertise size + seekability, no body.
        let mut response = tiny_http::Response::empty(tiny_http::StatusCode(206))
            .with_chunked_threshold(usize::MAX);
        for h in headers {
            response.add_header(h);
        }
        // Setting Content-Length updates the response's data_length; the body
        // stays empty (io::empty), which is correct for a HEAD reply.
        if let Ok(h) =
            tiny_http::Header::from_bytes("Content-Length".as_bytes(), len.to_string().as_bytes())
        {
            response.add_header(h);
        }
        let _ = request.respond(response);
        return;
    }

    let served = Arc::new(AtomicU64::new(0));
    let body = StreamBody {
        stream,
        remaining: len,
        served: served.clone(),
    };
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(206),
        headers,
        body,
        Some(len as usize),
        None,
    )
    .with_chunked_threshold(usize::MAX);

    // respond() blocks here, pulling from StreamBody and writing to the socket
    // as bytes download, until the full range is sent OR mpv drops the socket
    // (it sought and opened a fresh connection — expected, not an error).
    if let Err(e) = request.respond(response) {
        tlog!(
            "http client DROPPED mid-stream hash={} after {}/{} bytes ({} ms): {e}",
            hash,
            served.load(Ordering::Relaxed),
            len,
            t0.elapsed().as_millis()
        );
    } else {
        tlog!(
            "http stream COMPLETE hash={} served {} bytes ({}-{}/{}) ({} ms)",
            hash,
            served.load(Ordering::Relaxed),
            start,
            end,
            total,
            t0.elapsed().as_millis()
        );
    }
}
