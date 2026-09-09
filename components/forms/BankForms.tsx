"use client";
import { useActionState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { createBank, updateBank, deleteBank } from "@/lib/actions/banks";
import { fmtDateTime } from "@/lib/format";
import { useToastResult } from "./useToastResult";
import Sensitive from "@/components/Sensitive";

const currencies = ["MAD", "AED", "USD", "EUR"];

export function BankCreateForm() {
  const [state, formAction, pending] = useActionState(createBank, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-2 lg:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] gap-3 items-end"
    >
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Label</label>
        <input name="label" required placeholder="e.g. Attijariwafa MAD" aria-label="Bank label" />
      </div>
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
        <label className="text-xs text-neutral-400 block mb-1.5">Balance</label>
        <input name="balance" type="number" step="0.01" required defaultValue="0" aria-label="Balance" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary col-span-2 lg:col-span-1"
      >
        <Plus size={15} />
        {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

export type BankRowProps = {
  row: {
    id: number;
    label: string;
    currency: string;
    balance: number;
    updatedAt: string;
  };
  baseDisplay: string;
};

export function BankRow({ row, baseDisplay }: BankRowProps) {
  const [updateState, updateAction, updatePending] = useActionState(updateBank, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteBank, null);
  useToastResult(updateState);
  useToastResult(deleteState);
  const busy = updatePending || deletePending;
  return (
    <form
      action={updateAction}
      className="grid grid-cols-2 lg:grid-cols-[minmax(0,2fr)_110px_140px_minmax(0,1fr)_auto] gap-2.5 lg:gap-3 lg:items-center"
    >
      <input type="hidden" name="id" value={row.id} />
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <label className="text-[10px] uppercase tracking-wider text-neutral-500 lg:hidden">
          Label
        </label>
        <input name="label" defaultValue={row.label} required aria-label="Bank label" />
      </div>
      <div className="min-w-0">
        <label className="text-[10px] uppercase tracking-wider text-neutral-500 lg:hidden">
          Currency
        </label>
        <select name="currency" defaultValue={row.currency} aria-label="Currency">
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0">
        <label className="text-[10px] uppercase tracking-wider text-neutral-500 lg:hidden">
          Balance
        </label>
        <input
          name="balance"
          type="number"
          step="0.01"
          defaultValue={row.balance}
          required
          className="text-right"
          aria-label="Balance"
        />
      </div>
      <div className="col-span-2 lg:col-span-1 text-xs text-neutral-500 lg:text-right min-w-0">
        <span className="text-neutral-300 tabular-nums">
          <Sensitive>{baseDisplay}</Sensitive>
        </span>
        <span className="lg:hidden"> · </span>
        <span className="hidden lg:inline">
          <br />
        </span>
        {fmtDateTime(row.updatedAt)}
      </div>
      <div className="col-span-2 lg:col-span-1 flex gap-2 lg:justify-end">
        <button
          type="submit"
          disabled={busy}
          className="btn-ghost flex-1 lg:flex-initial justify-center"
        >
          <Save size={13} /> {updatePending ? "Saving…" : "Save"}
        </button>
        <button
          type="submit"
          formAction={deleteAction}
          disabled={busy}
          className="btn-danger flex-1 lg:flex-initial justify-center"
        >
          <Trash2 size={13} /> {deletePending ? "…" : "Delete"}
        </button>
      </div>
    </form>
  );
}
