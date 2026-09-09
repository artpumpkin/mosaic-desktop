<div align="center">
  <img src="public/icon.svg" width="80" alt="Mosaic logo" />
  <h1>Mosaic</h1>
  <p>A desktop workspace for your finances, health, media, and everyday tools.</p>
  <p><strong>Tauri · Rust · Next.js · TypeScript · SQLite</strong></p>
</div>

Mosaic brings several personal tools into one desktop app. Records are stored
locally; connected features contact the services you use. This repository is
the complete public source edition, including the embedded mpv player.

## What's inside

| Module | Features |
| --- | --- |
| Finance | Accounts, cash, assets, exchange balances, ETH wallets, budgets, expenses, income, debts, and net-worth history |
| Health | Weight, calories, BMI, metabolism, profiles, and fasting sessions |
| Rentals | Booking calendar, property settings, and turnover tracking |
| Movies, anime & TV | Catalog browsing, playback, subtitles, watch progress, and optional torrent streaming |
| Books & manga | Discovery, local EPUB libraries, reading, and saved progress |
| Calls | Peer-to-peer rooms, chat, screen sharing, and synchronized watching |
| Audio & radio | Local libraries, radio playback, and visualizations |
| Cleanup & optimization | Reviewed cleanup selections, duplicate discovery, and local media conversion |

## Run locally

The supported desktop target is **macOS 13+**. The embedded mpv renderer uses
macOS APIs. System-audio sharing additionally depends on OS support and user
permission. Windows/Linux native builds and signed installers are not provided
by this source release.

Install Node.js 24, pnpm 10.33, a current stable Rust toolchain, Apple's Command
Line Tools, and libmpv (`brew install mpv`). Then:

```sh
pnpm install --frozen-lockfile
pnpm --filter @artpumpkin/mpv-player build
pnpm tauri:dev
```

The development UI uses port 3100. For a native production executable:

```sh
pnpm exec tauri build --no-bundle
```

The executable is `src-tauri/target/release/mosaic`. It serves its bundled UI
on loopback port 38947 and fails startup if that port is occupied. It needs the
system libmpv installation used at build time. Creating a redistributable app
requires separately bundling native libraries, reviewing their licenses, and
signing/notarizing the result.

`pnpm build` also produces a static frontend in `out/`. Database, file access,
media tools and other native features require Tauri; this is not a browser-only
edition.

## Optional setup

- **Media conversion:** `brew install ffmpeg imagemagick ghostscript` enables
  the associated operations. Install Real-ESRGAN and its models from its
  upstream project for AI upscaling, with `MOSAIC_MODELS_DIR` pointing to its
  model directory. Missing tools are shown as unavailable.
- **Connected accounts:** enter your own credentials in the app. Use exchange
  keys with read-only permissions. Credentials are not required to explore
  manual finance and health tracking.
- **Calls:** public STUN/TURN fallbacks are configured. An optional runtime
  `MOSAIC_ICE_SERVERS_JSON` environment variable accepts an array of standard
  ICE server objects with `urls`, `username`, and `credential`. Use personal
  short-lived TURN credentials, never a provider-management API token.
- **Libraries:** select local files/folders through the native picker. A new
  session may require selecting a saved library again to grant access.

## Data and backups

The public edition uses a separate app-data directory:

```text
~/Library/Application Support/com.artpumpkin.mosaic.opensource/
```

`finance.db` holds SQLite records. Exchange credential fields are encrypted
using the local `encryption.key`; the database as a whole is **not encrypted**.
Keep the key and database together when making a complete filesystem backup.
On Unix the key is created with owner-only permissions.

Settings → **Backup & transfer** exports a passphrase-encrypted JSON file using
AES-256-GCM and PBKDF2-SHA256. It includes the exported SQLite finance/health
tables, settings, assets and fasting sessions. It does **not** include rentals, media, downloaded books, or every module's
browser-storage data. Imports replace the
included tables in one transaction; failure leaves existing records intact.
Keep your backup passphrase safe—there is no recovery service.

Catalogs, prices, streams, calls, torrents and connected account features make
network requests. Calls and torrents can expose your IP to peers. The app has
no claim that all data stays offline. See [SECURITY.md](SECURITY.md).

## Development checks

```sh
pnpm --filter @artpumpkin/mpv-player build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:fixtures
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml -p tauri-plugin-mpv-player --lib
pnpm audit
cargo audit --file src-tauri/Cargo.lock
```

Tests cover backup encryption and rollback, cleanup guards, media command
restrictions, all generated UI preset vectors, key-file permissions, and
loopback/network boundaries. See [the release review](docs/RELEASE_REVIEW.md)
for the audit exception, remaining lint diagnostics and validation limits.

## Project map

| Directory | Responsibility |
| --- | --- |
| `app/` | Routes and module screens |
| `components/` | Shared UI and feature components |
| `lib/` | Data models, integrations, state, and frontend logic |
| `src-tauri/src/` | Native capabilities, storage, media, and security boundaries |
| `packages/mpv-player/` | Included Rust player plugin and React controls |
| `drizzle/` | SQLite schema migration history |
| `tests/` | Synthetic fixtures and frontend regression tests |

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report
vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Mosaic's source is licensed under [MIT](LICENSE). Third-party libraries, media,
native tools and service content retain their own licenses; see
[NOTICE.md](NOTICE.md). No personal database, private repository history, or
third-party native executable is included.
