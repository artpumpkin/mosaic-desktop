"use client";
import clsx from "clsx";
import {
  Shrink,
  RefreshCw,
  Scaling,
  Wand2,
  Sparkles,
  Music,
  Images,
  Layers,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import type { KindDef, Operation, OptValues } from "@/lib/media/presets";
import type { ToolName } from "@/lib/media/types";

const OP_ICON: Record<string, LucideIcon> = {
  compress: Shrink,
  convert: RefreshCw,
  resize: Scaling,
  enhance: Wand2,
  upscale: Sparkles,
  "extract-audio": Music,
  "to-images": Images,
};

export default function OperationPanel({
  def,
  operation,
  values,
  isToolAvailable,
  editingName,
  onSelectOperation,
  onChangeValues,
  onApplyToAll,
  onBackToDefault,
}: {
  def: KindDef;
  operation: Operation;
  values: OptValues;
  isToolAvailable: (t: ToolName) => boolean;
  editingName: string | null;
  onSelectOperation: (op: Operation) => void;
  onChangeValues: (v: OptValues) => void;
  onApplyToAll?: () => void;
  onBackToDefault?: () => void;
}) {
  const set = (key: string, value: string | number | boolean) =>
    onChangeValues({ ...values, [key]: value });

  return (
    <div className="space-y-3.5">
      {/* Scope chip + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11.5px] font-medium",
            editingName
              ? "bg-violet-500/15 text-violet-200 border border-violet-400/25"
              : "bg-white/[0.05] text-neutral-300 border border-white/10",
          )}
          title={editingName ?? undefined}
        >
          {editingName ? <Pencil size={11} /> : <Layers size={11} />}
          <span className="max-w-[240px] truncate">
            {editingName ? `Editing ${editingName}` : `Default for new ${def.label.toLowerCase()}`}
          </span>
        </span>
        <div className="flex items-center gap-1">
          {onBackToDefault && (
            <button
              type="button"
              onClick={onBackToDefault}
              className="text-[12px] text-neutral-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/10 transition-colors"
            >
              Done
            </button>
          )}
          {onApplyToAll && (
            <button
              type="button"
              onClick={onApplyToAll}
              className="text-[12px] text-violet-300 hover:text-violet-200 px-2 py-1 rounded-md hover:bg-violet-500/10 transition-colors"
            >
              Apply to all
            </button>
          )}
        </div>
      </div>

      {/* Operation selector */}
      <div className="flex flex-wrap gap-1.5">
        {def.operations.map((op) => {
          const ok = op.requires.every(isToolAvailable);
          const isActive = op.id === operation.id;
          const Icon = OP_ICON[op.id] ?? Wand2;
          return (
            <button
              key={op.id}
              type="button"
              disabled={!ok}
              title={ok ? op.hint : `Requires ${op.requires.join(", ")} (not bundled)`}
              onClick={() => onSelectOperation(op)}
              className={clsx(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-all",
                isActive
                  ? "bg-gradient-to-b from-violet-500/30 to-violet-500/15 border-violet-400/50 text-white shadow-sm shadow-violet-500/20"
                  : "bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.07] hover:text-white",
                !ok && "opacity-40 cursor-not-allowed hover:bg-white/[0.03]",
              )}
            >
              <Icon size={14} className={isActive ? "text-violet-200" : "text-neutral-400"} />
              {op.label}
            </button>
          );
        })}
      </div>

      {operation.hint && <p className="text-[12.5px] text-neutral-400 -mt-1">{operation.hint}</p>}

      {/* Controls */}
      {operation.controls.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/8">
          {operation.controls.map((c) => {
            if (c.kind === "select") {
              return (
                <label key={c.key} className="block space-y-1.5">
                  <span className="text-[11.5px] text-neutral-400">{c.label}</span>
                  {/* Styling (surface, border, chevron) comes from globals.css */}
                  <select
                    value={String(values[c.key])}
                    onChange={(e) => set(c.key, e.target.value)}
                    className="text-[13px]"
                  >
                    {c.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            if (c.kind === "range") {
              return (
                <label key={c.key} className="block space-y-1.5">
                  <span className="flex items-center justify-between text-[11.5px] text-neutral-400">
                    <span>{c.label}</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-200 font-semibold tabular-nums">
                      {values[c.key]}
                      {c.suffix ?? ""}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={Number(values[c.key])}
                    onChange={(e) => set(c.key, Number(e.target.value))}
                    className="w-full accent-violet-500 cursor-pointer"
                  />
                </label>
              );
            }
            // toggle — pill switch
            const on = Boolean(values[c.key]);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => set(c.key, !on)}
                className={clsx(
                  "flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors text-left",
                  on
                    ? "bg-violet-500/12 border-violet-400/30"
                    : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]",
                )}
              >
                <span className="text-[13px] text-neutral-200">{c.label}</span>
                <span
                  className={clsx(
                    "relative w-8 h-[18px] rounded-full transition-colors shrink-0",
                    on ? "bg-violet-500" : "bg-white/15",
                  )}
                >
                  <span
                    className={clsx(
                      "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all",
                      on ? "left-[18px]" : "left-0.5",
                    )}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
