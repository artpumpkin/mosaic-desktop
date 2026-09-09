"use client";
import clsx from "clsx";
import {
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Loader2,
  Check,
  AlertCircle,
  X,
  Columns2,
  FolderOpen,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { formatBytes } from "@/lib/media/engine";
import type { MediaKind, QueueItem } from "@/lib/media/types";

const KIND_ICON: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  pdf: FileText,
};

function ProgressRing({ fraction }: { fraction: number }) {
  const indeterminate = fraction < 0;
  const r = 18;
  const c = 2 * Math.PI * r;
  const pct = indeterminate ? 0.25 : Math.max(0, Math.min(1, fraction));
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className={indeterminate ? "animate-spin" : ""}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 24 24)"
      />
    </svg>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx(
        "grid place-items-center w-7 h-7 rounded-lg text-neutral-300 transition-colors",
        danger ? "hover:text-rose-300 hover:bg-rose-500/15" : "hover:text-white hover:bg-white/12",
      )}
    >
      <Icon size={14} />
    </button>
  );
}

export default function FileTile({
  item,
  opLabel,
  selected,
  estimating,
  canCompare,
  onSelect,
  onView,
  onRemove,
  onCancel,
  onRunAgain,
  onReveal,
  onCompare,
}: {
  item: QueueItem;
  opLabel: string;
  selected: boolean;
  estimating: boolean;
  canCompare: boolean;
  onSelect: () => void;
  onView: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onRunAgain: () => void;
  onReveal: () => void;
  onCompare: () => void;
}) {
  const KindIcon = KIND_ICON[item.kind];
  const running = item.status === "running";
  const done = item.status === "done";
  const error = item.status === "error";
  const viewable = typeof item.thumb === "string";

  // Projected/actual size + savings. Quality ops (enhance/upscale) aren't
  // about shrinking — hide the savings chip so a larger file doesn't read
  // as a regression.
  const sizeOriented = !["upscale", "enhance"].includes(item.opId);
  const projected = done ? item.outBytes : item.estBytes;
  const savedPct =
    sizeOriented && item.inBytes && projected != null && item.inBytes > 0
      ? Math.round((1 - projected / item.inBytes) * 100)
      : null;

  return (
    <div
      className={clsx(
        "group relative rounded-2xl overflow-hidden border bg-white/[0.03] transition-all",
        selected
          ? "border-violet-400/60 ring-2 ring-violet-400/30"
          : "border-white/8 hover:border-white/20 hover:bg-white/[0.05]",
      )}
    >
      {/* Thumbnail — click to view large */}
      <div
        onClick={viewable ? onView : undefined}
        className={clsx(
          "relative aspect-[4/3] bg-gradient-to-br from-white/[0.04] to-white/[0.01] grid place-items-center overflow-hidden",
          viewable && "cursor-zoom-in",
        )}
      >
        {item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumb} alt={item.name} className="w-full h-full object-cover" />
        ) : item.thumb === null ? (
          <KindIcon size={34} className="text-neutral-600" />
        ) : (
          <Loader2 size={20} className="text-neutral-600 animate-spin" />
        )}

        {/* Status overlay */}
        {running && (
          <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[1px]">
            <div className="relative grid place-items-center">
              <ProgressRing fraction={item.fraction} />
              {item.fraction >= 0 && (
                <span className="absolute text-[10px] font-semibold text-white">
                  {Math.round(item.fraction * 100)}%
                </span>
              )}
            </div>
          </div>
        )}
        {done && (
          <div className="absolute top-2 left-2 grid place-items-center w-6 h-6 rounded-full bg-emerald-500/90 shadow">
            <Check size={14} className="text-white" strokeWidth={3} />
          </div>
        )}
        {error && (
          <div className="absolute top-2 left-2 grid place-items-center w-6 h-6 rounded-full bg-rose-500/90 shadow">
            <AlertCircle size={14} className="text-white" />
          </div>
        )}
        {savedPct !== null && (
          <div
            className={clsx(
              "absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[11px] font-semibold backdrop-blur",
              savedPct > 0 ? "bg-emerald-500/85 text-white" : "bg-amber-500/85 text-white",
            )}
          >
            {savedPct > 0 ? `−${savedPct}%` : `+${-savedPct}%`}
          </div>
        )}

        {/* Compare pill (finished images) — sits above the view click target */}
        {done && canCompare && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCompare();
            }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 rounded-lg bg-white/95 text-black text-[11px] font-semibold inline-flex items-center gap-1.5 shadow opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Compare before and after"
          >
            <Columns2 size={12} /> Compare
          </button>
        )}

        {/* Remove / cancel (top-right) */}
        <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          {running ? (
            <ActionButton icon={X} label="Cancel" danger onClick={onCancel} />
          ) : (
            <ActionButton icon={X} label="Remove" onClick={onRemove} />
          )}
        </div>
      </div>

      {/* Body — click to edit this file's settings */}
      <div
        onClick={onSelect}
        className="p-2.5 space-y-1.5 cursor-pointer"
        title="Click to edit this file's settings"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-[12.5px] text-neutral-100 font-medium" title={item.path}>
            {item.name}
          </span>
          {selected && (
            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-violet-500/20 text-violet-200 text-[9.5px] font-semibold uppercase tracking-wide">
              Editing
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.06] text-neutral-300 truncate">
            {opLabel}
          </span>
          <span className="text-neutral-400 shrink-0 tabular-nums">
            {item.inBytes ? formatBytes(item.inBytes) : "—"}
            {projected != null && (
              <>
                {" → "}
                <span className={clsx(done ? "text-emerald-300" : "text-violet-200", estimating && "animate-pulse")}>
                  {item.estApprox && !done ? "≈" : ""}
                  {formatBytes(projected)}
                </span>
              </>
            )}
            {projected == null && estimating && (
              <span className="text-neutral-500 animate-pulse"> → …</span>
            )}
          </span>
        </div>

        {error && (
          <div className="text-[10.5px] text-rose-300 line-clamp-2" title={item.error}>
            {item.error}
          </div>
        )}

        {/* Action row */}
        {(done || error) && (
          <div className="flex items-center gap-0.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionButton icon={RotateCcw} label="Optimize again" onClick={onRunAgain} />
            {done && <ActionButton icon={FolderOpen} label="Reveal in folder" onClick={onReveal} />}
          </div>
        )}
      </div>
    </div>
  );
}
