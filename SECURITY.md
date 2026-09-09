# Security

Report vulnerabilities privately to **lachkar.salah@outlook.com**. Include the
affected commit, platform, reproduction steps using synthetic data, and impact.
Do not post tokens, personal records or exploit details in public issues.

## Trust and storage

Mosaic is a personal desktop application running with the user's OS privileges.
The application frontend is trusted; imported books, remote media, chat payloads
and network responses are not. Native file, command and proxy boundaries must
remain enforced even when a frontend caller sends malformed input.

Exchange credential fields use AES-GCM with a local key. The key is stored
beside an otherwise unencrypted SQLite database; this does not protect against
another process running as the same user. Use OS disk encryption and protect
filesystem backups. Exported JSON is passphrase-encrypted. Some modules store
state in the webview's local storage and are not included in JSON exports.

External services receive requests for the connected features you use. Public
signaling/TURN services and torrent peers can observe network metadata. Only
use media and services you are authorized to access.

macOS is the supported native target. This release does not provide signed
installers, automatic updates, or assurances for Windows/Linux native builds.
Review [the release notes](docs/RELEASE_REVIEW.md) for dependency exceptions and
the limits of the release checks. A clean scanner result is not a guarantee
that a desktop application has no vulnerabilities.
