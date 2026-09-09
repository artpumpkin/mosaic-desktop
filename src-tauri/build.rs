fn main() {
    // NOTE: the macOS libmpv link probe (Homebrew search path + rpath)
    // moved to tauri-plugin-mpv's build.rs. Its `cargo:rustc-link-*`
    // directives propagate to this binary's final link step.

    // The frontend runs at http://localhost:38947 (served by
    // tauri-plugin-localhost), which Tauri classifies as a "remote" origin
    // — that means every #[tauri::command] is gated by ACL and needs an
    // explicit permission. Autogenerate `allow-<command>` permissions for
    // each of our app commands so the capability can grant them.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_or_create_enc_key",
            "import_backup",
            "read_text_file",
            "write_text_file",
            "mint_turn_credentials",
            "start_macos_system_audio",
            "stop_macos_system_audio",
            "torrent_start",
            "torrent_status",
            "torrent_stop",
            "torrent_stop_all",
            "torrent_http_base",
            "radio_proxy_base",
            "cleanup_scan_app_cache",
            "cleanup_clear_app_cache",
            "cleanup_scan_system_junk",
            "cleanup_clean_system_junk",
            "cleanup_scan_large_files",
            "cleanup_scan_duplicates",
            "cleanup_trash_paths",
            "cleanup_open_full_disk_access",
            "cleanup_cancel_scan",
            "cleanup_reveal",
            "media_run_job",
            "media_cancel",
            "media_reveal",
            "media_file_size",
            "media_thumbnail",
            "media_estimate",
            "media_probe_tools",
            "audio_scan_library",
            // mpv_* commands moved to tauri-plugin-mpv, which
            // autogenerates its own permissions (mpv:default).
        ]),
    ))
    .expect("tauri-build failed");
}
