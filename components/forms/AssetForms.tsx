"use client";
import { useActionState, useEffect, useState } from "react";
import { Plus, Save, Trash2, Pencil, X, RefreshCw } from "lucide-react";
import {
  createAsset,
  updateAsset,
  deleteAsset,
  refreshAssetPrices,
} from "@/lib/actions/assets";
import { fmtDateTime } from "@/lib/format";
import { METAL_LABEL, type MetalSymbol } from "@/lib/integrations/metals";
import { useToastResult } from "./useToastResult";
import Sensitive from "@/components/Sensitive";

const currencies = ["MAD", "AED", "USD", "EUR"];
const metals: MetalSymbol[] = ["XAU", "XAG", "XPT", "XPD"];
const units = ["oz", "g", "kg"] as const;

export type AssetCategory =
  | "precious_metal"
  | "real_estate"
  | "vehicle"
  | "collectible"
  | "other";

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  precious_metal: "Precious metal",
  real_estate: "Real estate",
  vehicle: "Vehicle",
  collectible: "Collectible",
  other: "Other",
};

export type AssetRowData = {
  id: number;
  category: AssetCategory;
  label: string;
  metal: MetalSymbol | null;
  quantity: number | null;
  unit: "oz" | "g" | "kg" | null;
  manualValue: number | null;
  currency: string;
  pricePerOzUsd: number | null;
  lastPricedAt: string | null;
  acquiredOn: string | null;
  acquiredValue: number | null;
  note: string | null;
  updatedAt: string;
};

function FieldsForCategory({
  category,
  defaults,
}: {
  category: AssetCategory;
  defaults?: Partial<AssetRowData>;
}) {
  if (category === "precious_metal") {
    return (
      <>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Metal</label>
          <select
            name="metal"
            defaultValue={defaults?.metal ?? "XAU"}
            aria-label="Metal"
          >
            {metals.map((m) => (
              <option key={m} value={m}>
                {METAL_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Quantity</label>
          <input
            name="quantity"
            type="number"
            step="0.0001"
            required
            defaultValue={defaults?.quantity ?? ""}
            placeholder="e.g. 5"
            aria-label="Quantity"
          />
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Unit</label>
          <select name="unit" defaultValue={defaults?.unit ?? "oz"} aria-label="Unit">
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Manual value (fallback)
          </label>
          <input
            name="manualValue"
            type="number"
            step="0.01"
            defaultValue={defaults?.manualValue ?? ""}
            placeholder="optional"
            aria-label="Manual value fallback"
          />
        </div>
      </>
    );
  }
  return (
    <div className="min-w-0">
      <label className="text-xs text-neutral-400 block mb-1.5">Value</label>
      <input
        name="manualValue"
        type="number"
        step="0.01"
        required
        defaultValue={defaults?.manualValue ?? ""}
        aria-label="Value"
      />
    </div>
  );
}

export function AssetCreateForm() {
  const [category, setCategory] = useState<AssetCategory>("precious_metal");
  const [state, formAction, pending] = useActionState(createAsset, null);
  useToastResult(state);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="category" value={category} />
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={
              "px-3 py-1.5 rounded-full text-xs border transition-colors " +
              (category === c
                ? "bg-violet-500/20 border-violet-400/30 text-violet-100"
                : "bg-white/[0.02] border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]")
            }
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="sm:col-span-2 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Label</label>
          <input
            name="label"
            required
            placeholder={
              category === "precious_metal"
                ? "1oz Krugerrand"
                : category === "real_estate"
                  ? "Apartment in Rabat"
                  : category === "vehicle"
                    ? "Tesla Model 3"
                    : "Asset name"
            }
            aria-label="Label"
          />
        </div>
        <FieldsForCategory category={category} />
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Currency</label>
          <select name="currency" defaultValue="MAD" aria-label="Currency">
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Acquired on (optional)
          </label>
          <input name="acquiredOn" type="date" aria-label="Acquired on" />
        </div>
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Cost basis (optional)
          </label>
          <input
            name="acquiredValue"
            type="number"
            step="0.01"
            placeholder="paid amount"
            aria-label="Cost basis"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
          <input name="note" className="w-full" aria-label="Note" />
        </div>
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          <Plus size={15} /> {pending ? "Adding…" : "Add"}
        </button>
      </div>
    </form>
  );
}

export function AssetRefreshPricesButton() {
  const [state, formAction, pending] = useActionState(refreshAssetPrices, null);
  useToastResult(state);
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending} className="btn-ghost">
        <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
        {pending ? "Refreshing…" : "Refresh prices"}
      </button>
    </form>
  );
}

export function AssetDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteAsset, null);
  useToastResult(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="btn-danger"
        aria-label="Delete asset"
      >
        <Trash2 size={13} />
      </button>
    </form>
  );
}

export function AssetRow({
  row,
  baseDisplay,
}: {
  row: AssetRowData;
  baseDisplay: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateAsset, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <li className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{row.label}</div>
          <div className="text-xs text-neutral-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {row.category === "precious_metal" && row.metal && row.quantity && row.unit && (
              <span>
                {row.quantity} {row.unit} {METAL_LABEL[row.metal]}
                {row.pricePerOzUsd ? (
                  <>
                    {" @ "}
                    <Sensitive>
                      ${row.pricePerOzUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </Sensitive>
                    /oz
                  </>
                ) : (
                  ""
                )}
              </span>
            )}
            {row.category !== "precious_metal" && row.manualValue != null && (
              <span className="tabular-nums">
                <Sensitive>{row.manualValue.toLocaleString()}</Sensitive> {row.currency}
              </span>
            )}
            {row.acquiredOn && <span>· acquired {row.acquiredOn}</span>}
            {row.lastPricedAt && row.category === "precious_metal" && (
              <span>· priced {fmtDateTime(row.lastPricedAt)}</span>
            )}
            {row.note && <span className="truncate">· {row.note}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <span className="font-medium tabular-nums">
            <Sensitive>{baseDisplay}</Sensitive>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-ghost"
              aria-label="Edit asset"
            >
              <Pencil size={13} /> Edit
            </button>
            <AssetDeleteForm id={row.id} />
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="px-4 sm:px-5 py-4 bg-white/[0.02]">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="category" value={row.category} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2 min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Label</label>
            <input
              name="label"
              required
              defaultValue={row.label}
              aria-label="Label"
            />
          </div>
          <FieldsForCategory category={row.category} defaults={row} />
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Currency</label>
            <select
              name="currency"
              defaultValue={row.currency}
              aria-label="Currency"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Acquired on</label>
            <input
              name="acquiredOn"
              type="date"
              defaultValue={row.acquiredOn ?? ""}
              aria-label="Acquired on"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Cost basis</label>
            <input
              name="acquiredValue"
              type="number"
              step="0.01"
              defaultValue={row.acquiredValue ?? ""}
              aria-label="Cost basis"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4 min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
            <input
              name="note"
              defaultValue={row.note ?? ""}
              className="w-full"
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
