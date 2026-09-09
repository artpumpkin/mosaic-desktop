"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Loader2,
  Music2,
  Disc3,
  ListMusic,
  FolderOpen,
  FolderSearch,
  RefreshCw,
  SearchX,
  X,
} from "lucide-react";

import {
  BrowseShell,
  BrowseToolbar,
  SearchInput,
  MediaCard,
  MediaGridView,
  EmptyState,
} from "@/components/browse";
import AudioDetailModal from "@/components/audio/AudioDetailModal";
import { fmtDuration } from "@/components/audio/TrackList";
import type { AudioItem, AudioPlayerApi } from "@/components/audio/useAudioPlayer";
import {
  scanLibrary,
  getLibraryDir,
  loadCachedTracks,
  onAudioScanProgress,
  type AudioScanProgress,
} from "@/lib/music/library";
import type { AudioTrack } from "@/lib/music/types";
import { toast } from "@/lib/toast";

type Album = { key: string; name: string; artist: string | null; tracks: AudioTrack[] };

type Props = {
  player: AudioPlayerApi;
  selector: ReactNode;
  /** Now-playing transport, pinned to the top of the section (Apple-style). */
  playerBar: ReactNode;
};

// The local-folder music browser — point Mosaic at a folder, scan tags +
// durations via ffprobe (Rust), and browse the result as an album poster grid.
export default function LibraryTab({ player, selector, playerBar }: Props) {
  const [dir, setDir] = useState<string | null>(null);
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<AudioScanProgress | null>(null);
  const [search, setSearch] = useState("");
  const [albumKey, setAlbumKey] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from localStorage post-mount */
    setDir(getLibraryDir());
    setTracks(loadCachedTracks());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Subscribe to real-time scan progress emitted from Rust.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onAudioScanProgress((p) => setProgress(p)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const pickAndScan = useCallback(async (rescanDir?: string) => {
    let target = rescanDir ?? null;
    if (!target) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      target = picked;
    }
    setScanning(true);
    setProgress({ phase: "collecting", done: 0, total: 0, current: "" });
    try {
      const found = await scanLibrary(target);
      setDir(target);
      setTracks(found);
      toast("ok", `Scanned ${found.length} tracks`);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, []);

  const filteredTracks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      [t.title, t.artist, t.album].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [tracks, search]);

  // Group filtered tracks into albums so the local library gets the same poster
  // grid as the streaming + podcast tabs.
  const albums = useMemo<Album[]>(() => {
    const map = new Map<string, Album>();
    for (const t of filteredTracks) {
      const name = t.album?.trim() || "Unknown Album";
      const key = `${name} ${t.artist ?? ""}`;
      let album = map.get(key);
      if (!album) {
        album = { key, name, artist: t.artist, tracks: [] };
        map.set(key, album);
      }
      album.tracks.push(t);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredTracks]);

  const openAlbum = useMemo(
    () => albums.find((a) => a.key === albumKey) ?? null,
    [albums, albumKey],
  );

  const playAlbumTrack = useCallback(
    (album: Album, index: number) => {
      const queue: AudioItem[] = album.tracks.map((t) => ({
        id: t.path,
        title: t.title,
        subtitle: [t.artist, t.album].filter(Boolean).join(" · ") || null,
        src: convertFileSrc(t.path),
        art: null,
        kind: "music",
      }));
      player.play(queue, index);
    },
    [player],
  );

  const toolbar = (
    <BrowseToolbar>
      {selector}
      <SearchInput value={search} onChange={setSearch} placeholder="Filter library…" />
      {(dir || tracks.length > 0) && (
        <>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => dir && pickAndScan(dir)}
            disabled={scanning || !dir}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[12.5px] text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            {scanning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Rescan
          </button>
          <button
            type="button"
            onClick={() => pickAndScan()}
            disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[12.5px] text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            <FolderOpen size={14} /> Change folder
          </button>
        </>
      )}
    </BrowseToolbar>
  );

  return (
    <BrowseShell toolbar={toolbar} header={playerBar}>
      {scanning && <ScanProgressBar progress={progress} />}

      {!dir && tracks.length === 0 ? (
        <EmptyState
          icon={<Music2 size={32} />}
          title="Add your music library"
          hint="Point Mosaic at a folder of audio files. Tags and durations are read with ffprobe (install it from Tools → Optimize if prompted)."
          action={
            <button
              type="button"
              onClick={() => pickAndScan()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-[13px] font-medium hover:bg-white/90"
            >
              <FolderOpen size={15} /> Choose music folder
            </button>
          }
        />
      ) : tracks.length === 0 && !scanning ? (
        <EmptyState
          icon={<FolderSearch size={32} />}
          title="No audio files in this folder"
          hint={
            dir
              ? `Mosaic scanned ${dir} but found no supported audio (mp3, m4a, flac, wav, ogg…). Rescan after adding files, or pick a different folder.`
              : "No supported audio found. Pick a folder that contains music files."
          }
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => dir && pickAndScan(dir)}
                disabled={!dir}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[13px] text-neutral-200 hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw size={15} /> Rescan
              </button>
              <button
                type="button"
                onClick={() => pickAndScan()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-[13px] font-medium hover:bg-white/90"
              >
                <FolderOpen size={15} /> Choose folder
              </button>
            </div>
          }
        />
      ) : albums.length === 0 && !scanning ? (
        <EmptyState
          icon={<SearchX size={32} />}
          title="No tracks match your filter"
          hint={
            search.trim()
              ? `Nothing in your library matches “${search.trim()}”.`
              : "No tracks match the current filter."
          }
          action={
            search.trim() ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-[13px] text-neutral-200 hover:bg-white/10"
              >
                <X size={15} /> Clear filter
              </button>
            ) : undefined
          }
        />
      ) : (
        <MediaGridView
          title={`${albums.length} albums · ${filteredTracks.length} tracks`}
          items={albums}
          getKey={(a) => a.key}
          minColWidth={150}
          emptyLabel="No tracks match."
          renderItem={(a) => (
            <MediaCard
              title={a.name}
              subtitle={a.artist}
              aspect="1/1"
              accent="rose"
              active={a.key === albumKey}
              badge={`${a.tracks.length}`}
              onPick={() => setAlbumKey(a.key)}
              fallbackIcon={<Disc3 size={30} />}
              overlayIcon={<ListMusic size={18} />}
              fluid
            />
          )}
        />
      )}

      <AudioDetailModal
        open={!!openAlbum}
        onClose={() => setAlbumKey(null)}
        header={
          openAlbum
            ? {
                title: openAlbum.name,
                subtitle: openAlbum.artist,
                image: null,
                meta: [
                  `${openAlbum.tracks.length} track${openAlbum.tracks.length === 1 ? "" : "s"}`,
                  (() => {
                    const sec = openAlbum.tracks.reduce((s, t) => s + (t.duration ?? 0), 0);
                    return sec > 0 ? `${Math.round(sec / 60)} min` : null;
                  })(),
                ]
                  .filter(Boolean)
                  .join(" · "),
              }
            : null
        }
        fallbackIcon={<Disc3 size={36} />}
        rows={
          openAlbum
            ? openAlbum.tracks.map((t, i) => ({
                id: t.path,
                title: t.title,
                meta: [t.artist, fmtDuration(t.duration)].filter(Boolean).join(" · "),
                art: null,
                active: player.current?.id === t.path,
                playing: player.current?.id === t.path && player.isPlaying,
                onPlay: () => playAlbumTrack(openAlbum, i),
              }))
            : []
        }
        kind="music"
        listTitle="Tracks"
        searchPlaceholder="Search tracks…"
        viewKey="mosaic.audio.library.trackView"
      />
    </BrowseShell>
  );
}

// Thin progress bar shown at the top of the content while a scan runs.
function ScanProgressBar({ progress }: { progress: AudioScanProgress | null }) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const label =
    !progress || progress.phase === "collecting"
      ? "Finding audio files…"
      : progress.phase === "done"
        ? "Finishing up…"
        : `Scanning ${done} / ${total}`;

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-center gap-2 mb-2 text-[12.5px] text-neutral-200">
        <Loader2 size={14} className="animate-spin text-rose-400" />
        <span className="font-medium">{label}</span>
        {total > 0 && (
          <span className="ml-auto tabular-nums text-neutral-500">{pct}%</span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={clsxBar(total > 0)}
          style={total > 0 ? { width: `${pct}%` } : undefined}
        />
      </div>
      {progress?.current && (
        <p className="mt-2 text-[11px] text-neutral-500 truncate">{progress.current}</p>
      )}
    </div>
  );
}

// Determinate bar once a total is known; pulsing full bar while collecting.
function clsxBar(determinate: boolean): string {
  return determinate
    ? "h-full bg-rose-400 transition-[width] duration-200 ease-out"
    : "h-full w-full bg-rose-400/70 animate-pulse";
}
