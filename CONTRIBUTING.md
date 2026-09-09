# Contributing

Use the toolchain and checks in the [README](README.md). Keep changes focused,
describe their effect, and include a regression test for changed boundaries or
data handling. Use synthetic fixtures and screenshots without personal data.

Native changes require a macOS build and relevant Rust tests. Changes to media
presets must regenerate `tests/media-presets.json` with
`node scripts/media-fixtures.mjs --write` and pass the native preset tests.

Do not submit credentials, databases, downloaded media, executable dependencies,
or content you cannot redistribute. Report security issues privately using
[SECURITY.md](SECURITY.md).
