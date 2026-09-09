# Embedded mpv player

Mosaic's included Tauri 2 plugin hosts libmpv behind a transparent webview,
with React playback controls above the native video surface.

**The native renderer supports macOS.** Windows/Linux rendering is not
implemented. This package is included in the workspace; installing a separate
published npm or crates.io package is not required.

## Build and use

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @artpumpkin/mpv-player build
cargo test --manifest-path src-tauri/Cargo.toml -p tauri-plugin-mpv-player --lib
```

Install libmpv with `brew install mpv` before compiling native code. Mosaic
references this crate with `path = "../packages/mpv-player"` in its Cargo
manifest and imports the workspace package `@artpumpkin/mpv-player`.

```ts
import { mpv } from "@artpumpkin/mpv-player";
import { MpvPlayer, PlayerControls } from "@artpumpkin/mpv-player/react";
import "@artpumpkin/mpv-player/styles.css";

await mpv.attach();
await mpv.load("https://example.com/video.mp4");
```

The URL above is a placeholder. Supply a media URL you are authorized to use,
or select a local file through the host application's native picker.

Host requirements: a transparent webview/body, Tauri's `macos-private-api`
feature, plugin registration, and `mpv-player:default` capability permissions.
Tailwind consumers must scan this package's `dist-js` directory. Mosaic already
provides this setup.

## Native boundary

- Typed playback commands are in `mpv-player:default`.
- Raw commands require the separate `mpv-player:allow-command` grant. Mosaic
  grants it for playback hotkeys and subtitle selection.
- Native code accepts only explicit playback commands and presentation
  properties. Unrecognized commands, process spawning, screenshots/file output,
  scripts, config changes, and broad property namespaces are rejected.
- Local media and subtitles require a native file-picker grant or an app-cache
  path. Configuration/script loading and automatic external references are
  disabled in the player initialization.
- HTTP(S) playback contacts the supplied source. Do not treat media codecs or
  this early plugin as a sandbox for hostile inputs; keep system libmpv updated.

Tests include the raw-command bypasses fixed during the public release review.
See [Mosaic's review](../../docs/RELEASE_REVIEW.md).

## Distribution

The build script links the developer's Homebrew libmpv. It does not create a
self-contained installer. A distributor must bundle the exact native libraries,
meet their licenses, rewrite library paths, and sign the resulting application.
No DLL, dylib or Windows import library is included. Experimental Windows build
work requires an external SDK; see [the SDK note](vendor/windows/README.md).

## License

Plugin source: [MIT](LICENSE). libmpv and its dependencies retain their own
licenses; consult [Mosaic's notices](../../NOTICE.md).
