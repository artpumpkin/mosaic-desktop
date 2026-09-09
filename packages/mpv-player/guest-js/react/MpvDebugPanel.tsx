"use client";

// Collapsible debug panel that captures everything useful when
// reporting an mpv-related issue. Renders:
//
//   - Current mpv state (paused, time, duration, vol, mute, eof)
//   - Latest tracks JSON
//   - Latest demuxer cache state JSON
//   - Recent log lines from `lib/logger.ts` (the in-app ring buffer)
//   - macOS, Tauri, libmpv version info (best-effort)
//
// A "Copy" button serializes the whole thing to plain text that's
// easy to paste into a chat. Intentionally verbose — when you only
// get one shot at a bug repro, more context is better.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Copy, Check, Eraser } from "lucide-react";
import { mpv, type MpvState, type MpvVersion, getEventCounts } from "../mpv";
import { logger, formatEntry, type LogEntry } from "../logger";
import {
  getActions,
  subscribeActions,
  formatAction,
  useUiFps,
  getFpsHistory,
  subscribeFps,
  formatFpsSample,
  startLongTaskObserver,
  getLongTasks,
  subscribeLongTasks,
  formatLongTask,
  type PlayerAction,
} from "../playerDebug";

const MAX_LOG_LINES = 60;
const MAX_ACTION_LINES = 30;
const MAX_FPS_DISPLAY = 24; // last 12s at 500ms sample interval
const MAX_LONGTASK_LINES = 30;
// Throttle the panel's own re-renders to 10Hz. Without this, every
// log entry / action update / fps sample causes a re-render — and
// during a flurry of events (especially a volume drag) the panel
// itself can become a significant source of fps drops it's trying
// to measure (Heisenbug). 100ms is fast enough to feel live.
const PANEL_TICK_THROTTLE_MS = 100;

// Human-readable build stamp for the dump + on-screen badge. The native
// "built" time is the key signal: if it predates your last Rust change,
// the running binary is stale (a webview reload doesn't recompile Rust).
function formatVersion(v: MpvVersion | null): string {
  if (!v) return "plugin v? · player v? (not attached yet)";
  const built =
    v.buildUnix > 0 ? new Date(v.buildUnix * 1000).toISOString() : "unknown";
  return `plugin v${v.plugin} · player v${v.player} · native built ${built}`;
}

