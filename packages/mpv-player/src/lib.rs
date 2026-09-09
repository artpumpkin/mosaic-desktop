//! tauri-plugin-mpv — embed a libmpv video player in a Tauri v2 app.
//!
//! macOS only (today). A custom `CAOpenGLLayer` subclass hosts libmpv's
//! OpenGL renderer in a plain `NSView` added as a sibling **below** the
//! WKWebView. With the webview made transparent (`"transparent": true`
//! in `tauri.conf.json` + a transparent body background) and the video
//! region left as a transparent placeholder `<div>`, HTML controls
//! overlay the video naturally — Stremio / YouTube / IINA style.
//!
//! See README.md for the consumer prerequisites (macOSPrivateApi,
//! transparent window, libmpv availability) that a plugin cannot set on
//! the host app's behalf.
//!
//! Commands are exposed as `plugin:mpv-player|<cmd>`; the default
//! permission set is `mpv-player:default`. State is a single
//! process-wide `MpvHandle` managed in `setup`.

use std::sync::Arc;

use parking_lot::Mutex;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Wry,
};

mod commands;
mod models;

#[cfg(target_os = "macos")]
mod mac;

pub use models::*;

/// Process-wide mpv state, managed as Tauri state. Only one mpv
/// instance exists at a time (enforced by the inner `Mutex<Option<…>>`).
pub struct MpvHandle {
    pub(crate) inner: Arc<Mutex<Option<libmpv2::Mpv>>>,
    /// Retained plain `NSView` pointer (as usize so the type is Send).
    /// The view hosts the `MpvOGLLayer` and tracks the placeholder div
    /// rect on every `set_bounds` call.
    #[cfg(target_os = "macos")]
    pub(crate) host_view: Mutex<Option<usize>>,
    /// Retained `MpvOGLLayer` pointer (as usize). The layer owns the
    /// CGL context, the mpv render context, and the per-frame
    /// `mpv_render_context_render` call. The render context is created
    /// lazily on the layer's first `drawInCGLContext:` callback.
    #[cfg(target_os = "macos")]
    pub(crate) layer_ptr: Mutex<Option<usize>>,
}

impl MpvHandle {
    fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            #[cfg(target_os = "macos")]
            host_view: Mutex::new(None),
            #[cfg(target_os = "macos")]
            layer_ptr: Mutex::new(None),
        }
    }
}

// libmpv2's Mpv is Send+Sync; the raw NSView pointer we store as usize
// is also Send (we only dereference it on the main thread via
// run_on_main_thread). The whole handle is therefore safe to expose
// as Tauri state.
unsafe impl Send for MpvHandle {}
unsafe impl Sync for MpvHandle {}

/// Initialize the plugin. Register with
/// `tauri::Builder::default().plugin(tauri_plugin_mpv_player::init())`.
///
/// Pinned to the `Wry` runtime (the universal Tauri runtime) rather than
/// generic over `R: Runtime`: the macOS `MpvOGLLayer` (`define_class!`)
/// stores a concrete `AppHandle` in its ivars for main-thread dispatch,
/// and an Objective-C class can't be generic over the runtime. Every
/// production Tauri app uses Wry, so this costs no real reusability.
pub fn init() -> TauriPlugin<Wry> {
    // Builder id MUST match the crate-derived permission namespace
    // (`tauri-plugin-mpv-player` → `mpv-player`): commands invoke as
    // `plugin:mpv-player|<cmd>` and the ACL grants `mpv-player:*`.
    Builder::new("mpv-player")
        .invoke_handler(tauri::generate_handler![
            commands::attach,
            commands::set_bounds,
            commands::load,
            commands::play,
            commands::pause,
            commands::seek,
            commands::set_property_str,
            commands::set_property_f64,
            commands::set_property_bool,
            commands::command,
            commands::stop,
        ])
        .setup(|app, _api| {
            app.manage(MpvHandle::new());
            Ok(())
        })
        .build()
}
