//! Wire types shared with the frontend. Field names are snake_case to
//! match the TypeScript `MpvBounds` / `MpvState` shapes in the
//! companion `tauri-plugin-mpv-api` package — do NOT rename.

use serde::{Deserialize, Serialize};

/// Wire format for the `set_bounds` command. Numbers are in *logical*
/// pixels (CSS pixels) as the frontend measures them with
/// `getBoundingClientRect`; AppKit treats NSView frames in points,
/// which are equivalent on a standard-DPI display and auto-scaled by
/// the backing layer on Retina.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// State broadcast to JS via the `mpv:state` Tauri event. Keep the
/// shape stable — the frontend's `MpvState` mirrors it.
#[derive(Debug, Clone, Serialize)]
pub struct StatePayload {
    pub time_pos: Option<f64>,
    pub duration: Option<f64>,
    pub paused: Option<bool>,
    pub volume: Option<f64>,
    pub muted: Option<bool>,
    pub eof: bool,
}

/// Returned by `attach` so the frontend can prove WHICH native build is
/// running. `build_unix` is the wall-clock time this crate was last
/// compiled (baked in by build.rs) — the unambiguous "is the Rust binary
/// actually rebuilt?" signal, since a webview reload swaps JS but never
/// the native code. Returned from attach rather than a dedicated command
/// to avoid touching the ACL allowlist.
#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    /// `CARGO_PKG_VERSION` of the plugin crate.
    pub plugin: String,
    /// Unix seconds at compile time (0 if unavailable).
    pub build_unix: u64,
}