export function MpvDebugPanel({ className }: { className?: string }) {
  const [state, setState] = useState<MpvState | null>(null);
  const [tracks, setTracks] = useState<string>("");
  const [buffer, setBuffer] = useState<string>("");
  const [lastEof, setLastEof] = useState<string>("");
  const [copied, setCopied] = useState(false);
  // Build stamp of the running native + JS halves. Arrives with the
  // first successful attach; we poll the cached value until it lands.
  const [version, setVersion] = useState<MpvVersion | null>(null);
  useEffect(() => {
    if (version) return;
    const id = window.setInterval(() => {
      const v = mpv.getVersion();
      if (v) {
        setVersion(v);
        window.clearInterval(id);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [version]);
  // Viewport size is read in a client-only effect, NOT during render.
  // Reading `window.innerWidth` directly in JSX would give different
  // output on the server (undefined → "?") vs. the client (real
  // number), which is a hydration mismatch. Initial null renders the
  // same on both sides; the effect populates real values post-mount.
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(
    null,
  );
  useEffect(() => {
    const upd = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);
  // UI animation frame rate — separate from mpv playback fps. Tells us
  // whether the React/webview side is hitching. Low FPS while mpv
  // playback is smooth means React; low everywhere means mpv.
  const uiFps = useUiFps(true);
  // Throttle state re-renders to a few times per second — without
  // this the panel re-paints on every time-pos tick (10Hz+) and
  // makes scrolling the log feel laggy.
  const lastStateRender = useRef(0);
  // Tick counter used to trigger re-renders when external stores
  // (logger ring + action ring) change. We deliberately DON'T keep a
  // local copy of the entries in useState — earlier we did, and a
  // subscription / closure-staleness bug led to the dump reading an
  // empty `actions` array even after entries were recorded (visible in
  // the logger ring with `player/action` source). Reading directly
  // from `getActions()` and `logger.getAll()` at render/dump time
  // makes the data flow trivially correct.
  const [, bumpTick] = useState(0);

  useEffect(() => {
    const offState = mpv.onState((s) => {
      const now = Date.now();
      if (now - lastStateRender.current < 250) return;
      lastStateRender.current = now;
      setState(s);
    });
    const offTracks = mpv.onTracks(setTracks);
    const offBuffer = mpv.onBuffer(setBuffer);
    const offEof = mpv.onEof((r) =>
      setLastEof(`${new Date().toLocaleTimeString()} — ${r}`),
    );
    // Throttled tick — see PANEL_TICK_THROTTLE_MS above. Coalesces
    // bursts (a single trackAction fires 4 notifies — record, log
    // start, update, log done) into one re-render.
    let lastTick = 0;
    let pendingTick = false;
    const tick = () => {
      const now = performance.now();
      const elapsed = now - lastTick;
      if (elapsed >= PANEL_TICK_THROTTLE_MS) {
        lastTick = now;
        bumpTick((n) => (n + 1) | 0);
      } else if (!pendingTick) {
        pendingTick = true;
        const wait = PANEL_TICK_THROTTLE_MS - elapsed;
        window.setTimeout(() => {
          pendingTick = false;
          lastTick = performance.now();
          bumpTick((n) => (n + 1) | 0);
        }, wait);
      }
    };
    const offLogs = logger.subscribe(tick);
    const offActions = subscribeActions(tick);
    const offFps = subscribeFps(tick);
    const offLongTasks = subscribeLongTasks(tick);
    // Kick off PerformanceObserver — runs forever once started, no
    // teardown needed (idempotent).
    startLongTaskObserver();
    return () => {
      offState();
      offTracks();
      offBuffer();
      offEof();
      offLogs();
      offActions();
      offFps();
      offLongTasks();
    };
  }, []);

  // Read live from the module-level rings on every render. No stale
  // closure issues; the subscribers above just trigger this re-read.
  const logs: LogEntry[] = logger.getAll().slice(-MAX_LOG_LINES);
  const actions: PlayerAction[] = getActions().slice(-MAX_ACTION_LINES);
  const fpsHistory = getFpsHistory();
  const recentFps = fpsHistory.slice(-MAX_FPS_DISPLAY);
  const longTasks = getLongTasks().slice(-MAX_LONGTASK_LINES);
  // "Worst" sample helps you spot a single bad hitch without scanning
  // the whole list.
  const worstFps = fpsHistory.reduce<number | null>(
    (acc, s) => (acc == null || s.fps < acc ? s.fps : acc),
    null,
  );
  const worstLongTask = longTasks.reduce<number | null>(
    (acc, t) => (acc == null || t.durationMs > acc ? t.durationMs : acc),
    null,
  );

  const dump = () => {
    // Always pull from the live rings here — not from the render
    // closure's `actions` / `logs`. A previous version read closure
    // state and produced empty action sections when the subscription
    // pipeline had any timing quirk; reading the module-level ring at
    // dump time eliminates that whole class of failures.
    const liveActions = getActions();
    const liveLogs = logger.getAll();
    const liveFps = getFpsHistory();
    const liveLongTasks = getLongTasks();
    const liveWorst = liveFps.reduce<number | null>(
      (acc, s) => (acc == null || s.fps < acc ? s.fps : acc),
      null,
    );
    const liveWorstLongTask = liveLongTasks.reduce<number | null>(
      (acc, t) => (acc == null || t.durationMs > acc ? t.durationMs : acc),
      null,
    );

    const lines: string[] = [];
    lines.push("=== mpv debug dump ===");
    lines.push(`time: ${new Date().toISOString()}`);
    // Read fresh at dump time (not the throttled `version` state) so the
    // stamp is never stale. plugin = native Rust, player = guest-js,
    // built = when the NATIVE binary was compiled.
    lines.push(`versions: ${formatVersion(mpv.getVersion())}`);
    lines.push(`ua: ${navigator.userAgent}`);
    lines.push(
      `viewport: ${window.innerWidth}x${window.innerHeight} (dpr=${window.devicePixelRatio})`,
    );
    lines.push(
      `ui fps: ${uiFps} (worst over last ${liveFps.length} samples: ${liveWorst ?? "n/a"})`,
    );
    lines.push(
      `long tasks: ${liveLongTasks.length} recorded, worst: ${liveWorstLongTask ?? "n/a"}ms`,
    );
    {
      const c = getEventCounts();
      lines.push(
        `event counts (over ${c.elapsedSec}s): state=${c.state} (${c.stateHz}/s)  tracks=${c.tracks} (${c.tracksHz}/s)  buffer=${c.buffer} (${c.bufferHz}/s)  eof=${c.eof}`,
      );
    }
    lines.push("");
    lines.push("--- state ---");
    lines.push(JSON.stringify(state, null, 2));
    lines.push("");
    lines.push("--- last eof ---");
    lines.push(lastEof || "(none)");
    lines.push("");
    lines.push("--- tracks ---");
    lines.push(tracks || "(none yet)");
    lines.push("");
    lines.push("--- demuxer cache ---");
    lines.push(buffer || "(none yet)");
    lines.push("");
    lines.push(`--- recent actions (last ${liveActions.length}) ---`);
    if (liveActions.length === 0) {
      lines.push("(no actions yet)");
    } else {
      // Newest at the bottom (chronological top→down so it reads like
      // a timeline). Show each action with its duration.
      for (const a of liveActions) lines.push(formatAction(a));
    }
    lines.push("");
    // FPS history shares the timestamp format with actions so you can
    // line them up by eye — find a sample where fps tanks, then look
    // for the action with the same wall-clock time.
    lines.push(`--- fps history (last ${liveFps.length} samples, 500ms each) ---`);
    if (liveFps.length === 0) {
      lines.push("(no fps samples yet)");
    } else {
      for (const s of liveFps) lines.push(formatFpsSample(s));
    }
    lines.push("");
    // Long tasks are the canonical "what blocked the main thread"
    // signal. Each entry is a single browser-reported task that ran
    // >50ms (browser-defined threshold). End-timestamp aligned with
    // action timestamps so you can read top→down and find the action
    // that triggered each hitch.
    lines.push(`--- long tasks (last ${liveLongTasks.length}, browser-reported >50ms) ---`);
    if (liveLongTasks.length === 0) {
      lines.push("(none — main thread has been responsive)");
    } else {
      for (const t of liveLongTasks) lines.push(formatLongTask(t));
    }
    lines.push("");
    lines.push(`--- recent logs (last ${liveLogs.length}) ---`);
    for (const e of liveLogs) lines.push(formatEntry(e));
    return lines.join("\n");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dump());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked in the dev webview; fall back to a
      // textarea select.
      const ta = document.createElement("textarea");
      ta.value = dump();
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <details
      className={clsx(
        "rounded-lg border border-neutral-800 bg-neutral-950/80 text-[11px]",
        className,
      )}
    >
      <summary className="cursor-pointer px-3 py-2 select-none text-neutral-300 hover:text-white flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span>Debug panel</span>
          {/* Always-visible build chip. Hover for the full stamp
              (incl. native build time — the staleness tell). */}
          <span
            className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400"
            title={formatVersion(version)}
          >
            {version
              ? `v${version.plugin}${
                  version.player !== version.plugin
                    ? ` · js ${version.player}`
                    : ""
                }`
              : "v…"}
          </span>
        </span>
        {/* Always-visible vitals: UI fps + last action. Lets you spot
            problems without expanding the panel. */}
        <span className="font-mono text-[10px] text-neutral-500 flex items-center gap-3">
          <span
            className={clsx(
              uiFps >= 55
                ? "text-emerald-400"
                : uiFps >= 30
                  ? "text-amber-300"
                  : "text-red-400",
            )}
          >
            ui {uiFps}fps
          </span>
          {actions.length > 0 && (
            <span className="text-neutral-400">
              last: {actions[actions.length - 1]?.label}
              {actions[actions.length - 1]?.durationMs != null
                ? ` (${actions[actions.length - 1]?.durationMs}ms)`
                : " …"}
            </span>
          )}
        </span>
      </summary>
      <div className="border-t border-neutral-800 p-3 space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-[11px]"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy debug dump"}
          </button>
          <button
            type="button"
            onClick={() => logger.clear()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px]"
          >
            <Eraser size={12} />
            Clear logs
          </button>
        </div>

        <Section label="vitals">
          <div className="font-mono text-[10.5px] leading-snug text-neutral-300 grid grid-cols-2 gap-x-4 gap-y-0.5">
            <div className="col-span-2 text-neutral-400">
              versions: {formatVersion(version)}
            </div>
            <div>
              ui fps:{" "}
              <span
                className={clsx(
                  uiFps >= 55
                    ? "text-emerald-400"
                    : uiFps >= 30
                      ? "text-amber-300"
                      : "text-red-400",
                )}
              >
                {uiFps}
              </span>
            </div>
            <div>
              worst fps:{" "}
              <span
                className={clsx(
                  worstFps == null
                    ? "text-neutral-500"
                    : worstFps >= 55
                      ? "text-emerald-400"
                      : worstFps >= 30
                        ? "text-amber-300"
                        : "text-red-400",
                )}
              >
                {worstFps ?? "—"}
              </span>
              <span className="text-neutral-600"> ({fpsHistory.length} samples)</span>
            </div>
            <div>
              {/* viewport is populated post-mount to avoid a hydration
                  mismatch — server has no window, client does. */}
              viewport: {viewport ? `${viewport.w}×${viewport.h}` : "…"}
            </div>
            <div>
              dpr:{" "}
              {viewport != null && typeof window !== "undefined"
                ? window.devicePixelRatio
                : "…"}
            </div>
            {/* Event counts call performance.now(), which differs
                between server (0) and client (real elapsed time).
                Render only post-mount — `viewport != null` doubles as
                a "we're on the client" sentinel since it's only set
                in a useEffect. */}
            {viewport != null && (
              <div className="col-span-2 mt-1 text-neutral-500">
                {(() => {
                  const c = getEventCounts();
                  return `mpv events: state=${c.state}@${c.stateHz}/s · tracks=${c.tracks} · buffer=${c.buffer} · eof=${c.eof} (over ${c.elapsedSec}s)`;
                })()}
              </div>
            )}
          </div>
        </Section>

        <Section label={`long tasks (${longTasks.length}, worst: ${worstLongTask ?? "—"}ms)`}>
          {/* Direct signal from the browser: every task that blocked
              the main thread for >50ms. If this list is empty but fps
              still drops, the cause is OUTSIDE the main thread (GPU,
              IPC, paint). If it's full, line up the timestamps with
              the actions list to identify the trigger. */}
          {longTasks.length === 0 ? (
            <div className="font-mono text-[10.5px] text-neutral-600">
              (none — main thread responsive)
            </div>
          ) : (
            <div className="font-mono text-[10.5px] leading-snug text-neutral-400 max-h-32 overflow-auto space-y-0.5">
              {longTasks.map((t, i) => (
                <div
                  key={i}
                  className={clsx(
                    "whitespace-pre-wrap break-all",
                    t.durationMs >= 200
                      ? "text-red-400"
                      : t.durationMs >= 100
                        ? "text-amber-300"
                        : "text-neutral-400",
                  )}
                >
                  {formatLongTask(t)}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section label="fps history">
          {/* Latest sample on the right. Each cell is one 500ms window.
              Color-coded so a glance reveals where the dips are; hover
              shows the sample's wall-clock time + fps value. */}
          {recentFps.length === 0 ? (
            <div className="font-mono text-[10.5px] text-neutral-600">
              (collecting samples…)
            </div>
          ) : (
            <div className="flex items-end gap-0.5 h-10">
              {recentFps.map((s) => {
                const pct = Math.max(4, Math.min(100, (s.fps / 60) * 100));
                const color =
                  s.fps >= 55
                    ? "bg-emerald-400/80"
                    : s.fps >= 30
                      ? "bg-amber-300/80"
                      : "bg-red-400/80";
                const t = new Date(s.ts);
                const stamp = `${String(t.getHours()).padStart(2, "0")}:${String(
                  t.getMinutes(),
                ).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
                return (
                  <div
                    key={s.ts}
                    className={clsx("flex-1 rounded-sm", color)}
                    style={{ height: `${pct}%` }}
                    title={`${stamp} — ${s.fps}fps`}
                  />
                );
              })}
            </div>
          )}
        </Section>

        <Section label="state">
          <pre className="font-mono text-[10.5px] leading-snug text-neutral-300 whitespace-pre-wrap break-all">
            {JSON.stringify(state, null, 2)}
          </pre>
        </Section>

        <Section label={`actions (${actions.length})`}>
          <div className="font-mono text-[10.5px] leading-snug text-neutral-400 max-h-48 overflow-auto space-y-0.5">
            {actions.length === 0 ? (
              <div className="text-neutral-600">
                (no actions yet — click anything in the controls bar)
              </div>
            ) : (
              actions.map((a) => (
                <div
                  key={a.id}
                  className={clsx(
                    "whitespace-pre-wrap break-all",
                    a.ok === false && "text-red-400",
                    a.ok == null && "text-neutral-500",
                    a.ok === true && a.durationMs != null && a.durationMs > 100
                      ? "text-amber-300"
                      : "",
                  )}
                >
                  {formatAction(a)}
                </div>
              ))
            )}
          </div>
        </Section>

        {lastEof && (
          <Section label="last eof">
            <pre className="font-mono text-[10.5px] text-neutral-300">{lastEof}</pre>
          </Section>
        )}

        {tracks && (
          <Section label="tracks">
            <pre className="font-mono text-[10.5px] leading-snug text-neutral-400 whitespace-pre-wrap break-all max-h-32 overflow-auto">
              {tracks}
            </pre>
          </Section>
        )}

        {buffer && (
          <Section label="demuxer-cache-state">
            <pre className="font-mono text-[10.5px] leading-snug text-neutral-400 whitespace-pre-wrap break-all max-h-24 overflow-auto">
              {buffer}
            </pre>
          </Section>
        )}

        <Section label={`logs (${logs.length})`}>
          <div className="font-mono text-[10.5px] leading-snug text-neutral-400 max-h-48 overflow-auto space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-neutral-600">(no log entries yet)</div>
            ) : (
              logs.map((e, i) => (
                <div
                  key={i}
                  className={clsx(
                    "whitespace-pre-wrap break-all",
                    e.level === "error" && "text-red-400",
                    e.level === "warn" && "text-amber-300",
                  )}
                >
                  {formatEntry(e)}
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </details>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
