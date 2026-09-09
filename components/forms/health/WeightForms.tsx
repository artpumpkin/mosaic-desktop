"use client";
import { useActionState, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { createWeight, deleteWeight, updateWeight } from "@/lib/actions/weight";
import { formatWeight, kgToLb, lbToKg, weightUnitLabel } from "@/lib/health/units";
import type { UnitsPreference } from "@/lib/health/units";
import { useToastResult } from "../useToastResult";

function nowLocalIso(): string {
  // <input type="datetime-local"> wants `YYYY-MM-DDTHH:mm` without seconds/TZ.
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string {
  if (!value) return new Date().toISOString();
  return new Date(value).toISOString();
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

export function WeightCreateForm({ unitsPref }: { unitsPref: UnitsPreference }) {
  const [state, formAction, pending] = useActionState(createWeight, null);
  useToastResult(state);

  const [displayWeight, setDisplayWeight] = useState("");
  const weightKg = useMemo(() => {
    const n = Number(displayWeight);
    if (!Number.isFinite(n) || n <= 0) return "";
    return unitsPref === "imperial" ? lbToKg(n).toFixed(4) : n.toFixed(4);
  }, [displayWeight, unitsPref]);

  return (
    <form
      action={(fd) => {
        formAction(fd);
        setDisplayWeight("");
      }}
      className="grid grid-cols-2 lg:grid-cols-[1fr_1.4fr_2fr_auto] gap-3 items-end"
    >
      <input type="hidden" name="weightKg" value={weightKg} />
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Weight ({weightUnitLabel(unitsPref)})
        </label>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          required
          value={displayWeight}
          onChange={(e) => setDisplayWeight(e.target.value)}
          placeholder={unitsPref === "imperial" ? "165.0" : "75.0"}
          aria-label="Weight"
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">When</label>
        <input
          type="datetime-local"
          name="recordedAt"
          defaultValue={nowLocalIso()}
          onChange={(e) => {
            // Mutate to a real ISO before submit happens via FormData.
            e.target.setAttribute("value", e.target.value);
          }}
          aria-label="When"
        />
      </div>
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
        <input
          name="note"
          placeholder="optional — morning, post-workout, …"
          aria-label="Note"
        />
      </div>
      <button
        type="submit"
        disabled={pending || !weightKg}
        className="btn-primary col-span-2 lg:col-span-1"
      >
        <Plus size={15} /> {pending ? "Logging…" : "Log"}
      </button>
    </form>
  );
}

export type WeightRowData = {
  id: number;
  weightKg: number;
  recordedAt: string;
  note: string | null;
};

export function WeightRow({
  row,
  unitsPref,
}: {
  row: WeightRowData;
  unitsPref: UnitsPreference;
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateWeight, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteWeight, null);
  useToastResult(updateState);
  useToastResult(deleteState);
  const [editing, setEditing] = useState(false);

  const [displayWeight, setDisplayWeight] = useState(
    unitsPref === "imperial" ? kgToLb(row.weightKg).toFixed(1) : row.weightKg.toFixed(1),
  );
  const weightKg = useMemo(() => {
    const n = Number(displayWeight);
    if (!Number.isFinite(n) || n <= 0) return "";
    return unitsPref === "imperial" ? lbToKg(n).toFixed(4) : n.toFixed(4);
  }, [displayWeight, unitsPref]);

  const busy = updatePending || deletePending;

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm tabular-nums">
            {formatWeight(row.weightKg, unitsPref)}
          </div>
          <div className="text-[11px] text-neutral-500">
            {new Date(row.recordedAt).toLocaleString()}
            {row.note && <span className="ml-1.5">· {row.note}</span>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost"
          >
            Edit
          </button>
          <form action={deleteAction}>
            <input type="hidden" name="id" value={row.id} />
            <button type="submit" disabled={busy} className="btn-danger">
              <Trash2 size={13} /> {deletePending ? "…" : "Delete"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form
      action={(fd) => {
        updateAction(fd);
        setEditing(false);
      }}
      className="grid grid-cols-2 lg:grid-cols-[1fr_1.4fr_2fr_auto] gap-2.5 items-end"
    >
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="weightKg" value={weightKg} />
      <div className="min-w-0">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          required
          value={displayWeight}
          onChange={(e) => setDisplayWeight(e.target.value)}
          aria-label="Weight"
        />
      </div>
      <div className="min-w-0">
        <input
          type="datetime-local"
          name="recordedAt"
          defaultValue={toLocalInput(row.recordedAt)}
          aria-label="When"
        />
      </div>
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <input name="note" defaultValue={row.note ?? ""} aria-label="Note" />
      </div>
      <div className="col-span-2 lg:col-span-1 flex gap-2 lg:justify-end">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="btn-ghost flex-1 lg:flex-initial justify-center"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !weightKg}
          className="btn-primary flex-1 lg:flex-initial justify-center"
        >
          <Save size={13} /> {updatePending ? "…" : "Save"}
        </button>
      </div>
    </form>
  );
}
