"use client";
import { useActionState, useEffect, useState } from "react";
import { Play, Square, Plus, Save, Trash2, Pencil, X, Clock } from "lucide-react";
import {
  startFast,
  endFast,
  logFast,
  updateFast,
  deleteFast,
} from "@/lib/actions/fasting";
import {
  FAST_TYPE_LABEL,
  FAST_TARGET_HOURS,
  defaultTargetHours,
  durationHours,
  formatDurationShort,
  stageForHours,
  type FastType,
} from "@/lib/health/fasting";
import { fmtDateTime } from "@/lib/format";
import { useToastResult } from "../useToastResult";
import { FastRing } from "@/components/health/FastRing";

const fastTypes: FastType[] = ["omad", "24h", "48h", "72h", "1w", "custom"];

const TYPE_META: Record<FastType, { emoji: string; tagline: string }> = {
  omad: { emoji: "🍽️", tagline: "One meal a day" },
  "24h": { emoji: "🌗", tagline: "Full-day reset" },
  "48h": { emoji: "🔥", tagline: "Deep ketosis" },
  "72h": { emoji: "♻️", tagline: "Autophagy peak" },
  "1w": { emoji: "🌟", tagline: "Cellular renewal" },
  custom: { emoji: "⚙️", tagline: "Your own length" },
};

export type FastRowData = {
  id: number;
  type: FastType;
  startedAt: string;
  endedAt: string | null;
  targetHours: number | null;
  note: string | null;
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function TypeChips({
  value,
  onChange,
  size = "md",
}: {
  value: FastType;
  onChange: (t: FastType) => void;
  size?: "sm" | "md";
}) {
  const isSm = size === "sm";
  return (
    <div className={isSm ? "flex flex-wrap gap-1.5" : "grid grid-cols-3 sm:grid-cols-6 gap-2"}>
      {fastTypes.map((t) => {
        const meta = TYPE_META[t];
        const selected = value === t;
        if (isSm) {
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t)}
              className={
                "px-2.5 py-1 rounded-full text-xs border transition-colors " +
                (selected
                  ? "bg-violet-500/20 border-violet-400/30 text-violet-100"
                  : "bg-white/[0.02] border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]")
              }
            >
              <span className="mr-1">{meta.emoji}</span>
              {FAST_TYPE_LABEL[t]}
            </button>
          );
        }
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={
              "group flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center transition-all " +
              (selected
                ? "bg-gradient-to-br from-violet-500/20 via-fuchsia-500/10 to-transparent border-violet-400/40 text-neutral-100 shadow-[0_4px_18px_-6px_rgba(168,85,247,0.5)]"
                : "bg-white/[0.02] border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.04] hover:border-white/10")
            }
          >
            <span className="text-xl leading-none" aria-hidden>
              {meta.emoji}
            </span>
            <span className="text-xs font-medium leading-none">
              {FAST_TYPE_LABEL[t]}
            </span>
            <span className="text-[10px] text-neutral-500 leading-none">
              {t === "custom" ? meta.tagline : `${FAST_TARGET_HOURS[t]}h`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function FastStartForm() {
  const [type, setType] = useState<FastType>("24h");
  const [state, formAction, pending] = useActionState(startFast, null);
  useToastResult(state);
  return (
    <form action={formAction} className="space-y-4 max-w-4xl">
      <input type="hidden" name="type" value={type} />

      <TypeChips value={type} onChange={setType} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Start (optional)
          </label>
          <input
            name="startedAt"
            type="datetime-local"
            aria-label="Started at"
          />
        </div>
        {type === "custom" && (
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Target hours
            </label>
            <input
              name="targetHours"
              type="number"
              step="0.5"
              placeholder="e.g. 36"
              aria-label="Target hours"
            />
          </div>
        )}
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
          <input name="note" placeholder="Optional" aria-label="Note" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary h-[40px]"
        >
          <Play size={15} /> {pending ? "Starting…" : "Start fast"}
        </button>
      </div>
    </form>
  );
}

export function FastActiveCard({ row }: { row: FastRowData }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [state, formAction, pending] = useActionState(endFast, null);
  useToastResult(state);

  const elapsedH = durationHours(row.startedAt, null, now);
  const target = row.targetHours ?? defaultTargetHours(row.type);
  const stage = stageForHours(elapsedH);

  // Estimated end time
  const endEstimate =
    target && target > 0
      ? new Date(new Date(row.startedAt).getTime() + target * 3_600_000)
      : null;

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 sm:p-8 border bg-gradient-to-br backdrop-blur"
      style={{
        borderColor: `${stage.ringColor}40`,
        backgroundImage: `radial-gradient(ellipse at top, ${stage.ringColor}1a, transparent 60%), linear-gradient(to bottom right, rgba(255,255,255,0.02), transparent)`,
      }}
    >
      <div className="absolute top-4 left-5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em]" style={{ color: stage.ringColor }}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ backgroundColor: stage.ringColor }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: stage.ringColor }} />
        </span>
        Fasting now
      </div>

      <div className="flex justify-center pt-4">
        <FastRing
          type={row.type}
          elapsedH={elapsedH}
          targetH={target ?? null}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 max-w-md mx-auto">
        <div className="rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
            <Clock size={11} /> Started
          </div>
          <div className="text-sm font-medium mt-1 tabular-nums">
            {fmtDateTime(row.startedAt)}
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/5 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            {endEstimate ? "Goal" : "Open-ended"}
          </div>
          <div className="text-sm font-medium mt-1 tabular-nums">
            {endEstimate ? fmtDateTime(endEstimate.toISOString()) : "—"}
          </div>
        </div>
      </div>

      {row.note && (
        <div className="mt-4 max-w-md mx-auto text-sm text-neutral-300 italic text-center">
          “{row.note}”
        </div>
      )}

      <form action={formAction} className="mt-6 flex justify-center">
        <input type="hidden" name="id" value={row.id} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-medium border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:border-rose-400/50 transition-all min-w-[180px]"
        >
          <Square size={14} fill="currentColor" /> {pending ? "Ending fast…" : "End fast"}
        </button>
      </form>
    </div>
  );
}

