"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { Settings, KeyRound, Database, Trash2, X, Info } from "lucide-react";

import { RealDebridKeyForm } from "@/components/forms/SettingsForms";
import { getRealDebridApiKey } from "@/lib/settings";
import { toast } from "@/lib/toast";

/** A clearable category of locally-stored data. `count` re-reads each render. */
export type DataRow = {
  key: string;
  label: string;
  desc: string;
  /** Live count of items; the row disables its button when 0. */
  count: () => number;
  /** Toast shown on success. */
  done: string;
  run: () => void;
};

/**
 * Settings surface shared by the browse sections (Anime, Movies), presented as
 * a modal. Manages the Real-Debrid token and lets the user wipe their
 * locally-stored data. Each section passes its own title + data rows; changes
 * call `onDataChanged` so the page re-reads its favorites / recents / progress.
 */
export default function MediaSettingsModal({
  open,
  onClose,
  title,
  description = "Manage your streaming token and locally-stored data.",
  rows,
  clearAllLabel,
  clearAllDesc,
  onClearAll,
  clearAllDone,
  onDataChanged,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  rows: DataRow[];
  clearAllLabel: string;
  clearAllDesc: string;
  onClearAll: () => void;
  clearAllDone: string;
  onDataChanged?: () => void;
}) {
  const [rdKey, setRdKey] = useState<string | null>(null);
  const [rdLoaded, setRdLoaded] = useState(false);
  // Bump to force a re-read of the (localStorage) counts after a clear.
  const [tick, setTick] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);

  // Load the saved RD token whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRdLoaded(false);
    (async () => {
      try {
        const k = await getRealDebridApiKey();
        if (!cancelled) setRdKey(k);
      } catch {
        if (!cancelled) setRdKey(null);
      } finally {
        if (!cancelled) setRdLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on Escape, for parity with the other modals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Two-click confirm: first click arms (auto-disarms after 3.5s), second runs.
  const trigger = useCallback(
    (key: string, run: () => void, done: string) => {
      if (armed !== key) {
        setArmed(key);
        window.setTimeout(() => setArmed((cur) => (cur === key ? null : cur)), 3500);
        return;
      }
      setArmed(null);
      try {
        run();
        toast("ok", done);
        setTick((t) => t + 1);
        onDataChanged?.();
      } catch {
        toast("err", "Couldn't clear that");
      }
    },
    [armed, onDataChanged],
  );

  if (!open) return null;

  // Re-read counts each render; `tick` invalidates after a clear.
  void tick;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 md:p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <span className="grid place-items-center w-7 h-7 rounded-lg bg-violet-500/20 text-violet-300">
                <Settings size={15} />
              </span>
              {title}
            </h2>
            <p className="text-sm text-neutral-400 mt-1.5">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-neutral-400 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Real-Debrid token */}
        <section>
          <h3 className="font-medium mb-2 flex items-center gap-2">
            <KeyRound size={16} className="text-violet-300" /> Real-Debrid token
          </h3>
          <p className="text-sm text-neutral-400 mb-3">
            Used for instant, high-quality streams. Without it, playback falls
            back to the built-in torrent engine. Shared across the Movies, Anime
            & TV sections.
          </p>
          {rdLoaded ? (
            <RealDebridKeyForm current={rdKey ?? ""} />
          ) : (
            <div className="text-[12px] text-neutral-500">Loading token…</div>
          )}
          {rdLoaded && !rdKey && (
            <div className="mt-2 text-[12px] text-amber-300/90 flex items-center gap-1.5">
              <Info size={12} /> No token set — streaming via the built-in
              torrent engine.
            </div>
          )}
        </section>

        {/* Manage data */}
        <section>
          <h3 className="font-medium mb-2 flex items-center gap-2">
            <Database size={16} className="text-violet-300" /> Manage data
          </h3>
          <p className="text-sm text-neutral-400 mb-3">
            Stored on this device only. Click once to confirm, again to clear.
          </p>

          <div className="space-y-2">
            {rows.map((a) => {
              const count = safeCount(a.count);
              return (
                <div
                  key={a.key}
                  className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-200">
                      {a.label}
                      <span className="ml-1.5 text-xs text-neutral-500 tabular-nums">
                        {count}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 truncate">{a.desc}</div>
                  </div>
                  <button
                    type="button"
                    disabled={count === 0 && armed !== a.key}
                    onClick={() => trigger(a.key, a.run, a.done)}
                    className={
                      armed === a.key
                        ? "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-rose-500/20 border border-rose-400/40 text-rose-200 hover:bg-rose-500/30"
                        : "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.04] border border-white/10 text-neutral-300 hover:bg-white/[0.08] disabled:opacity-40 disabled:hover:bg-white/[0.04]"
                    }
                  >
                    <Trash2 size={13} />
                    {armed === a.key ? "Confirm?" : "Clear"}
                  </button>
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-white/10">
              <div className="min-w-0">
                <div className="text-sm text-rose-200/90">{clearAllLabel}</div>
                <div className="text-xs text-neutral-500 truncate">{clearAllDesc}</div>
              </div>
              <button
                type="button"
                onClick={() => trigger("all", onClearAll, clearAllDone)}
                className={
                  armed === "all"
                    ? "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/30 border border-rose-400/50 text-rose-100 hover:bg-rose-500/40"
                    : "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-rose-500/10 border border-rose-400/30 text-rose-200 hover:bg-rose-500/20"
                }
              >
                <Trash2 size={13} />
                {armed === "all" ? "Confirm wipe?" : "Clear all"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function safeCount(fn: () => number): number {
  try {
    return fn() || 0;
  } catch {
    return 0;
  }
}
