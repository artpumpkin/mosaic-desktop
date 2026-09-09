//! Playback commands exposed through Tauri. Presentation properties and raw
//! commands are deny-by-default allowlists. Local media/subtitle paths require
//! a native file-picker grant or reside in this app's cache directory.

use std::sync::Arc;

use crate::models::{Bounds, VersionInfo};
use crate::MpvHandle;

/// Build the version stamp baked into this binary. `CARGO_PKG_VERSION`
/// and `MPV_PLUGIN_BUILD_UNIX` (set by build.rs) are compile-time
/// constants, so this reflects the ACTUAL running native build.
fn version_info() -> VersionInfo {
    VersionInfo {
        plugin: env!("CARGO_PKG_VERSION").to_string(),
        build_unix: env!("MPV_PLUGIN_BUILD_UNIX").parse().unwrap_or(0),
    }
}

/// Webview-reachable command/property allowlisting. Pure functions so
/// they're unit-testable without a live mpv instance (see the tests at
/// the bottom of this file).
mod guard {
    pub fn is_safe_property(name: &str) -> bool {
        matches!(
            name,
            "pause"
                | "mute"
                | "volume"
                | "speed"
                | "aid"
                | "sid"
                | "vid"
                | "audio-delay"
                | "sub-visibility"
                | "sub-ass-override"
                | "sub-font-size"
                | "sub-pos"
                | "sub-delay"
                | "sub-color"
                | "sub-outline-color"
                | "sub-font"
                | "sub-scale"
                | "sub-border-size"
                | "sub-shadow-offset"
                | "keepaspect"
                | "video-aspect-override"
                | "video-rotate"
                | "video-zoom"
                | "video-pan-x"
                | "video-pan-y"
                | "contrast"
                | "brightness"
                | "gamma"
                | "saturation"
                | "hue"
                | "deinterlace"
                | "loop-file"
                | "ab-loop-a"
                | "ab-loop-b"
        )
    }

    pub fn check_command(name: &str, args: &[String]) -> Result<(), String> {
        if args.len() > 8
            || args
                .iter()
                .any(|a| a.len() > 8192 || a.chars().any(char::is_control))
        {
            return Err("Invalid command arguments".into());
        }
        let allowed = match name {
            "set" | "add" | "multiply" => args.len() == 2 && is_safe_property(&args[0]),
            "cycle" => (1..=2).contains(&args.len()) && is_safe_property(&args[0]),
            "cycle-values" => args.len() >= 2 && is_safe_property(&args[0]),
            "seek" => {
                (1..=2).contains(&args.len())
                    && args[0].parse::<f64>().is_ok_and(f64::is_finite)
                    && args.get(1).is_none_or(|a| {
                        matches!(
                            a.as_str(),
                            "absolute"
                                | "relative"
                                | "absolute+exact"
                                | "relative+exact"
                                | "absolute-percent"
                        )
                    })
            }
            "stop" => args.is_empty(),
            // The host additionally scopes local subtitle paths before dispatch.
            "sub-add" => {
                (1..=4).contains(&args.len())
                    && check_load_url(&args[0]).is_ok()
                    && args
                        .get(1)
                        .is_none_or(|a| matches!(a.as_str(), "select" | "auto" | "cached"))
            }
            "sub-remove" => args.len() == 1 && args[0].parse::<u32>().is_ok(),
            _ => false,
        };
        if allowed {
            Ok(())
        } else {
            Err(format!(
                "Command '{name}' or its arguments are not permitted"
            ))
        }
    }

    pub fn check_load_url(target: &str) -> Result<(), String> {
        if target.is_empty() || target.len() > 8192 || target.chars().any(char::is_control) {
            return Err("Invalid media target".into());
        }
        if target.starts_with("https://")
            || target.starts_with("http://")
            || target.starts_with("file:///")
            || std::path::Path::new(target).is_absolute()
        {
            Ok(())
        } else {
            Err("Only HTTP(S) URLs and explicitly selected local files are supported".into())
        }
    }
}