export function FastLogForm() {
  const [type, setType] = useState<FastType>("24h");
  const [state, formAction, pending] = useActionState(logFast, null);
  useToastResult(state);
  return (
    <form action={formAction} className="space-y-4 max-w-4xl">
      <input type="hidden" name="type" value={type} />
      <TypeChips value={type} onChange={setType} size="sm" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Start</label>
          <input
            name="startedAt"
            type="datetime-local"
            required
            aria-label="Started at"
          />
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">End</label>
          <input
            name="endedAt"
            type="datetime-local"
            required
            aria-label="Ended at"
          />
        </div>
        {type === "custom" && (
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Target hours
            </label>
            <input
              name="targetHours"
              type="number"
              step="0.5"
              aria-label="Target hours"
            />
          </div>
        )}
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
          <input name="note" placeholder="Optional" aria-label="Note" />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="btn-primary h-[40px]"
        >
          <Plus size={15} /> {pending ? "Logging…" : "Log fast"}
        </button>
      </div>
    </form>
  );
}

export function FastDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteFast, null);
  useToastResult(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="btn-danger"
        aria-label="Delete fast"
      >
        <Trash2 size={13} />
      </button>
    </form>
  );
}

export function FastRow({ row }: { row: FastRowData }) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<FastType>(row.type);
  const [state, formAction, pending] = useActionState(updateFast, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const elapsedH = durationHours(row.startedAt, row.endedAt);
  const target = row.targetHours ?? defaultTargetHours(row.type);
  const reached = target ? elapsedH >= target : false;
  const ratio = target ? Math.min(1, elapsedH / target) : 0;
  const stage = stageForHours(elapsedH);

  if (!editing) {
    const size = 44;
    const stroke = 4;
    const radius = (size - stroke) / 2;
    const c = 2 * Math.PI * radius;
    const dash = ratio * c;
    return (
      <li className="px-4 sm:px-5 py-4 flex items-center gap-4 hover:bg-white/[0.015] transition-colors">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={stage.ringColor}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={`${dash} ${c}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[13px]">
            <span aria-hidden>{stage.emoji}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{FAST_TYPE_LABEL[row.type]}</span>
            <span className="font-semibold tabular-nums text-sm">
              {formatDurationShort(elapsedH)}
            </span>
            {target && (
              <span
                className={
                  "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border " +
                  (reached
                    ? "border-emerald-400/30 text-emerald-300 bg-emerald-500/10"
                    : "border-amber-400/30 text-amber-300 bg-amber-500/10")
                }
              >
                {reached ? `goal +${formatDurationShort(elapsedH - target)}` : `${target}h goal · short`}
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            <span>{fmtDateTime(row.startedAt)}</span>
            {row.endedAt && <span>→ {fmtDateTime(row.endedAt)}</span>}
            {row.note && <span className="truncate">· {row.note}</span>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost"
            aria-label="Edit fast"
          >
            <Pencil size={13} /> Edit
          </button>
          <FastDeleteForm id={row.id} />
        </div>
      </li>
    );
  }

  return (
    <li className="px-4 sm:px-5 py-4 bg-white/[0.02]">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="type" value={type} />
        <TypeChips value={type} onChange={setType} size="sm" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Start</label>
            <input
              name="startedAt"
              type="datetime-local"
              required
              defaultValue={toDatetimeLocal(row.startedAt)}
              aria-label="Started at"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">End</label>
            <input
              name="endedAt"
              type="datetime-local"
              defaultValue={toDatetimeLocal(row.endedAt)}
              aria-label="Ended at"
            />
          </div>
          {type === "custom" && (
            <div className="min-w-0">
              <label className="text-xs text-neutral-400 block mb-1.5">
                Target hours
              </label>
              <input
                name="targetHours"
                type="number"
                step="0.5"
                defaultValue={row.targetHours ?? ""}
                aria-label="Target hours"
              />
            </div>
          )}
          <div className="col-span-2 lg:col-span-2 min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
            <input
              name="note"
              defaultValue={row.note ?? ""}
              aria-label="Note"
            />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn-ghost"
          >
            <X size={13} /> Cancel
          </button>
          <button type="submit" disabled={pending} className="btn-primary">
            <Save size={13} /> {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </li>
  );
}
