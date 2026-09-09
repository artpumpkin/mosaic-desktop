use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// Port for the embedded localhost HTTP server. Production builds serve the
// frontend from `http://localhost:LOCALHOST_PORT/` instead of the default
// `tauri://localhost`. This is what unblocks third-party embeds like
// YouTube — their iframes refuse to play under non-HTTP(S) parent
// origins ("Error 153 - Video player configuration error").
// Chosen in the IANA registered-port range to avoid common conflicts.

mod audio;
mod backup;
mod cleanup;
mod macos_audio;
mod media;
mod media_guard;
mod radio_proxy;
mod security;
mod tools;
mod torrent;

const KEY_FILENAME: &str = "encryption.key";

#[tauri::command]
fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let path = security::check_file_scope(&app, &path)?;
    use std::io::Read;
    let mut text = String::new();
    std::fs::File::open(&path)
        .map_err(|e| e.to_string())?
        .take(16 * 1024 * 1024 + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() > 16 * 1024 * 1024 {
        return Err("File exceeds 16 MiB".into());
    }
    Ok(text)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TurnIceServer {
    urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    credential: Option<String>,
}

// Runtime configuration is local to the person running the app. No provider
// management credential is ever embedded in the distributed binary.
#[tauri::command]
async fn mint_turn_credentials() -> Result<Vec<TurnIceServer>, String> {
    let raw = std::env::var("MOSAIC_ICE_SERVERS_JSON").map_err(|_| {
        "No personal TURN configuration. Using public STUN/TURN fallback.".to_string()
    })?;
    if raw.len() > 16384 {
        return Err("TURN configuration too large".into());
    }
    let servers: Vec<TurnIceServer> =
        serde_json::from_str(&raw).map_err(|_| "Invalid ICE server JSON".to_string())?;
    if servers.len() > 8
        || servers.iter().any(|s| {
            s.urls.is_empty()
                || s.urls.len() > 8
                || s.urls.iter().any(|u| {
                    u.chars().any(char::is_control)
                        || !["stun:", "stuns:", "turn:", "turns:"]
                            .iter()
                            .any(|p| u.starts_with(p))
                })
        })
    {
        return Err("Invalid ICE server URLs".into());
    }
    Ok(servers)
}

#[tauri::command]
fn write_text_file(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    let path = security::check_file_scope(&app, &path)?;
    if contents.len() > 16 * 1024 * 1024 {
        return Err("File exceeds 16 MiB".into());
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_or_create_enc_key(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    security::get_or_create_key(&dir.join(KEY_FILENAME))
}

fn build_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/0000_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "app settings",
            sql: include_str!("../migrations/0001_app_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "health tables",
            sql: include_str!("../migrations/0002_health.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "assets",
            sql: include_str!("../migrations/0003_assets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "fasting sessions",
            sql: include_str!("../migrations/0004_fasting.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "drop calorie entries",
            sql: include_str!("../migrations/0005_drop_calorie_entries.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "rentals",
            sql: include_str!("../migrations/0006_rentals.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Some existing installs end up with `_sqlx_migrations` checksums that no
/// longer match what this binary embeds — e.g. when an older build wrote a
/// different byte representation of the same SQL (CRLF vs LF, encoding
/// quirks from a previous compiler). sqlx-migrate then refuses to open the
/// DB with "migration N was previously applied but has been modified",
/// which surfaces in the UI as every page stuck on a skeleton.
///
/// Recompute the sha384 checksum of each migration's SQL exactly as sqlx
/// does and UPDATE the row in-place. The actual tables/data are untouched —
/// we only realign the bookkeeping. Idempotent and safe to run every launch.
fn proxy_respond_error(responder: tauri::UriSchemeResponder, status: u16, msg: &str) {
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

// Hard cap on how much the proxy will buffer for any single request.
// Tauri's UriSchemeResponder takes a complete byte vec — there's no
// streaming — so any open-ended `Range: bytes=N-` from the <video>
// element would otherwise force us to hold the entire file in RAM
// before responding. Capping at 4MB lets WebKit start playback off the
// first chunk and issue follow-up range requests for subsequent media.
const PROXY_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

// Tighten the incoming Range so we never buffer more than the cap. If
// the caller already specified an explicit upper bound smaller than the
// cap, leave it alone — that's the natural cadence of WebKit's media
// pipeline and shouldn't be disturbed.
fn cap_range_header(raw: &str) -> String {
    let bytes_part = raw.strip_prefix("bytes=").unwrap_or(raw);
    // Only handle a single byte-range (the only form WebKit's <video> uses).
    if let Some((start_str, end_str)) = bytes_part.split_once('-') {
        let start: u64 = start_str.trim().parse().unwrap_or(0);
        let cap_end = start.saturating_add(PROXY_CHUNK_BYTES - 1);
        if end_str.trim().is_empty() {
            return format!("bytes={start}-{cap_end}");
        }
        let end: u64 = end_str.trim().parse().unwrap_or(u64::MAX);
        if end > cap_end {
            return format!("bytes={start}-{cap_end}");
        }
    }
    raw.to_string()
}

fn decode_proxy_target(path: &str) -> Option<String> {
    // path is like "/<urlencoded-url>" — strip the leading '/' and
    // percent-decode. We don't require the URL to be safe in any
    // particular way; reqwest will reject malformed targets when
    // sending. Reject if the decoded URL doesn't start with http(s).
    let encoded = path.trim_start_matches('/');
    if encoded.is_empty() {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let s = decoded.into_owned();
    if !(s.starts_with("http://") || s.starts_with("https://")) {
        return None;
    }
    Some(s)
}

async fn proxy_handle_request(
    method: tauri::http::Method,
    uri: tauri::http::Uri,
    req_headers: tauri::http::HeaderMap,
    responder: tauri::UriSchemeResponder,
) {
    let target = match decode_proxy_target(uri.path()) {
        Some(t) => t,
        None => {
            eprintln!("[wt-proxy] reject: bad target path {:?}", uri.path());
            proxy_respond_error(responder, 400, "bad proxy target");
            return;
        }
    };
    let is_head = method == tauri::http::Method::HEAD;
    if method != tauri::http::Method::GET && !is_head {
        proxy_respond_error(responder, 405, "GET or HEAD required");
        return;
    }
    let incoming_range = req_headers
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let range_to_send = incoming_range
        .as_deref()
        .map(cap_range_header)
        .unwrap_or_else(|| format!("bytes=0-{}", PROXY_CHUNK_BYTES - 1));
    let mut headers = reqwest::header::HeaderMap::new();
    let Ok(range) = range_to_send.parse() else {
        proxy_respond_error(responder, 400, "Invalid range");
        return;
    };
    headers.insert(reqwest::header::RANGE, range);
    let upstream = match security::public_request(method, &target, headers).await {
        Ok(response) => response,
        Err(error) => {
            proxy_respond_error(responder, 502, &error);
            return;
        }
    };
    let status = upstream.status().as_u16();
    eprintln!(
        "[wt-proxy] upstream {status} ct={:?} cr={:?} cl={:?}",
        upstream.headers().get("content-type"),
        upstream.headers().get("content-range"),
        upstream.headers().get("content-length"),
    );
    let mut builder = tauri::http::Response::builder().status(status);
    for (k, v) in upstream.headers() {
        let name = k.as_str();
        if name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("content-encoding")
            || name.eq_ignore_ascii_case("content-security-policy")
        {
            continue;
        }
        builder = builder.header(name, v);
    }
    builder = builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "Range")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        );
    // HEAD must not have a body — WebKit treats a HEAD response with a
    // body as malformed and won't move on to the GET that would actually
    // start playback.
    if is_head {
        match builder.body(Vec::new()) {
            Ok(response) => responder.respond(response),
            Err(e) => proxy_respond_error(responder, 500, &format!("build: {e}")),
        }
        return;
    }
    use futures_util::StreamExt;
    let mut stream = upstream.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            proxy_respond_error(responder, 502, "Stream read failed");
            return;
        };
        if body.len().saturating_add(chunk.len()) > PROXY_CHUNK_BYTES as usize {
            proxy_respond_error(responder, 502, "Upstream ignored bounded range request");
            return;
        }
        body.extend_from_slice(&chunk);
    }
    match builder.body(body) {
        Ok(response) => responder.respond(response),
        Err(e) => proxy_respond_error(responder, 500, &format!("build: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = build_migrations();
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    {
        context.config_mut().app.windows[0].url = tauri::WebviewUrl::External(
            "http://localhost:3100/"
                .parse()
                .expect("constant development URL"),
        );
    }

    tauri::Builder::default()
        .manage(torrent::TorrentEngine::new())
        .manage(radio_proxy::RadioProxy::new())
        .manage(cleanup::CleanupState::default())
        .manage(media::MediaEngine::default())
        .manage(tools::InstallState::default())
        .plugin(security::frontend_plugin())
        // Embedded libmpv video player (macOS), extracted into the
        // standalone tauri-plugin-mpv-player crate. It manages its own
        // MpvHandle state and registers the plugin:mpv|* commands.
        .plugin(tauri_plugin_mpv_player::init())
        // Watch-together media proxy. Some video hosts (pixeldrain, etc.)
        // serve byte-range-able mp4s with CORS allowed, yet WKWebView's
        // <video> element still chokes on them cross-origin — often
        // because the moov atom is at the end of the file and WebKit's
        // cross-origin range-seek strategy is more conservative than
        // its same-origin one. Routing the request through Rust (real
        // reqwest, no WebKit constraints) sidesteps the whole class
        // of issues, and lets us add fixed headers like
        // `Access-Control-Allow-Origin: *` regardless of what the
        // upstream sends. URL format:
        //   wt-proxy://localhost/<urlencoded-target-url>
        .register_asynchronous_uri_scheme_protocol("wt-proxy", |_ctx, request, responder| {
            let method = request.method().clone();
            let uri = request.uri().clone();
            let req_headers = request.headers().clone();
            tauri::async_runtime::spawn(async move {
                proxy_handle_request(method, uri, req_headers, responder).await;
            });
        })
        // Torrent file streaming for the Movies/Series section. The torrent
        // engine lives in our shared TorrentEngine state (see `torrent.rs`);
        // <video src="torrent-stream://localhost/{info_hash}/{file_idx}">
        // triggers a Range request here, we read the requested chunk out of
        // librqbit's FileStream and respond inline.
        .register_asynchronous_uri_scheme_protocol("torrent-stream", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().clone();
            let req_headers = request.headers().clone();
            tauri::async_runtime::spawn(async move {
                torrent::stream_handle_request(app, uri, req_headers, responder).await;
            });
        })
        .setup(|app| {
            // Start the local torrent HTTP streaming server (for libmpv, which
            // can't read the torrent-stream:// scheme) and record its port in
            // the shared engine state. Non-fatal: the native <video> path uses
            // the custom scheme regardless.
            match torrent::start_http_server(app.handle().clone()) {
                Ok(port) => {
                    app.state::<torrent::TorrentEngine>().set_http_port(port);
                    eprintln!("[torrent] http stream server on 127.0.0.1:{port}");
                }
                Err(e) => eprintln!("[torrent] http stream server failed to start: {e}"),
            }
            // Pre-warm the librqbit session (DHT + UPnP) in the background so
            // the first movie doesn't pay the ~10s session-init latency.
            // Start the radio audio proxy (re-serves icecast/shoutcast streams
            // from localhost with CORS headers so the WebView's Web Audio
            // analyser can read the spectrum). Non-fatal: without it radio
            // falls back to direct playback + the simulated visualization.
            match radio_proxy::start_radio_proxy() {
                Ok(port) => {
                    app.state::<radio_proxy::RadioProxy>().set_port(port);
                    eprintln!("[radio] audio proxy on 127.0.0.1:{port}");
                }
                Err(e) => eprintln!("[radio] audio proxy failed to start: {e}"),
            }
            // In dev mode the embedded localhost plugin can't serve
            // content (no bundled assets exist yet), so the hardcoded
            // window URL of `http://localhost:38947/` returns HTTP 500
            // and the user sees a blank window. Override to the
            // Next.js dev server URL on debug builds. Production
            // continues to use the localhost plugin so YouTube
            // iframes' parent-origin check stays happy.
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(
                        "if (window.location.host !== 'localhost:3100') { \
                           window.location.replace('http://localhost:3100/'); \
                         }",
                    );
                }
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:finance.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_or_create_enc_key,
            backup::import_backup,
            read_text_file,
            write_text_file,
            mint_turn_credentials,
            macos_audio::start_macos_system_audio,
            macos_audio::stop_macos_system_audio,
            torrent::torrent_start,
            torrent::torrent_status,
            torrent::torrent_stop,
            torrent::torrent_stop_all,
            torrent::torrent_http_base,
            radio_proxy::radio_proxy_base,
            cleanup::cleanup_scan_app_cache,
            cleanup::cleanup_clear_app_cache,
            cleanup::cleanup_scan_system_junk,
            cleanup::cleanup_clean_system_junk,
            cleanup::cleanup_scan_large_files,
            cleanup::cleanup_scan_duplicates,
            cleanup::cleanup_trash_paths,
            cleanup::cleanup_open_full_disk_access,
            cleanup::cleanup_cancel_scan,
            cleanup::cleanup_reveal,
            media::media_run_job,
            media::media_cancel,
            media::media_reveal,
            media::media_file_size,
            media::media_thumbnail,
            media::media_estimate,
            tools::tools_status,
            tools::tools_install,
            tools::tools_cancel_install,
            tools::tools_uninstall,
            audio::audio_scan_library // mpv commands now live in tauri-plugin-mpv-player (plugin:mpv|*).
        ])
        .run(context)
        .expect("error while running tauri application");
}
