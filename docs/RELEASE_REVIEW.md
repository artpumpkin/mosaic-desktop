# Public source review

This release preserves Mosaic's full set of application modules and includes
the mpv plugin source in `packages/mpv-player`. It uses a separate application
identifier, `com.artpumpkin.mosaic.opensource`, and does not migrate personal
data from earlier private builds.

## Changes made for the public release

- Updated JavaScript dependencies and native torrent/database dependencies.
- Replaced embedded provider-management credentials with optional runtime ICE configuration.
- Added a production content security policy and a frontend server that fails startup if its local port is occupied.
- Restricted local file access to app directories and native file-picker grants.
- Added private-network rejection, DNS pinning and redirect checks to media proxies, plus response bounds and authenticated loopback stream URLs.
- Replaced mpv's command denylist and broad property prefixes with explicit playback allowlists. Disabled configuration/script loading and automatic references; scoped local media/subtitle paths.
- Added an allowlist for media conversion arguments and native confirmation for cleanup actions.
- Made backup imports atomic, included assets/fasting in SQLite backups, and bounded imported encryption work factors.
- Removed obsolete cross-build scripts and unreviewed bundled executables. Most media tools use the user's package manager; the optional yt-dlp installer uses a fixed release URL and publisher SHA-256 digest.

## Review limits

This is a source release for developers, not an independent penetration-test
certification. macOS is the supported native target. Calls, public media
providers, exchange integrations and system-audio capture depend on external
services, account setup, OS permissions and hardware; automated checks do not
exercise every provider or a live financial account.

The Rust lockfile includes optional MySQL dependencies. RUSTSEC-2023-0071
affects RSA private-key operations; the supported app enables SQLite, not
MySQL, and `cargo tree --target aarch64-apple-darwin -i rsa` has no active
dependency path. This exception is recorded in `.cargo/audit.toml`.
Unmaintained transitive packages and the GTK/glib advisory for the unsupported
Linux target remain visible as audit warnings. Do not describe the entire
cross-platform lockfile as vulnerability-free.

ESLint keeps existing React Compiler migration diagnostics visible as warnings;
the React Compiler is not enabled. Conventional hook correctness, TypeScript
checking, builds and security regression tests remain required checks.

## Local validation

The production macOS app built and launched successfully. A synthetic bank
record was created and exported through the native save dialog, then restored
through the encrypted backup import flow. JavaScript encryption tests (3),
native regression tests (10), and mpv guard tests (6) passed. The native media
argument test includes 79 vectors generated from the UI presets. TypeScript
checking, static frontend build and the scoped dependency audits passed.
