# Synthetic player fixtures

The `/player-test` development screen expects optional local MP4 files here.
They are excluded from Git. Generate synthetic color bars and tones using your
locally installed FFmpeg; no third-party video download is needed:

```sh
sh public/test-media/download.sh
```

The script name and filenames remain compatible with the existing development
screen. Every generated video contains test patterns, not a film excerpt.
`bbb-10s-1mb.mp4` and `bbb-10s-30mb.mp4` are 10-second video-only fixtures at
different bitrates. The two `sintel-trailer` files contain color bars with a
440 Hz tone. File sizes are approximate and depend on the FFmpeg build.

The fixtures are for local playback testing, not shipped application assets.
