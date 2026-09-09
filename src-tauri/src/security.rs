//! Boundaries shared by the desktop commands. Keep untrusted content out of
//! native file, process and network privileges.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

pub fn check_file_scope(app: &tauri::AppHandle, raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute() || raw.chars().any(char::is_control) {
        return Err("Choose an absolute file path using the file picker".into());
    }
    let canonical = if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        path.parent()
            .ok_or("Missing parent directory")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(path.file_name().ok_or("Missing filename")?)
    };
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    let cache = cache.canonicalize().map_err(|e| e.to_string())?;
    if canonical.starts_with(cache) || app.fs_scope().is_allowed(&canonical) {
        Ok(canonical)
    } else {
        Err("Access denied. Select this file or folder with the native file picker first.".into())
    }
}

fn valid_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn get_or_create_key(path: &Path) -> Result<String, String> {
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Encryption key must be a regular file".into());
        }
        let mut key = String::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(66)
            .read_to_string(&mut key)
            .map_err(|e| e.to_string())?;
        let key = key.trim();
        if !valid_key(key) {
            return Err("Malformed encryption key; restore it from a backup".into());
        }
        return Ok(key.into());
    }
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("Create encryption key: {e}"))?;
    file.write_all(key.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// A per-process bearer capability for loopback media servers. Local web
/// pages cannot discover it by scanning ports or rebinding a hostname.
pub fn loopback_token() -> &'static str {
    static TOKEN: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    TOKEN.get_or_init(|| {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
}

pub fn authorized_loopback_path(raw: &str) -> Option<&str> {
    raw.strip_prefix('/')?
        .strip_prefix(loopback_token())?
        .strip_prefix('/')
}

pub async fn confirm_cleanup(app: &tauri::AppHandle, description: String) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(description)
        .title("Confirm cleanup")
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |accepted| {
            let _ = tx.send(accepted);
        });
    if rx.await.unwrap_or(false) {
        Ok(())
    } else {
        Err("Cleanup canceled".into())
    }
}

pub fn spawn_media_request<F: FnOnce(tiny_http::Request) + Send + 'static>(
    request: tiny_http::Request,
    handler: F,
) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static ACTIVE: AtomicUsize = AtomicUsize::new(0);
    if authorized_loopback_path(request.url()).is_none() {
        let _ = request.respond(tiny_http::Response::empty(403));
        return;
    }
    if ACTIVE.fetch_add(1, Ordering::AcqRel) >= 16 {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
        let _ = request.respond(tiny_http::Response::empty(503));
        return;
    }
    std::thread::spawn(move || {
        struct Guard;
        impl Drop for Guard {
            fn drop(&mut self) {
                ACTIVE.fetch_sub(1, Ordering::AcqRel);
            }
        }
        let _guard = Guard;
        handler(request);
    });
}

fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && a != 0
                && a < 240
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (18..=19).contains(&b))
        }
        std::net::IpAddr::V6(ip) => {
            // Global unicast only; reject mapped IPv4 and documentation ranges.
            (ip.segments()[0] & 0xe000) == 0x2000
                && !(ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
        }
    }
}

/// Resolve and pin every destination, including redirects. Reject private
/// networks even if a hostname changes its DNS answer after validation.
pub async fn public_request(
    method: reqwest::Method,
    target: &str,
    headers: reqwest::header::HeaderMap,
) -> Result<reqwest::Response, String> {
    let mut url = reqwest::Url::parse(target).map_err(|_| "Invalid stream URL")?;
    for _ in 0..6 {
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(
                "Only public HTTP(S) streams without embedded credentials are supported".into(),
            );
        }
        let host = url.host_str().ok_or("Missing stream host")?;
        let port = url.port_or_known_default().ok_or("Missing stream port")?;
        let addresses: Vec<_> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| "Stream host lookup failed")?
            .collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            return Err("Private and reserved network destinations are blocked".into());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(30))
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| "Stream client initialization failed")?;
        let response = client
            .request(method.clone(), url.clone())
            .headers(headers.clone())
            .send()
            .await
            .map_err(|_| "Stream request failed")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Invalid stream redirect")?;
            url = url
                .join(location)
                .map_err(|_| "Invalid stream redirect URL")?;
        } else {
            return Ok(response);
        }
    }
    Err("Too many stream redirects".into())
}

/// Bind before opening a privileged webview. If the fixed embed origin is
/// occupied, startup fails rather than navigating to another local process.
pub fn frontend_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("mosaic-frontend")
        .setup(|app, _| {
            #[cfg(not(debug_assertions))]
            {
                let server = tiny_http::Server::http("127.0.0.1:38947")
                    .map_err(|e| std::io::Error::other(e.to_string()))?;
                let resolver = app.asset_resolver();
                std::thread::spawn(move || {
                    for request in server.incoming_requests() {
                        let valid_host = request.headers().iter().any(|h| {
                            h.field.equiv("Host")
                                && matches!(h.value.as_str(), "localhost:38947" | "127.0.0.1:38947")
                        });
                        if !valid_host
                            || !matches!(
                                request.method(),
                                tiny_http::Method::Get | tiny_http::Method::Head
                            )
                        {
                            let _ = request.respond(tiny_http::Response::empty(403));
                            continue;
                        }
                        let path = request.url().split('?').next().unwrap_or("/").to_string();
                        if let Some(asset) = resolver.get(path) {
                            let mut response = tiny_http::Response::from_data(asset.bytes);
                            for (key, value) in [
                                ("Content-Type", asset.mime_type),
                                (
                                    "Content-Security-Policy",
                                    asset.csp_header.unwrap_or_default(),
                                ),
                                ("Cache-Control", "no-store".into()),
                                ("X-Content-Type-Options", "nosniff".into()),
                                ("Referrer-Policy", "strict-origin-when-cross-origin".into()),
                            ] {
                                if let Ok(header) = tiny_http::Header::from_bytes(key, value) {
                                    response.add_header(header);
                                }
                            }
                            let _ = request.respond(response);
                        } else {
                            let _ = request.respond(tiny_http::Response::empty(404));
                        }
                    }
                });
            }
            #[cfg(debug_assertions)]
            let _ = app;
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_require_exactly_32_hex_bytes() {
        assert!(valid_key(&"a4".repeat(32)));
        assert!(!valid_key(&"z".repeat(64)));
        assert!(!valid_key(&"a".repeat(63)));
    }
    #[test]
    fn loopback_urls_require_unpredictable_token_and_separator() {
        assert_eq!(
            authorized_loopback_path(&format!("/{}/media", loopback_token())),
            Some("media")
        );
        assert_eq!(authorized_loopback_path("/media"), None);
        assert_eq!(
            authorized_loopback_path(&format!("/{}suffix/media", loopback_token())),
            None
        );
    }
    #[test]
    fn stream_destinations_reject_private_reserved_and_mapped_ips() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.1.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "::ffff:127.0.0.1",
            "fd00::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn key_is_persistent_and_owner_only() {
        let dir = std::env::temp_dir().join(format!("mosaic-key-test-{}", rand::random::<u64>()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("key");
        let first = get_or_create_key(&path).unwrap();
        assert!(valid_key(&first));
        assert_eq!(get_or_create_key(&path).unwrap(), first);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
