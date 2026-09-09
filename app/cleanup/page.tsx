"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Trash2,
  HardDrive,
  Files,
  Copy,
  FolderOpen,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  Square,
  Info,
  FolderSearch,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import GlassCard from "@/components/GlassCard";
import PageHeader from "@/components/PageHeader";
import ConfirmCleanupModal, {
  type ConfirmAction,
} from "@/components/cleanup/ConfirmCleanupModal";
import CleanupOrb, { type OrbState } from "@/components/cleanup/CleanupOrb";
import { useFinanceData } from "@/lib/query/useFinanceData";
import { useWide } from "@/lib/appLayout";
import { fmtBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import {
  scanAppCache,
  clearAppCache,
  scanSystemJunk,
  cleanSystemJunk,
  scanLargeFiles,
  scanDuplicates,
  trashPaths,
  openFullDiskAccess,
  cancelScan,
  revealInFinder,
  newScanId,
  onScanProgress,
  type LargeFile,
  type DuplicateGroup,
  type ScanProgress,
  type TrashResult,
} from "@/lib/cleanup";

const MB = 1024 * 1024;
const GB = 1024 * MB;
const LARGE_STOPS = [
  { label: "10 MB", v: 10 * MB },
  { label: "50 MB", v: 50 * MB },
  { label: "100 MB", v: 100 * MB },
  { label: "250 MB", v: 250 * MB },
  { label: "500 MB", v: 500 * MB },
  { label: "1 GB", v: GB },
  { label: "2 GB", v: 2 * GB },
  { label: "5 GB", v: 5 * GB },
];
const DUP_MIN_BYTES = MB;
const EMPTY_RESULT: TrashResult = { trashed: [], failed: [], freed_bytes: 0 };

type Pending = {
  title: string;
  action: ConfirmAction;
  count: number;
  totalBytes: number;
  items?: string[];
  caveats?: string[];
  hero?: boolean;
  run: () => Promise<TrashResult>;
  done?: () => void;
};

type SelState = "none" | "some" | "all";

export default function CleanupPage() {
  useWide(true); // edge-to-edge like the TV/Movies sections (sidebar stays)
  const appCache = useFinanceData(["cleanup", "appcache"], scanAppCache);
  const junk = useFinanceData(["cleanup", "junk"], scanSystemJunk);

  const [appSel, setAppSel] = useState<Set<string>>(new Set());
  const [junkSel, setJunkSel] = useState<Set<string>>(new Set());
  const [advanced, setAdvanced] = useState(false);

  // Hero orb state machine
  const [heroState, setHeroState] = useState<OrbState>("analyzing");
  const [freedBytes, setFreedBytes] = useState(0);

  // Phase C
  const [root, setRoot] = useState<string | null>(null);
  const [largeIdx, setLargeIdx] = useState(2); // 100 MB
  const minLarge = LARGE_STOPS[largeIdx].v;
  const [largeFiles, setLargeFiles] = useState<LargeFile[] | null>(null);
  const [largeSel, setLargeSel] = useState<Set<string>>(new Set());
  const [dups, setDups] = useState<DuplicateGroup[] | null>(null);
  const [dupSel, setDupSel] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState<null | "large" | "dup">(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{
    path: string;
    size: number;
    modifiedMs?: number;
  } | null>(null);

  const reveal = (path: string) => {
    revealInFinder(path).catch((e) =>
      toast("err", e instanceof Error ? e.message : String(e)),
    );
  };
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast("ok", "Path copied");
    } catch {
      toast("err", "Couldn't copy path");
    }
  };

  // Visible (non-empty) + size-sorted lists — empties are hidden so there's
  // nothing pointless to dig through.
  const cacheVisible = (appCache.data?.items ?? []).filter((i) => i.size_bytes > 0);
  const junkVisible = [...(junk.data?.buckets ?? [])]
    .filter((b) => b.size_bytes > 0 || b.file_count > 0)
    .sort((a, b) => b.size_bytes - a.size_bytes);
  const junkHidden = (junk.data?.buckets?.length ?? 0) - junkVisible.length;

  const trashableJunk = junkVisible.filter((b) => b.action === "trash");
  const cacheTotal = appCache.data?.total_bytes ?? 0;
  const junkTotal = trashableJunk.reduce((a, b) => a + b.size_bytes, 0);
  const reclaimable = cacheTotal + junkTotal;

  // analyzing → ready once both scans resolve
  useEffect(() => {
    if (
      heroState === "analyzing" &&
      !appCache.isLoading &&
      !junk.isLoading &&
      appCache.data &&
      junk.data
    ) {
      setHeroState("ready");
    }
  }, [heroState, appCache.isLoading, junk.isLoading, appCache.data, junk.data]);

  // done → linger, then re-scan
  useEffect(() => {
    if (heroState !== "done") return;
    const t = setTimeout(() => {
      appCache.reload();
      junk.reload();
      setHeroState("analyzing");
    }, 1900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroState]);

  const reanalyze = () => {
    setHeroState("analyzing");
    appCache.reload();
    junk.reload();
  };

  const confirmRun = useCallback(async () => {
    if (!pending) return;
    const isHero = pending.hero;
    setBusy(true);
    if (isHero) setHeroState("cleaning");
    try {
      const res = await pending.run();
      const skipped = res.failed.length ? `, ${res.failed.length} skipped` : "";
      toast(
        "ok",
        `Freed ${fmtBytes(res.freed_bytes)} · ${res.trashed.length} removed${skipped}`,
      );
      if (isHero) {
        setFreedBytes(res.freed_bytes);
        setHeroState("done");
      }
      pending.done?.();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
      if (isHero) setHeroState("ready");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [pending]);

  // ---- selection helpers ----
  const selState = (keys: string[], sel: Set<string>): SelState => {
    if (keys.length === 0) return "none";
    const n = keys.filter((k) => sel.has(k)).length;
    return n === 0 ? "none" : n === keys.length ? "all" : "some";
  };
  const toggleAll = (
    keys: string[],
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
  ) =>
    setter((prev) => {
      const allIn = keys.length > 0 && keys.every((k) => prev.has(k));
      const next = new Set(prev);
      keys.forEach((k) => (allIn ? next.delete(k) : next.add(k)));
      return next;
    });
  const toggle = (key: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- Hero: clean everything safe (excludes Empty Trash + the finder) ----
  const openCleanAll = () => {
    const appItems = cacheVisible;
    const buckets = trashableJunk;
    const ids = buckets.map((b) => b.id);
    setPending({
      title: "Clean everything",
      action: "trash",
      count:
        appItems.reduce((a, i) => a + i.file_count, 0) +
        buckets.reduce((a, b) => a + b.file_count, 0),
      totalBytes: reclaimable,
      items: [...appItems.map((i) => i.label), ...buckets.map((b) => b.label)],
      caveats: buckets.map((b) => b.caveat).filter((c): c is string => Boolean(c)),
      hero: true,
      run: async () => {
        const a = await clearAppCache(appItems.map((i) => i.id));
        const b = ids.length ? await cleanSystemJunk(ids) : EMPTY_RESULT;
        return {
          trashed: [...a.trashed, ...b.trashed],
          failed: [...a.failed, ...b.failed],
          freed_bytes: a.freed_bytes + b.freed_bytes,
        };
      },
      done: () => {},
    });
  };

  // ---- Phase A ----
  const clearAppCacheAction = () => {
    const items = cacheVisible.filter((i) => appSel.has(i.id));
    if (!items.length) return;
    setPending({
      title: "Clear Mosaic cache",
      action: "trash",
      count: items.reduce((a, i) => a + i.file_count, 0),
      totalBytes: items.reduce((a, i) => a + i.size_bytes, 0),
      items: items.map((i) => i.path),
      caveats: ["Stops any active playback; the next movie restarts the engine (~10s)."],
      run: () => clearAppCache(items.map((i) => i.id)),
      done: () => {
        setAppSel(new Set());
        appCache.reload();
      },
    });
  };

  // ---- Phase B ----
  const cleanJunkAction = () => {
    const buckets = junkVisible.filter((b) => junkSel.has(b.id));
    if (!buckets.length) return;
    const hasPermanent = buckets.some((b) => b.action === "empty_trash");
    setPending({
      title: "Clean system junk",
      action: hasPermanent ? "empty_trash" : "trash",
      count: buckets.reduce((a, b) => a + b.file_count, 0),
      totalBytes: buckets.reduce((a, b) => a + b.size_bytes, 0),
      items: buckets.map((b) => b.label),
      caveats: buckets.map((b) => b.caveat).filter((c): c is string => Boolean(c)),
      run: () => cleanSystemJunk(buckets.map((b) => b.id)),
      done: () => {
        setJunkSel(new Set());
        junk.reload();
      },
    });
  };

  // ---- Phase C ----
  const pickFolder = async () => {
    const sel = await open({ directory: true, multiple: false });
    if (typeof sel === "string") setRoot(sel);
  };

  const runScan = async (kind: "large" | "dup") => {
    setScanning(kind);
    setProgress(null);
    if (kind === "large") {
      setLargeFiles(null);
      setLargeSel(new Set());
    } else {
      setDups(null);
      setDupSel(new Set());
    }
    const id = newScanId();
    setScanId(id);
    const un = await onScanProgress(id, setProgress);
    try {
      if (kind === "large") {
        setLargeFiles(await scanLargeFiles(id, minLarge, 100, root ?? undefined));
      } else {
        setDups(await scanDuplicates(id, DUP_MIN_BYTES, root ?? undefined));
      }
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      un();
      setScanning(null);
      setScanId(null);
      setStopping(false);
      setProgress(null);
    }
  };

  const stopScan = () => {
    if (!scanId) return;
    setStopping(true);
    cancelScan(scanId).catch(() => {});
  };

  const trashLargeAction = () => {
    const sel = (largeFiles ?? []).filter((f) => largeSel.has(f.path));
    if (!sel.length) return;
    setPending({
      title: "Move large files to Trash",
      action: "trash",
      count: sel.length,
      totalBytes: sel.reduce((a, f) => a + f.size_bytes, 0),
      items: sel.map((f) => f.path),
      run: () => trashPaths(sel.map((f) => f.path)),
      done: () => {
        setLargeFiles((prev) => prev?.filter((f) => !largeSel.has(f.path)) ?? null);
        setLargeSel(new Set());
      },
    });
  };

  const trashDupsAction = () => {
    const paths = [...dupSel];
    if (!paths.length) return;
    const bySize = new Map(
      (dups ?? []).flatMap((g) => g.paths.map((p) => [p, g.size_bytes] as const)),
    );
    setPending({
      title: "Move duplicates to Trash",
      action: "trash",
      count: paths.length,
      totalBytes: paths.reduce((a, p) => a + (bySize.get(p) ?? 0), 0),
      items: paths,
      run: () => trashPaths(paths),
      done: () => {
        setDupSel(new Set());
        setDups(
          (prev) =>
            prev
              ?.map((g) => ({ ...g, paths: g.paths.filter((p) => !dupSel.has(p)) }))
              .filter((g) => g.paths.length > 1) ?? null,
        );
      },
    });
  };

  const selectDupExtras = () => {
    const next = new Set<string>();
    for (const g of dups ?? []) g.paths.slice(1).forEach((p) => next.add(p));
    setDupSel(next);
  };

  // Hero action wiring
  let actionLabel = "Analyze";
  let onAction: () => void = reanalyze;
  let actionDisabled = false;
  if (heroState === "analyzing") {
    actionLabel = "Analyzing…";
    actionDisabled = true;
  } else if (heroState === "ready") {
    if (reclaimable > 0) {
      actionLabel = `Clean ${fmtBytes(reclaimable)}`;
      onAction = openCleanAll;
    } else {
      actionLabel = "All clean";
      actionDisabled = true;
    }
  } else if (heroState === "cleaning") {
    actionLabel = "Cleaning…";
    actionDisabled = true;
  } else if (heroState === "done") {
    actionLabel = "Done";
    actionDisabled = true;
  }

  const grantFda = async () => {
    try {
      await openFullDiskAccess();
      toast("ok", "Opened Full Disk Access settings — add Mosaic, then re-run.");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    }
  };

  // section selection summaries
  const cacheKeys = cacheVisible.map((i) => i.id);
  const junkSelectableKeys = trashableJunk.map((b) => b.id);
  const largeKeys = (largeFiles ?? []).map((f) => f.path);
  const cacheSelBytes = cacheVisible
    .filter((i) => appSel.has(i.id))
    .reduce((a, i) => a + i.size_bytes, 0);
  const junkSelBytes = junkVisible
    .filter((b) => junkSel.has(b.id))
    .reduce((a, b) => a + b.size_bytes, 0);
  const largeSelBytes = (largeFiles ?? [])
    .filter((f) => largeSel.has(f.path))
    .reduce((a, f) => a + f.size_bytes, 0);
  const maxJunk = junkVisible[0]?.size_bytes ?? 0;
  const maxCache = cacheVisible[0]?.size_bytes ?? 0;

  return (
    <div className="h-screen flex flex-col bg-[var(--background)] overflow-hidden">
      {/* Inner scroll owns the single scrollbar — mirrors the TV/Movies pages
          so Cleanup fills the pane edge-to-edge instead of a centered column. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 md:px-6 py-5 md:py-8 space-y-8">
          <PageHeader
            icon={Trash2}
            title="Cleanup"
            subtitle="Reclaim disk space. Everything moves to the Trash (recoverable) — except emptying the Trash."
          />

          {/* Top zone — hero orb fills the width beside a breakdown/FDA rail */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] items-stretch">
            {/* Hero */}
            <GlassCard className="flex flex-col items-center justify-center">
              <CleanupOrb
                state={heroState}
                bytes={heroState === "done" ? freedBytes : reclaimable}
                actionLabel={actionLabel}
                onAction={onAction}
                actionDisabled={actionDisabled}
                secondaryLabel={heroState === "ready" ? "Re-analyze" : undefined}
                onSecondary={reanalyze}
              />
              <p className="text-xs text-neutral-500 text-center max-w-sm mt-1">
                One tap clears Mosaic&apos;s stream cache and safe system caches.
                Large files, duplicates, and emptying the Trash stay under your
                review in Advanced.
              </p>
            </GlassCard>

            {/* Side rail — reclaim breakdown + FDA tip */}
            <div className="flex flex-col gap-4">
              <GlassCard className="space-y-3">
                <h3 className="text-xs uppercase tracking-wide text-neutral-500">
                  Reclaimable now
                </h3>
                <div className="text-3xl font-semibold tabular-nums text-neutral-100">
                  {fmtBytes(reclaimable)}
                </div>
                <div className="space-y-2 pt-1">
                  <BreakdownRow
                    icon={HardDrive}
                    tint="text-violet-300"
                    label="Mosaic cache"
                    bytes={cacheTotal}
                    loading={appCache.isLoading && !appCache.data}
                  />
                  <BreakdownRow
                    icon={Files}
                    tint="text-amber-300"
                    label="System junk"
                    bytes={junkTotal}
                    loading={junk.isLoading && !junk.data}
                  />
                </div>
              </GlassCard>

              {/* Full Disk Access tip */}
              <button
                onClick={grantFda}
                className="w-full text-left rounded-xl border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors px-4 py-3 flex items-center gap-3"
              >
                <span className="grid place-items-center w-8 h-8 rounded-lg bg-sky-500/15 text-sky-300 shrink-0">
                  <ShieldCheck size={16} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="text-sm text-neutral-200">
                    Asked for your password every time?
                  </span>
                  <span className="block text-xs text-neutral-500">
                    Grant Mosaic <strong>Full Disk Access</strong> once to stop
                    the repeated macOS prompts. Tap to open Settings.
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className="-rotate-90 text-neutral-500 shrink-0"
                />
              </button>
            </div>
          </div>

          {/* Advanced disclosure */}
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="flex items-center gap-2 text-sm text-neutral-300 hover:text-white transition-colors"
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${advanced ? "rotate-0" : "-rotate-90"}`}
            />
            Advanced — granular control
          </button>

          {advanced && (
            <div className="space-y-6 animate-fade-in-up">
              {/* Mosaic cache + System junk sit side by side on wide panes */}
              <div className="grid gap-6 xl:grid-cols-2 items-start">
                {/* Phase A — Mosaic cache */}
                <GlassCard className="space-y-3">
            <SectionHeader
              icon={HardDrive}
              tint="text-violet-300"
              title="Mosaic cache"
              keys={cacheKeys}
              selState={selState(cacheKeys, appSel)}
              onSelectAll={() => toggleAll(cacheKeys, setAppSel)}
              onRescan={() => appCache.reload()}
              loading={appCache.isLoading}
            />
            {appCache.isLoading && !appCache.data ? (
              <Scanning label="Measuring cache…" />
            ) : cacheVisible.length === 0 ? (
              <Empty label="Cache is empty — nothing to clear." />
            ) : (
              <>
                <div className="space-y-1">
                  {cacheVisible.map((i) => (
                    <Row
                      key={i.id}
                      checked={appSel.has(i.id)}
                      onToggle={() => toggle(i.id, setAppSel)}
                      title={i.label}
                      subtitle={i.description}
                      size={i.size_bytes}
                      fraction={maxCache ? i.size_bytes / maxCache : 0}
                    />
                  ))}
                </div>
                <ActionBar
                  selectedBytes={cacheSelBytes}
                  disabled={appSel.size === 0}
                  onClick={clearAppCacheAction}
                  verb="Clear"
                />
              </>
            )}
          </GlassCard>

          {/* Phase B — System junk */}
          <GlassCard className="space-y-3">
            <SectionHeader
              icon={Files}
              tint="text-amber-300"
              title="System junk"
              keys={junkSelectableKeys}
              selState={selState(junkSelectableKeys, junkSel)}
              onSelectAll={() => toggleAll(junkSelectableKeys, setJunkSel)}
              onRescan={() => junk.reload()}
              loading={junk.isLoading}
            />
            {junk.isLoading && !junk.data ? (
              <Scanning label="Scanning system caches…" />
            ) : junkVisible.length === 0 ? (
              <Empty label="No system junk found." />
            ) : (
              <>
                <div className="space-y-1">
                  {junkVisible.map((b) => (
                    <Row
                      key={b.id}
                      checked={junkSel.has(b.id)}
                      onToggle={() => toggle(b.id, setJunkSel)}
                      title={b.label}
                      subtitle={b.description}
                      size={b.size_bytes}
                      danger={b.action === "empty_trash"}
                      caveat={b.caveat}
                      fraction={maxJunk ? b.size_bytes / maxJunk : 0}
                    />
                  ))}
                </div>
                {junkHidden > 0 && (
                  <p className="text-[11px] text-neutral-600 px-2">
                    {junkHidden} empty {junkHidden === 1 ? "category" : "categories"} hidden
                  </p>
                )}
                <ActionBar
                  selectedBytes={junkSelBytes}
                  disabled={junkSel.size === 0}
                  onClick={cleanJunkAction}
                  verb="Clean"
                />
              </>
            )}
          </GlassCard>
              </div>

              {/* Phase C — Large & duplicate files (full-width) */}
              <GlassCard className="space-y-4">
            <h2 className="font-medium flex items-center gap-2">
              <Copy size={16} className="text-rose-300" /> Large &amp; duplicate files
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button className="btn-ghost" onClick={pickFolder}>
                <FolderOpen size={13} /> {root ? "Change folder" : "Choose folder"}
              </button>
              <span className="font-mono text-xs text-neutral-400 truncate max-w-[18rem]">
                {root ?? "Home folder (~)"}
              </span>
            </div>

            {/* Large files */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-neutral-300">Files larger than</span>
                    <span className="text-sm font-mono text-violet-300 tabular-nums">
                      {LARGE_STOPS[largeIdx].label}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={LARGE_STOPS.length - 1}
                    step={1}
                    value={largeIdx}
                    onChange={(e) => setLargeIdx(Number(e.target.value))}
                    className="w-full accent-violet-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-600 mt-0.5">
                    <span>{LARGE_STOPS[0].label}</span>
                    <span>{LARGE_STOPS[LARGE_STOPS.length - 1].label}</span>
                  </div>
                </div>
                {scanning === "large" ? (
                  <button className="btn-danger" onClick={stopScan} disabled={stopping}>
                    <Square size={12} /> {stopping ? "Stopping…" : "Stop"}
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={() => runScan("large")}
                    disabled={scanning !== null}
                  >
                    Scan
                  </button>
                )}
              </div>
              {scanning === "large" && <ScanProgressBar p={progress} />}
              {largeFiles && largeFiles.length > 0 && (
                <div className="flex items-center justify-between">
                  <SelectAll
                    selState={selState(largeKeys, largeSel)}
                    onToggle={() => toggleAll(largeKeys, setLargeSel)}
                    label={`${largeFiles.length} files`}
                  />
                </div>
              )}
              {largeFiles && (
                <FileTable
                  rows={largeFiles.map((f) => ({
                    key: f.path,
                    path: f.path,
                    size: f.size_bytes,
                    meta: new Date(f.modified_ms).toLocaleDateString(),
                    modifiedMs: f.modified_ms,
                  }))}
                  sel={largeSel}
                  onToggle={(k) => toggle(k, setLargeSel)}
                  onReveal={reveal}
                  onInfo={(r) => setInfo(r)}
                  emptyLabel="No files above that size."
                />
              )}
              {largeFiles && largeFiles.length > 0 && (
                <ActionBar
                  selectedBytes={largeSelBytes}
                  disabled={largeSel.size === 0}
                  onClick={trashLargeAction}
                  verb="Trash"
                />
              )}
            </div>

            {/* Duplicates */}
            <div className="space-y-3 pt-3 border-t border-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-neutral-300 flex-1">
                  Find duplicate files
                </span>
                {scanning === "dup" ? (
                  <button className="btn-danger" onClick={stopScan} disabled={stopping}>
                    <Square size={12} /> {stopping ? "Stopping…" : "Stop"}
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    onClick={() => runScan("dup")}
                    disabled={scanning !== null}
                  >
                    Scan
                  </button>
                )}
              </div>
              {scanning === "dup" && <ScanProgressBar p={progress} />}
              {dups && dups.length > 0 && (
                <button
                  className="btn-ghost"
                  onClick={dupSel.size > 0 ? () => setDupSel(new Set()) : selectDupExtras}
                >
                  {dupSel.size > 0 ? "Clear selection" : "Select all extras (keep one each)"}
                </button>
              )}
              {dups &&
                (dups.length === 0 ? (
                  <Empty label="No duplicate files found." />
                ) : (
                  <div className="space-y-3">
                    {dups.map((g) => (
                      <div
                        key={g.hash}
                        className="rounded-lg bg-white/[0.02] border border-white/5 p-2"
                      >
                        <div className="text-xs text-neutral-400 mb-1">
                          {g.paths.length} copies · {fmtBytes(g.size_bytes)} each ·{" "}
                          <span className="text-emerald-300">
                            {fmtBytes(g.reclaimable_bytes)} reclaimable
                          </span>
                        </div>
                        <FileTable
                          rows={g.paths.map((p, idx) => ({
                            key: p,
                            path: p,
                            size: g.size_bytes,
                            meta: idx === 0 ? "keep" : "duplicate",
                          }))}
                          sel={dupSel}
                          onToggle={(k) => toggle(k, setDupSel)}
                          onReveal={reveal}
                          onInfo={(r) => setInfo(r)}
                          emptyLabel=""
                          compact
                        />
                      </div>
                    ))}
                  </div>
                ))}
              {dups && dups.length > 0 && (
                <ActionBar
                  selectedBytes={[...dupSel].reduce((a, p) => {
                    const g = dups.find((x) => x.paths.includes(p));
                    return a + (g?.size_bytes ?? 0);
                  }, 0)}
                  disabled={dupSel.size === 0}
                  onClick={trashDupsAction}
                  verb="Trash"
                  countLabel={`${dupSel.size} selected`}
                />
              )}
            </div>
              </GlassCard>
            </div>
          )}

          <ConfirmCleanupModal
            open={pending !== null}
            title={pending?.title ?? ""}
            action={pending?.action ?? "trash"}
            count={pending?.count ?? 0}
            totalBytes={pending?.totalBytes ?? 0}
            items={pending?.items}
            caveats={pending?.caveats}
            busy={busy}
            onConfirm={confirmRun}
            onCancel={() => setPending(null)}
          />

          <FileInfoModal
            info={info}
            onClose={() => setInfo(null)}
            onReveal={reveal}
            onCopy={copyPath}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Building blocks --------------------------------------------------------

function TriCheckbox({
  selState,
  onToggle,
}: {
  selState: SelState;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selState === "some";
  }, [selState]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="accent-teal-400 cursor-pointer"
      checked={selState === "all"}
      onChange={onToggle}
    />
  );
}

function SelectAll({
  selState,
  onToggle,
  label,
}: {
  selState: SelState;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
      <TriCheckbox selState={selState} onToggle={onToggle} />
      Select all · <span className="text-neutral-500">{label}</span>
    </label>
  );
}

function SectionHeader({
  icon: Icon,
  tint,
  title,
  keys,
  selState,
  onSelectAll,
  onRescan,
  loading,
}: {
  icon: typeof HardDrive;
  tint: string;
  title: string;
  keys: string[];
  selState: SelState;
  onSelectAll: () => void;
  onRescan: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="font-medium flex items-center gap-2 shrink-0">
          <Icon size={16} className={tint} /> {title}
        </h2>
        {keys.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer select-none">
            <TriCheckbox selState={selState} onToggle={onSelectAll} />
            Select all
          </label>
        )}
      </div>
      <button
        className="btn-ghost"
        onClick={onRescan}
        disabled={loading}
        title="Rescan"
      >
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} />
        )}
        Rescan
      </button>
    </div>
  );
}

function Scanning({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-400 py-2">
      <Loader2 size={14} className="animate-spin" /> {label}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-sm text-neutral-500 py-1">{label}</p>;
}

function BreakdownRow({
  icon: Icon,
  tint,
  label,
  bytes,
  loading,
}: {
  icon: typeof HardDrive;
  tint: string;
  label: string;
  bytes: number;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={15} className={`${tint} shrink-0`} />
      <span className="text-sm text-neutral-300 flex-1 min-w-0">{label}</span>
      <span className="font-mono text-xs text-neutral-400 tabular-nums shrink-0">
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          fmtBytes(bytes)
        )}
      </span>
    </div>
  );
}

function Row({
  checked,
  onToggle,
  title,
  subtitle,
  size,
  danger,
  caveat,
  fraction = 0,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  subtitle?: string;
  size: number;
  danger?: boolean;
  caveat?: string | null;
  fraction?: number;
}) {
  return (
    <label className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.03] cursor-pointer">
      <input
        type="checkbox"
        className="mt-1 accent-teal-400"
        checked={checked}
        onChange={onToggle}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${danger ? "text-rose-300 font-medium" : ""}`}>
            {title}
          </span>
          {danger && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-rose-300/90">
              <AlertTriangle size={10} /> permanent
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
        {caveat && <p className="text-xs text-amber-300/80 mt-0.5">{caveat}</p>}
        {/* relative-size bar */}
        <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full ${danger ? "bg-rose-400/60" : "bg-gradient-to-r from-violet-400/70 to-fuchsia-400/70"}`}
            style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }}
          />
        </div>
      </div>
      <span className="font-mono text-xs text-neutral-300 shrink-0 tabular-nums pt-0.5">
        {fmtBytes(size)}
      </span>
    </label>
  );
}

function ActionBar({
  selectedBytes,
  disabled,
  onClick,
  verb,
  countLabel,
}: {
  selectedBytes: number;
  disabled: boolean;
  onClick: () => void;
  verb: string;
  countLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
      <span className="text-xs text-neutral-500">
        {disabled
          ? "Nothing selected"
          : countLabel
            ? countLabel
            : `${fmtBytes(selectedBytes)} selected`}
      </span>
      <button className="btn-danger" onClick={onClick} disabled={disabled}>
        <Trash2 size={13} />
        {disabled
          ? verb
          : `${verb} ${countLabel ?? fmtBytes(selectedBytes)}`}
      </button>
    </div>
  );
}

function ScanProgressBar({ p }: { p: ScanProgress | null }) {
  return (
    <div className="text-xs text-neutral-400 flex items-center gap-2">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span className="truncate">
        {p
          ? `${p.phase === "hashing" ? "Hashing" : "Scanning"} · ${p.files_seen.toLocaleString()} files · ${fmtBytes(p.bytes_seen)}${p.current_dir ? ` · ${p.current_dir}` : ""}`
          : "Starting…"}
      </span>
    </div>
  );
}

type FileRow = {
  key: string;
  path: string;
  size: number;
  meta: string;
  modifiedMs?: number;
};

function FileTable({
  rows,
  sel,
  onToggle,
  onReveal,
  onInfo,
  emptyLabel,
  compact,
}: {
  rows: FileRow[];
  sel: Set<string>;
  onToggle: (key: string) => void;
  onReveal?: (path: string) => void;
  onInfo?: (row: FileRow) => void;
  emptyLabel: string;
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return emptyLabel ? <Empty label={emptyLabel} /> : null;
  }
  return (
    <div className={compact ? "" : "max-h-80 overflow-y-auto"}>
      {rows.map((r) => (
        <label
          key={r.key}
          className="group flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-white/[0.03] cursor-pointer"
        >
          <input
            type="checkbox"
            className="accent-teal-400"
            checked={sel.has(r.key)}
            onChange={() => onToggle(r.key)}
          />
          <span
            className="flex-1 min-w-0 font-mono text-[11px] text-neutral-300 truncate"
            title={r.path}
          >
            {r.path}
          </span>
          {(onReveal || onInfo) && (
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {onReveal && (
                <RowAction
                  title="Reveal in Finder"
                  onClick={() => onReveal(r.path)}
                  icon={FolderSearch}
                />
              )}
              {onInfo && (
                <RowAction title="Info" onClick={() => onInfo(r)} icon={Info} />
              )}
            </span>
          )}
          <span className="text-[10px] text-neutral-500 shrink-0">{r.meta}</span>
          <span className="font-mono text-xs text-neutral-300 shrink-0 tabular-nums w-20 text-right">
            {fmtBytes(r.size)}
          </span>
        </label>
      ))}
    </div>
  );
}

function RowAction({
  title,
  onClick,
  icon: Icon,
}: {
  title: string;
  onClick: () => void;
  icon: typeof Info;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
    >
      <Icon size={13} />
    </button>
  );
}

function FileInfoModal({
  info,
  onClose,
  onReveal,
  onCopy,
}: {
  info: { path: string; size: number; modifiedMs?: number } | null;
  onClose: () => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
}) {
  if (!info) return null;
  const name = info.path.split("/").pop() || info.path;
  const dir = info.path.slice(0, info.path.length - name.length).replace(/\/$/, "") || "/";
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl w-full max-w-md p-5 md:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2 min-w-0">
            <span className="grid place-items-center w-7 h-7 rounded-lg bg-violet-500/20 text-violet-300 shrink-0">
              <Info size={15} />
            </span>
            <span className="truncate" title={name}>
              {name}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-neutral-400 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-2.5 text-sm">
          <InfoRow label="Size on disk" value={fmtBytes(info.size)} mono />
          {info.modifiedMs != null && (
            <InfoRow
              label="Modified"
              value={new Date(info.modifiedMs).toLocaleString()}
            />
          )}
          <InfoRow label="Where" value={dir} mono />
          <div className="pt-1">
            <span className="text-xs text-neutral-500">Full path</span>
            <p className="mt-1 font-mono text-[11px] text-neutral-300 break-all bg-white/[0.03] border border-white/5 rounded-lg p-2">
              {info.path}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={() => onCopy(info.path)}>
            Copy path
          </button>
          <button className="btn-ghost" onClick={() => onReveal(info.path)}>
            <FolderSearch size={13} /> Reveal in Finder
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className={`text-neutral-300 text-right break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}
