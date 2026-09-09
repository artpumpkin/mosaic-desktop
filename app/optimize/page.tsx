"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Wand2, Play, Loader2, Trash2, Plus } from "lucide-react";

import GlassCard from "@/components/GlassCard";
import OptimizeToolbar from "@/components/media/OptimizeToolbar";
import OperationPanel from "@/components/media/OperationPanel";
import DropZone from "@/components/media/DropZone";
import SummaryBar from "@/components/media/SummaryBar";
import FileTile from "@/components/media/FileTile";
import ToolStatus from "@/components/media/ToolStatus";
import CompareModal from "@/components/media/CompareModal";
import ImageModal from "@/components/media/ImageModal";

import {
  MEDIA_KINDS,
  defaultOptions,
  findOperation,
  heuristicBytes,
  isEstimable,
  kindForExtension,
  sampleSecondsFor,
  type Operation,
} from "@/lib/media/presets";
import {
  cancelJob,
  estimate,
  fileSize,
  formatBytes,
  revealInFolder,
  runJob,
  thumbnail,
  toolsStatus,
} from "@/lib/media/engine";
import { baseName, extOf, pickFiles } from "@/lib/media/intake";
import { notifyDone, playChime } from "@/lib/media/notify";
import type {
  MediaKind,
  OptValues,
  QueueItem,
  ToolInfo,
  ToolName,
} from "@/lib/media/types";
import { toast } from "@/lib/toast";

type CompareState = {
  item: QueueItem;
  before: string | null;
  after: string | null;
} | null;

