"use client";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { fmtBytes } from "@/lib/format";

export type ConfirmAction = "trash" | "empty_trash";

export default function ConfirmCleanupModal({
  open,
  title,
  action,
  count,
  totalBytes,
  items,
  caveats,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  action: ConfirmAction;
  count: number;
  totalBytes: number;
  items?: string[];
  caveats?: string[];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const permanent = action === "empty_trash";
  const preview = (items ?? []).slice(0, 6);
  const extra = (items?.length ?? 0) - preview.length;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="glass rounded-2xl w-full max-w-md p-5 md:p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2">
            <span
              className={`grid place-items-center w-7 h-7 rounded-lg ${
                permanent
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-teal-500/20 text-teal-300"
              }`}
            >
              {permanent ? <AlertTriangle size={15} /> : <Trash2 size={15} />}
            </span>
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-white/10 text-neutral-400"
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-neutral-300">
          {count.toLocaleString()} item{count === 1 ? "" : "s"} ·{" "}
          <span className="font-mono">{fmtBytes(totalBytes)}</span>
          {permanent ? (
            <span className="block mt-2 text-rose-300">
              This <strong>permanently deletes</strong> these items. They cannot
              be recovered.
            </span>
          ) : (
            <span className="block mt-2 text-neutral-400">
              Items move to the system Trash — recoverable until you empty it.
            </span>
          )}
        </p>

        {caveats && caveats.length > 0 && (
          <ul className="text-xs text-amber-300/90 space-y-1 list-disc list-inside">
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}

        {preview.length > 0 && (
          <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2 max-h-32 overflow-y-auto">
            <ul className="text-[11px] font-mono text-neutral-400 space-y-0.5">
              {preview.map((p) => (
                <li key={p} className="truncate" title={p}>
                  {p}
                </li>
              ))}
              {extra > 0 && (
                <li className="text-neutral-500">…and {extra} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={busy || count === 0}
          >
            {busy ? "Working…" : permanent ? "Delete permanently" : "Move to Trash"}
          </button>
        </div>
      </div>
    </div>
  );
}
