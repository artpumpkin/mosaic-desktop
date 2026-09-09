# Synthetic player fixtures

This directory holds optional local MP4 fixtures for player development.
Generated files are excluded from Git. Generate synthetic color bars and tones using your
locally installed FFmpeg; no third-party video download is needed:

```sh
sh public/test-media/download.sh
```

The script name and filenames retain their earlier naming for compatibility. Every generated video contains test patterns, not a film excerpt.
`bbb-10s-1mb.mp4` and `bbb-10s-30mb.mp4` are 10-second video-only fixtures at
different bitrates. The two `sintel-trailer` files contain color bars with a
440 Hz tone. File sizes are approximate and depend on the FFmpeg build.

The fixtures are for local playback testing, not shipped application assets.
