// Local music library types. Tracks are produced by the Rust scanner
// (src-tauri/src/audio.rs → audio_scan_library), which reads tags + duration
// via ffprobe. Playback uses the Tauri asset protocol (convertFileSrc(path)).

export type AudioTrack = {
  path: string; // absolute local path; play via convertFileSrc(path)
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null; // seconds
};