fn check_local_target(app: &tauri::AppHandle, target: &str) -> Result<(), String> {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let path = if target.starts_with("file:") {
        tauri::Url::parse(target)
            .map_err(|_| "Invalid file URL")?
            .to_file_path()
            .map_err(|_| "Invalid file path")?
    } else if std::path::Path::new(target).is_absolute() {
        std::path::PathBuf::from(target)
    } else {
        return Ok(());
    };
    let path = path
        .canonicalize()
        .map_err(|_| "Media file does not exist")?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Cache directory unavailable")?;
    if app.fs_scope().is_allowed(&path) || cache.canonicalize().is_ok_and(|c| path.starts_with(c)) {
        Ok(())
    } else {
        Err("Select this media file with the native file picker first".into())
    }
}

/// Attach mpv to the given Tauri window. Idempotent: if already
/// attached, reuses the existing instance. Returns the native build
/// stamp either way so the frontend can confirm which binary is live.
#[tauri::command]
pub(crate) async fn attach(
    app: tauri::AppHandle,
    handle: tauri::State<'_, MpvHandle>,
    window_label: Option<String>,
) -> Result<VersionInfo, String> {
    use tauri::Manager;

    let v = version_info();
    eprintln!(
        "[mpv] attach: plugin v{} (build_unix={})",
        v.plugin, v.build_unix
    );

    let label = window_label.unwrap_or_else(|| "main".to_string());
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window '{label}' not found"))?;

    if handle.inner.lock().is_some() {
        return Ok(v);
    }

    #[cfg(target_os = "macos")]
    {
        eprintln!("[mpv] attach: installing host view + CAOpenGLLayer");
        let (view_ptr, layer_ptr) = crate::mac::install_host_view(&app, &window).await?;
        *handle.host_view.lock() = Some(view_ptr);
        *handle.layer_ptr.lock() = Some(layer_ptr);
        eprintln!("[mpv] attach: host view installed (view=0x{view_ptr:x}, layer=0x{layer_ptr:x})");

        eprintln!("[mpv] attach: initializing libmpv");
        let mpv = crate::mac::create_mpv().map_err(|e| format!("mpv init: {e:?}"))?;
        *handle.inner.lock() = Some(mpv);
        eprintln!("[mpv] attach: libmpv initialized");

        // Hand the mpv handle + app to the layer. The layer creates its
        // `mpv_render_context` lazily on its first `drawInCGLContext:`
        // — the only place a CGL context is current on the calling
        // thread, which `mpv_render_context_create` requires.
        crate::mac::attach_mpv_to_layer(&app, layer_ptr, Arc::clone(&handle.inner));

        crate::mac::start_event_loop(&app, Arc::clone(&handle.inner));
        // Nudge the layer to draw at least once so it picks up
        // `attach_mpv_to_layer` and creates the render context.
        crate::mac::request_redraw(&app, layer_ptr).await;
        eprintln!("[mpv] attach: complete");
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        return Err("mpv attach not yet implemented for this platform".to_string());
    }

    // Reached only on macOS (the cfg block above diverges otherwise).
    Ok(v)
}

