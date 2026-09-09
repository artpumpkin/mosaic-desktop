// Local HTTP proxy for radio streams.
//
// Why this exists: the radio player wants a real-time audio spectrum to drive
// its visualization, which means piping the stream through a Web Audio
// AnalyserNode in the WebView. But an AnalyserNode reads silence from any
// media element whose source is cross-origin and not CORS-clean — and radio
// stations (icecast/shoutcast) almost never send CORS headers. mpv (the macOS
// player) plays the audio in a native layer the WebView can't reach either.
//
// So for radio we bypass mpv and play through an <audio> element pointed at
// this proxy. It re-serves the upstream stream from 127.0.0.1 with
// `Access-Control-Allow-Origin: *`, making it same-origin-friendly so the
// analyser sees the real PCM. Bound to localhost only; never exposed.

use std::io::Read;
use std::sync::atomic::{AtomicU16, Ordering};

use futures_util::StreamExt;
use tauri::State;

#[derive(Default)]
pub struct RadioProxy {
    port: AtomicU16,
}

impl RadioProxy {
    pub fn new() -> Self {
        Self {
            port: AtomicU16::new(0),
        }
    }
    pub fn set_port(&self, p: u16) {
        self.port.store(p, Ordering::Relaxed);
    }
    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }
}

/// Base URL of the proxy, e.g. `http://127.0.0.1:54321`. Empty until bound.
/// The frontend builds `${base}/?url=<encoded stream url>`.
#[tauri::command]
pub fn radio_proxy_base(state: State<'_, RadioProxy>) -> String {
    let port = state.port();
    if port == 0 {
        String::new()
    } else {
        format!(
            "http://127.0.0.1:{port}/{}",
            crate::security::loopback_token()
        )
    }
}

/// Bind the proxy server and spawn its accept loop. Returns the bound port.
pub fn start_radio_proxy() -> std::io::Result<u16> {
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            // One thread per request — each holds a long-lived streaming
            // connection open for the lifetime of playback.
            crate::security::spawn_media_request(request, handle);
        }
    });
    Ok(port)
}

fn header(k: &str, v: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes())
        .unwrap_or_else(|_| tiny_http::Header::from_bytes(&b"X-Ignored"[..], &b"1"[..]).unwrap())
}

/// Pull the `url` query param out of a request target like `/?url=<encoded>`.
fn extract_url(raw: &str) -> Option<String> {
    let query = raw.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("url=") {
            let decoded = percent_encoding::percent_decode_str(v).decode_utf8().ok()?;
            return Some(decoded.into_owned());
        }
    }
    None
}

fn handle(request: tiny_http::Request) {
    if crate::security::authorized_loopback_path(request.url()).is_none() {
        let _ = request.respond(tiny_http::Response::empty(403));
        return;
    }
    if !matches!(
        request.method(),
        tiny_http::Method::Get | tiny_http::Method::Head | tiny_http::Method::Options
    ) {
        let _ = request.respond(tiny_http::Response::empty(405));
        return;
    }
    // CORS preflight — not normally sent for a media GET, but answer it anyway.
    if request.method() == &tiny_http::Method::Options {
        let resp = tiny_http::Response::empty(204)
            .with_header(header("Access-Control-Allow-Origin", "*"))
            .with_header(header("Access-Control-Allow-Headers", "*"));
        let _ = request.respond(resp);
        return;
    }

    let target = match extract_url(request.url()) {
        Some(u) => u,
        None => {
            let _ = request.respond(
                tiny_http::Response::from_string("missing url param").with_status_code(400),
            );
            return;
        }
    };
    // Only proxy real web URLs (don't let this become a file/SSRF gadget).
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        let _ = request
            .respond(tiny_http::Response::from_string("unsupported scheme").with_status_code(400));
        return;
    }

    // Open the upstream stream. We're on a plain worker thread (not inside the
    // Tauri runtime), so block_on is safe here — same trick the torrent
    // streaming server uses.
    let opened = tauri::async_runtime::block_on(crate::security::public_request(
        reqwest::Method::GET,
        &target,
        reqwest::header::HeaderMap::new(),
    ));

    let resp = match opened {
        Ok(r) => r,
        Err(e) => {
            let _ = request.respond(
                tiny_http::Response::from_string(format!("upstream error: {e}"))
                    .with_status_code(502),
            );
            return;
        }
    };

    let status = resp.status().as_u16();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("audio/mpeg")
        .to_string();

    let reader = StreamReader {
        stream: Box::pin(resp.bytes_stream()),
        buf: bytes::Bytes::new(),
    };

    let headers = vec![
        header("Access-Control-Allow-Origin", "*"),
        header("Content-Type", &ctype),
        header("Cache-Control", "no-store"),
    ];
    // data_length = None → chunked transfer, which is what a never-ending live
    // stream needs.
    let response =
        tiny_http::Response::new(tiny_http::StatusCode(status), headers, reader, None, None);
    let _ = request.respond(response);
}

type ByteStream =
    std::pin::Pin<Box<dyn futures_util::Stream<Item = reqwest::Result<bytes::Bytes>> + Send>>;

/// Blocking `Read` adapter over reqwest's async byte stream. Each `read` drives
/// the async stream forward on the Tauri runtime and copies out whatever chunk
/// arrives, buffering the remainder.
struct StreamReader {
    stream: ByteStream,
    buf: bytes::Bytes,
}

impl Read for StreamReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        while self.buf.is_empty() {
            match tauri::async_runtime::block_on(self.stream.next()) {
                Some(Ok(chunk)) => self.buf = chunk,
                Some(Err(e)) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        e.to_string(),
                    ))
                }
                None => return Ok(0),
            }
        }
        let n = self.buf.len().min(out.len());
        out[..n].copy_from_slice(&self.buf[..n]);
        self.buf = self.buf.split_off(n);
        Ok(n)
    }
}
