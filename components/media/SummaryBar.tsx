"use client";
import { formatBytes } from "@/lib/media/engine";
import type { QueueItem } from "@/lib/media/types";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</span>
      <span className={`text-[15px] font-semibold ${accent ?? "text-neutral-100"}`}>{value}</span>
    </div>
  );
}

export default function SummaryBar({ items }: { items: QueueItem[] }) {
  if (items.length === 0) return null;

  const done = items.filter((i) => i.status === "done");
  // Use actual output where finished, else the projected size where known.
  let origin = 0;
  let result = 0;
  let haveProjection = false;
  for (const it of items) {
    const inB = it.inBytes ?? 0;
    origin += inB;
    if (it.status === "done" && it.outBytes != null) {
      result += it.outBytes;
      haveProjection = true;
    } else if (it.estBytes != null) {
      result += it.estBytes;
      haveProjection = true;
    } else {
      result += inB;
    }
  }
  const saved = origin - result;
  const savedPct = origin > 0 ? Math.round((saved / origin) * 100) : 0;
  const allDone = done.length === items.length;

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 rounded-2xl glass">
      <Stat label="Files" value={`${items.length}`} />
      <Stat label="Original" value={formatBytes(origin)} />
      {haveProjection && (
        <Stat
          label={allDone ? "Output" : "Projected"}
          value={formatBytes(result)}
          accent="text-violet-200"
        />
      )}
      {haveProjection && saved > 0 && (
        <Stat
          label={allDone ? "Saved" : "Est. saved"}
          value={`${formatBytes(saved)} · ${savedPct}%`}
          accent="text-emerald-300"
        />
      )}
    </div>
  );
}