#[tauri::command]
pub(crate) async fn set_bounds(
    app: tauri::AppHandle,
    handle: tauri::State<'_, MpvHandle>,
    bounds: Bounds,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let Some(view_ptr) = *handle.host_view.lock() else {
            return Ok(());
        };
        let layer_ptr = *handle.layer_ptr.lock();
        crate::mac::set_view_bounds(&app, view_ptr, layer_ptr, bounds).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, handle, bounds);
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn load(
    app: tauri::AppHandle,
    handle: tauri::State<'_, MpvHandle>,
    url: String,
    autoplay: Option<bool>,
) -> Result<(), String> {
    let autoplay = autoplay.unwrap_or(true);
    guard::check_load_url(&url)?;
    check_local_target(&app, &url)?;
    with_mpv(&handle, |mpv| {
        // Set pause state BEFORE loadfile so the new file picks it up
        // on first frame. Without this, mpv preserves its current pause
        // state across loadfile calls — fine for replays but surprising
        // for fresh loads.
        mpv.set_property("pause", !autoplay)
            .map_err(|e| format!("pause set: {e:?}"))?;
        mpv.command("loadfile", &[&url, "replace"])
            .map_err(|e| format!("loadfile: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn play(handle: tauri::State<'_, MpvHandle>) -> Result<(), String> {
    with_mpv(&handle, |mpv| {
        mpv.set_property("pause", false)
            .map_err(|e| format!("pause=false: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn pause(handle: tauri::State<'_, MpvHandle>) -> Result<(), String> {
    with_mpv(&handle, |mpv| {
        mpv.set_property("pause", true)
            .map_err(|e| format!("pause=true: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn seek(
    handle: tauri::State<'_, MpvHandle>,
    seconds: f64,
    mode: Option<String>,
) -> Result<(), String> {
    let mode = mode.unwrap_or_else(|| "absolute".to_string());
    guard::check_command("seek", &[seconds.to_string(), mode.clone()])?;
    let secs_str = format!("{seconds}");
    with_mpv(&handle, |mpv| {
        mpv.command("seek", &[&secs_str, &mode])
            .map_err(|e| format!("seek: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn set_property_str(
    handle: tauri::State<'_, MpvHandle>,
    name: String,
    value: String,
) -> Result<(), String> {
    if !guard::is_safe_property(&name) {
        return Err(format!(
            "property '{name}' is not settable from the webview"
        ));
    }
    with_mpv(&handle, |mpv| {
        mpv.set_property(&name, value.as_str())
            .map_err(|e| format!("set_property {name}: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn set_property_f64(
    handle: tauri::State<'_, MpvHandle>,
    name: String,
    value: f64,
) -> Result<(), String> {
    if !guard::is_safe_property(&name) {
        return Err(format!(
            "property '{name}' is not settable from the webview"
        ));
    }
    with_mpv(&handle, |mpv| {
        mpv.set_property(&name, value)
            .map_err(|e| format!("set_property {name}: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn set_property_bool(
    handle: tauri::State<'_, MpvHandle>,
    name: String,
    value: bool,
) -> Result<(), String> {
    if !guard::is_safe_property(&name) {
        return Err(format!(
            "property '{name}' is not settable from the webview"
        ));
    }
    with_mpv(&handle, |mpv| {
        mpv.set_property(&name, value)
            .map_err(|e| format!("set_property {name}: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn command(
    app: tauri::AppHandle,
    handle: tauri::State<'_, MpvHandle>,
    name: String,
    args: Vec<String>,
) -> Result<(), String> {
    // Defense in depth: this command isn't in the default permission set
    // (consumers opt into `mpv-player:allow-command`), but even when
    // granted we hard-block process/script/config commands and route
    // property-setting commands through the property allowlist.
    guard::check_command(&name, &args)?;
    if name == "sub-add" {
        check_local_target(&app, &args[0])?;
    }
    with_mpv(&handle, |mpv| {
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        mpv.command(&name, &refs)
            .map_err(|e| format!("command {name}: {e:?}"))
    })
}

#[tauri::command]
pub(crate) fn stop(handle: tauri::State<'_, MpvHandle>) -> Result<(), String> {
    with_mpv(&handle, |mpv| {
        let no_args: [&str; 0] = [];
        mpv.command("stop", &no_args)
            .map_err(|e| format!("stop: {e:?}"))
    })
}

fn with_mpv<F, R>(handle: &MpvHandle, f: F) -> Result<R, String>
where
    F: FnOnce(&libmpv2::Mpv) -> Result<R, String>,
{
    // Time how long we wait for the mpv lock. Sync Tauri commands run on
    // the main thread, so a long wait here == a frozen UI. The event loop
    // used to hold this lock for up to 250ms (across wait_event); if these
    // warnings still show large values, lock contention is still the
    // bottleneck behind slider-drag hitches.
    let t0 = std::time::Instant::now();
    let g = handle.inner.lock();
    let waited_ms = t0.elapsed().as_millis();
    // ~20ms waits are now expected (capped by EVENT_WAIT_TIMEOUT_SECS), so
    // only flag pathological waits — a regression canary, not per-write noise.
    if waited_ms > 50 {
        eprintln!("[mpv] set/cmd waited {waited_ms}ms for mpv lock");
    }
    let mpv = g.as_ref().ok_or_else(|| "mpv not attached".to_string())?;
    f(mpv)
}

#[cfg(test)]
mod tests {
    use super::guard;

    #[test]
    fn safe_properties_are_allowed() {
        // Everything the bundled UI sets.
        for p in [
            "pause",
            "mute",
            "volume",
            "speed",
            "aid",
            "sid",
            "sub-ass-override",
            "sub-font-size",
            "sub-pos",
            "sub-delay",
            "sub-color",
            "sub-outline-color",
            "sub-font",
        ] {
            assert!(guard::is_safe_property(p), "{p} should be allowed");
        }
    }

    #[test]
    fn dangerous_properties_are_blocked() {
        // RCE / file / config vectors — must stay blocked even though some
        // start with otherwise-safe prefixes (e.g. `sub-file`).
        for p in [
            "input-ipc-server",
            "sub-file",
            "sub-files",
            "audio-file",
            "external-files",
            "screenshot-directory",
            "stream-record",
            "ytdl-raw-options",
            "script-opts",
            "scripts",
            "config-dir",
            "vo",
            "ao",
            "wid",
            "log-file",
            "video-output",
            "audio-client-name",
            "sub-auto",
        ] {
            assert!(!guard::is_safe_property(p), "{p} must be blocked");
        }
    }

    #[test]
    fn dangerous_commands_are_blocked() {
        for (name, args) in [
            (
                "run",
                vec!["/bin/sh".to_string(), "-c".to_string(), "x".to_string()],
            ),
            ("subprocess", vec![]),
            ("screenshot", vec![]),
            ("loadfile", vec!["/etc/passwd".into()]),
            ("unknown-command", vec![]),
            ("load-script", vec!["/tmp/x.lua".to_string()]),
            ("load-config-file", vec!["/tmp/x".to_string()]),
            ("screenshot-to-file", vec!["/tmp/x.png".to_string()]),
            ("write-watch-later-config", vec![]),
        ] {
            assert!(
                guard::check_command(name, &args).is_err(),
                "{name} must be rejected"
            );
        }
    }

    #[test]
    fn property_setting_commands_respect_allowlist() {
        // `set <dangerous>` is the escape hatch — must be rejected.
        assert!(
            guard::check_command("set", &["input-ipc-server".into(), "/tmp/s".into()]).is_err()
        );
        assert!(guard::check_command("cycle", &["vo".into()]).is_err());
        // Legitimate property control still works.
        assert!(guard::check_command("set", &["pause".into(), "yes".into()]).is_ok());
        assert!(guard::check_command("cycle", &["pause".into()]).is_ok());
    }

    #[test]
    fn benign_commands_pass() {
        assert!(guard::check_command("seek", &["10".into(), "relative".into()]).is_ok());
        assert!(guard::check_command("stop", &[]).is_ok());
    }

    #[test]
    fn load_url_validation() {
        assert!(guard::check_load_url("https://example.com/v.mkv").is_ok());
        assert!(guard::check_load_url("file:///Users/me/v.mp4").is_ok());
        assert!(guard::check_load_url("").is_err());
        assert!(guard::check_load_url("edl://malicious").is_err());
        assert!(guard::check_load_url("memory://payload").is_err());
        assert!(guard::check_load_url("https://x/v\nrun").is_err());
    }
}