export default function OptimizePage() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [active, setActive] = useState<MediaKind>("image");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [estimatingIds, setEstimatingIds] = useState<Set<number>>(new Set());
  const [compare, setCompare] = useState<CompareState>(null);
  const [viewer, setViewer] = useState<{ item: QueueItem; src: string | null; full: boolean } | null>(null);

  // Per-kind defaults applied to newly added files.
  const [opByKind, setOpByKind] = useState<Record<MediaKind, string>>(() =>
    Object.fromEntries(MEDIA_KINDS.map((k) => [k.kind, k.operations[0].id])) as Record<MediaKind, string>,
  );
  const [valuesByKind, setValuesByKind] = useState<Record<MediaKind, OptValues>>(() =>
    Object.fromEntries(MEDIA_KINDS.map((k) => [k.kind, defaultOptions(k.operations[0])])) as Record<MediaKind, OptValues>,
  );

  const idRef = useRef(1);
  const stopRef = useRef(false);
  const thumbCache = useRef<Map<string, string | null>>(new Map());

  const def = useMemo(() => MEDIA_KINDS.find((k) => k.kind === active)!, [active]);
  const editingItem = useMemo(
    () => (editingId != null ? items.find((i) => i.id === editingId && i.kind === active) ?? null : null),
    [editingId, items, active],
  );
  const panelOpId = editingItem ? editingItem.opId : opByKind[active];
  const panelOpts = editingItem ? editingItem.opts : valuesByKind[active];
  const panelOp = findOperation(active, panelOpId);

  const isToolAvailable = useCallback(
    (t: ToolName) => tools.some((x) => x.name === t && x.available),
    [tools],
  );

  const refreshTools = useCallback(() => {
    toolsStatus().then(setTools).catch(() => setTools([]));
  }, []);
  useEffect(() => {
    refreshTools();
  }, [refreshTools]);

  const activeItems = useMemo(() => items.filter((i) => i.kind === active), [items, active]);
  const counts = useMemo(() => {
    const c: Record<MediaKind, number> = { image: 0, video: 0, audio: 0, pdf: 0 };
    for (const it of items) c[it.kind] += 1;
    return c;
  }, [items]);

  const updateItem = useCallback((id: number, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Heuristic projected-size patch for an item's current settings + size.
  const heuristicPatch = useCallback(
    (kind: MediaKind, opId: string, opts: OptValues, inBytes?: number): Partial<QueueItem> => {
      const op = findOperation(kind, opId);
      if (!isEstimable(op) || !inBytes) return { estBytes: undefined, estApprox: undefined };
      const b = heuristicBytes(kind, opId, opts, inBytes);
      return b == null ? { estBytes: undefined, estApprox: undefined } : { estBytes: b, estApprox: true };
    },
    [],
  );

  const loadThumb = useCallback(
    async (id: number, path: string) => {
      if (thumbCache.current.has(path)) {
        updateItem(id, { thumb: thumbCache.current.get(path)! });
        return;
      }
      try {
        const t = await thumbnail(path);
        thumbCache.current.set(path, t);
        updateItem(id, { thumb: t });
      } catch {
        updateItem(id, { thumb: null });
      }
    },
    [updateItem],
  );

  const addPaths = useCallback(
    (paths: string[], forceKind?: MediaKind) => {
      const created: QueueItem[] = [];
      for (const path of paths) {
        const kind = forceKind ?? kindForExtension(extOf(path));
        if (!kind) continue;
        const opId = opByKind[kind];
        created.push({
          id: idRef.current++,
          path,
          name: baseName(path),
          kind,
          opId,
          opts: { ...valuesByKind[kind] },
          status: "queued",
          fraction: 0,
        });
      }
      const skipped = paths.length - created.length;
      if (skipped > 0) toast("err", `Skipped ${skipped} unsupported file(s)`);
      if (created.length === 0) return;
      setItems((prev) => [...prev, ...created]);
      if (!forceKind) setActive(created[0].kind);
      // Load size (→ heuristic) + thumbnail for each new item.
      for (const it of created) {
        fileSize(it.path)
          .then((sz) =>
            updateItem(it.id, { inBytes: sz, ...heuristicPatch(it.kind, it.opId, it.opts, sz) }),
          )
          .catch(() => {});
        loadThumb(it.id, it.path);
      }
    },
    [opByKind, valuesByKind, updateItem, heuristicPatch, loadThumb],
  );

  // Native drag-drop (enter/over/leave/drop) — subscribed once.
  const addPathsRef = useRef(addPaths);
  useEffect(() => {
    addPathsRef.current = addPaths;
  }, [addPaths]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const t = event.payload.type;
        if (t === "enter" || t === "over") setDragActive(true);
        else if (t === "leave") setDragActive(false);
        else if (t === "drop") {
          setDragActive(false);
          addPathsRef.current(event.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const onPick = useCallback(async () => {
    try {
      const paths = await pickFiles(active);
      if (paths.length) addPaths(paths, active);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Could not open file picker");
    }
  }, [active, addPaths]);

  // ---- Settings (default vs per-file) -------------------------------------
  const selectOperation = useCallback(
    (op: Operation) => {
      const opts = defaultOptions(op);
      if (editingItem) {
        updateItem(editingItem.id, {
          opId: op.id,
          opts,
          customized: true,
          ...heuristicPatch(editingItem.kind, op.id, opts, editingItem.inBytes),
        });
      } else {
        setOpByKind((p) => ({ ...p, [active]: op.id }));
        setValuesByKind((p) => ({ ...p, [active]: opts }));
        // Default change flows to every file not individually customized.
        setItems((prev) =>
          prev.map((it) =>
            it.kind === active && !it.customized && it.status !== "running"
              ? { ...it, opId: op.id, opts: { ...opts }, ...heuristicPatch(it.kind, op.id, opts, it.inBytes) }
              : it,
          ),
        );
      }
    },
    [editingItem, active, updateItem, heuristicPatch],
  );

  const changeValues = useCallback(
    (v: OptValues) => {
      if (editingItem) {
        updateItem(editingItem.id, {
          opts: v,
          customized: true,
          ...heuristicPatch(editingItem.kind, editingItem.opId, v, editingItem.inBytes),
        });
      } else {
        setValuesByKind((p) => ({ ...p, [active]: v }));
        setItems((prev) =>
          prev.map((it) =>
            it.kind === active && !it.customized && it.status !== "running"
              ? { ...it, opts: { ...v }, ...heuristicPatch(it.kind, it.opId, v, it.inBytes) }
              : it,
          ),
        );
      }
    },
    [editingItem, active, updateItem, heuristicPatch],
  );

  const applyToAll = useCallback(() => {
    const opId = panelOpId;
    const opts = panelOpts;
    setOpByKind((p) => ({ ...p, [active]: opId }));
    setValuesByKind((p) => ({ ...p, [active]: { ...opts } }));
    setItems((prev) =>
      prev.map((it) =>
        it.kind === active && it.status !== "running"
          ? { ...it, opId, opts: { ...opts }, customized: false, ...heuristicPatch(it.kind, opId, opts, it.inBytes) }
          : it,
      ),
    );
    toast("ok", `Applied to all ${def.label.toLowerCase()}`);
  }, [panelOpId, panelOpts, active, def.label, heuristicPatch]);

  // ---- Automatic size estimation ------------------------------------------
  // Exact estimates run on their own (debounced) whenever a file is added or
  // its settings change. The instant heuristic shows meanwhile; the trial
  // encode replaces it. A per-item signature avoids redundant re-estimates.
  const itemsRef = useRef<QueueItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const estSig = useRef<Map<number, string>>(new Map());
  const passRef = useRef(false);
  const sigOf = (it: QueueItem) => `${it.opId}|${JSON.stringify(it.opts)}|${it.inBytes ?? ""}`;

  const runEstimatePass = useCallback(async () => {
    if (passRef.current || runningRef.current) return;
    const targets = itemsRef.current.filter(
      (it) =>
        it.status === "queued" &&
        it.inBytes &&
        isEstimable(findOperation(it.kind, it.opId)) &&
        estSig.current.get(it.id) !== sigOf(it),
    );
    if (targets.length === 0) return;
    passRef.current = true;
    try {
      for (const it of targets) {
        if (runningRef.current) break;
        const sig = sigOf(it);
        estSig.current.set(it.id, sig); // claim so we don't re-trigger
        setEstimatingIds((s) => new Set(s).add(it.id));
        try {
          const op = findOperation(it.kind, it.opId);
          const res = await estimate(op.build(it.path, it.opts), sampleSecondsFor(it.kind));
          const cur = itemsRef.current.find((x) => x.id === it.id);
          if (cur && sigOf(cur) === sig) {
            updateItem(it.id, { estBytes: res.bytes, estApprox: res.approximate });
          } else {
            estSig.current.delete(it.id); // settings changed mid-flight; retry later
          }
        } catch {
          estSig.current.delete(it.id); // allow a later retry
        } finally {
          setEstimatingIds((s) => {
            const n = new Set(s);
            n.delete(it.id);
            return n;
          });
        }
      }
    } finally {
      passRef.current = false;
    }
  }, [updateItem]);

  useEffect(() => {
    const h = setTimeout(() => void runEstimatePass(), 450);
    return () => clearTimeout(h);
  }, [items, runEstimatePass]);

  // ---- Run ----------------------------------------------------------------
  // Returns the finished result so callers can tally a summary.
  const runOne = useCallback(
    async (item: QueueItem): Promise<{ done: boolean; saved: number }> => {
      const op = findOperation(item.kind, item.opId);
      const spec = op.build(item.path, item.opts);
      updateItem(item.id, {
        status: "running",
        fraction: spec.progress === "indeterminate" ? -1 : 0,
        error: undefined,
      });
      let result = { done: false, saved: 0 };
      try {
        await runJob(item.id, spec, (p) => {
          if (p.type === "progress") updateItem(item.id, { fraction: p.fraction });
          else if (p.type === "done") {
            updateItem(item.id, {
              status: "done",
              fraction: 1,
              outputPath: p.outputPath,
              inBytes: p.inBytes,
              outBytes: p.outBytes,
            });
            result = { done: true, saved: Math.max(0, p.inBytes - p.outBytes) };
          } else if (p.type === "failed") updateItem(item.id, { status: "error", error: p.message });
          else if (p.type === "canceled") updateItem(item.id, { status: "canceled" });
        });
      } catch (e) {
        updateItem(item.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
      }
      return result;
    },
    [updateItem],
  );

  const run = useCallback(async () => {
    const toRun = items.filter((it) => it.kind === active && it.status === "queued");
    if (toRun.length === 0) return;
    setRunning(true);
    stopRef.current = false;
    let completed = 0;
    let saved = 0;
    for (const item of toRun) {
      if (stopRef.current) break;
      const r = await runOne(item);
      if (r.done) {
        completed += 1;
        saved += r.saved;
      }
    }
    setRunning(false);
    if (completed > 0) {
      playChime();
      notifyDone(
        "Optimization complete",
        `${completed} file${completed > 1 ? "s" : ""}${saved > 0 ? ` · saved ${formatBytes(saved)}` : ""}`,
      );
    }
  }, [items, active, runOne]);

  const runAgain = useCallback(
    (item: QueueItem) => {
      // Fresh output path is derived collision-safe in Rust, so just re-run.
      runOne({ ...item, status: "queued", outputPath: undefined, outBytes: undefined });
    },
    [runOne],
  );

  const stopAll = useCallback(() => {
    stopRef.current = true;
    for (const it of items) if (it.status === "running") cancelJob(it.id).catch(() => {});
  }, [items]);

  const removeItem = useCallback(
    (id: number) => {
      setItems((prev) => prev.filter((it) => it.id !== id));
      if (editingId === id) setEditingId(null);
    },
    [editingId],
  );

  const clearFinished = useCallback(() => {
    setItems((prev) =>
      prev.filter((it) => !(it.kind === active && ["done", "error", "canceled"].includes(it.status))),
    );
  }, [active]);

  const reveal = useCallback((path: string) => {
    revealInFolder(path).catch((e) => toast("err", e instanceof Error ? e.message : "Could not reveal"));
  }, []);

  // Formats the webview renders natively → load the real file at full
  // resolution in one shot (no thumbnail round-trip, no double load).
  const WEBVIEW_RENDERABLE = useMemo(
    () => new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]),
    [],
  );

  const openViewer = useCallback(
    async (item: QueueItem) => {
      if (typeof item.thumb !== "string") return; // nothing previewable
      if (item.kind === "image" && WEBVIEW_RENDERABLE.has(extOf(item.path))) {
        setViewer({ item, src: convertFileSrc(item.path), full: true });
        return;
      }
      // Other formats (HEIC/AVIF/TIFF, video, pdf): render a high-res preview.
      setViewer({ item, src: null, full: false });
      try {
        const big = await thumbnail(item.path, 1600);
        setViewer((v) => (v && v.item.id === item.id ? { ...v, src: big } : v));
      } catch {
        /* leave the spinner */
      }
    },
    [WEBVIEW_RENDERABLE],
  );

  // If the asset URL can't load (e.g. protocol blocked), fall back to a
  // rendered preview once.
  const viewerError = useCallback(() => {
    setViewer((v) => {
      if (!v || !v.full) return v; // already on the fallback path
      const it = v.item;
      thumbnail(it.path, 1600)
        .then((big) => setViewer((c) => (c && c.item.id === it.id ? { ...c, src: big } : c)))
        .catch(() => {});
      return { ...v, src: null, full: false }; // spinner; mark not-full to avoid a loop
    });
  }, []);

  const openCompare = useCallback(
    async (item: QueueItem) => {
      // Prefer the real, full-resolution files so the true pixels (and the
      // upscale's added resolution) are visible — not a downscaled thumbnail.
      const before0 = WEBVIEW_RENDERABLE.has(extOf(item.path)) ? convertFileSrc(item.path) : null;
      const after0 =
        item.outputPath && WEBVIEW_RENDERABLE.has(extOf(item.outputPath))
          ? convertFileSrc(item.outputPath)
          : null;
      setCompare({ item, before: before0, after: after0 });
      if (before0 && after0) return;
      const [before, after] = await Promise.all([
        before0 ? Promise.resolve(before0) : thumbnail(item.path, 1600).catch(() => null),
        after0
          ? Promise.resolve(after0)
          : item.outputPath
            ? thumbnail(item.outputPath, 1600).catch(() => null)
            : Promise.resolve(null),
      ]);
      setCompare((c) => (c && c.item.id === item.id ? { ...c, before, after } : c));
    },
    [WEBVIEW_RENDERABLE],
  );

  const queuedCount = activeItems.filter((i) => i.status === "queued").length;
  const opAvailable = panelOp.requires.every(isToolAvailable);
  const hasFinished = activeItems.some((i) => ["done", "error", "canceled"].includes(i.status));

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-12">
      <header className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-amber-500/15 text-amber-300">
            <Wand2 size={18} />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Media Optimizer</h1>
            <p className="text-[12.5px] text-neutral-400">
              Convert, compress, resize, and enhance — fully offline.
            </p>
          </div>
        </div>
        <ToolStatus tools={tools} onChanged={refreshTools} />
      </header>

      <OptimizeToolbar active={active} counts={counts} onChange={setActive} />

      <GlassCard className="space-y-4">
        <OperationPanel
          def={def}
          operation={panelOp}
          values={panelOpts}
          isToolAvailable={isToolAvailable}
          editingName={editingItem ? editingItem.name : null}
          onSelectOperation={selectOperation}
          onChangeValues={changeValues}
          onApplyToAll={activeItems.length > 0 ? applyToAll : undefined}
          onBackToDefault={editingItem ? () => setEditingId(null) : undefined}
        />

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/8">
          <button type="button" onClick={onPick} className="btn-ghost">
            <Plus size={15} /> Add files
          </button>
          <div className="flex-1" />
          {hasFinished && (
            <button type="button" onClick={clearFinished} className="btn-ghost">
              <Trash2 size={14} /> Clear finished
            </button>
          )}
          {running ? (
            <button type="button" onClick={stopAll} className="btn-danger">
              <Loader2 size={15} className="animate-spin" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              disabled={queuedCount === 0 || !opAvailable}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={15} /> {queuedCount > 0 ? `Run ${queuedCount}` : "Run"}
            </button>
          )}
          {!opAvailable && (
            <span className="text-[12px] text-rose-300 w-full text-right">
              {panelOp.requires.join(", ")} not installed — install above to enable
            </span>
          )}
        </div>
      </GlassCard>

      <SummaryBar items={activeItems} />

      {activeItems.length === 0 ? (
        <DropZone dragActive={dragActive} label={def.label.toLowerCase()} onPick={onPick} />
      ) : (
        <div
          className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 rounded-2xl transition-all ${
            dragActive ? "ring-2 ring-violet-400/50 ring-offset-4 ring-offset-transparent" : ""
          }`}
        >
          {activeItems.map((item) => (
            <FileTile
              key={item.id}
              item={item}
              opLabel={findOperation(item.kind, item.opId).label}
              selected={editingId === item.id}
              estimating={estimatingIds.has(item.id)}
              canCompare={item.kind === "image" && item.status === "done" && !!item.outputPath}
              onSelect={() => setEditingId((id) => (id === item.id ? null : item.id))}
              onView={() => openViewer(item)}
              onRemove={() => removeItem(item.id)}
              onCancel={() => cancelJob(item.id).catch(() => {})}
              onRunAgain={() => runAgain(item)}
              onReveal={() => item.outputPath && reveal(item.outputPath)}
              onCompare={() => openCompare(item)}
            />
          ))}
        </div>
      )}

      {viewer && (
        <ImageModal
          name={viewer.item.name}
          src={viewer.src}
          subtitle={viewer.item.inBytes ? formatBytes(viewer.item.inBytes) : undefined}
          onError={viewerError}
          onClose={() => setViewer(null)}
        />
      )}

      {compare && (
        <CompareModal
          name={compare.item.name}
          beforeSrc={compare.before}
          afterSrc={compare.after}
          beforeLabel={compare.item.inBytes ? formatBytes(compare.item.inBytes) : "—"}
          afterLabel={compare.item.outBytes ? formatBytes(compare.item.outBytes) : "—"}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
