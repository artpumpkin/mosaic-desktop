"use client";
import { useActionState, useEffect, useState } from "react";
import { Plus, Check, RotateCcw, Trash2, Pencil, Save, X } from "lucide-react";
import {
  createDebt,
  toggleDebt,
  deleteDebt,
  updateDebt,
} from "@/lib/actions/debts";
import { useToastResult } from "./useToastResult";
import Sensitive from "@/components/Sensitive";

const currencies = ["MAD", "AED", "USD", "EUR"];

export function DebtCreateForm() {
  const [state, formAction, pending] = useActionState(createDebt, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Direction</label>
        <select name="direction" aria-label="Direction">
          <option value="i_owe">I owe</option>
          <option value="owed_to_me">Owed to me</option>
        </select>
      </div>
      <div className="col-span-2 lg:col-span-2 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Counterparty</label>
        <input name="counterparty" required placeholder="Name" aria-label="Counterparty" />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Amount</label>
        <input name="amount" type="number" step="0.01" required aria-label="Amount" />
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
        <label className="text-xs text-neutral-400 block mb-1.5">Due (optional)</label>
        <input name="dueOn" type="date" aria-label="Due date" />
      </div>
      <div className="col-span-2 lg:col-span-5 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
        <input name="note" aria-label="Note" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary col-span-2 lg:col-span-1 lg:col-start-6"
      >
        <Plus size={15} /> {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

export function DebtToggleForm({
  id,
  status,
  className,
}: {
  id: number;
  status: "open" | "settled";
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(toggleDebt, null);
  useToastResult(state);
  const next = status === "open" ? "settled" : "open";
  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        disabled={pending}
        className={className ? "btn-ghost w-full justify-center" : "btn-ghost"}
      >
        {status === "open" ? (
          <>
            <Check size={13} /> {pending ? "…" : "Settle"}
          </>
        ) : (
          <>
            <RotateCcw size={13} /> {pending ? "…" : "Reopen"}
          </>
        )}
      </button>
    </form>
  );
}

export function DebtDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteDebt, null);
  useToastResult(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger" aria-label="Delete debt">
        <Trash2 size={13} />
      </button>
    </form>
  );
}

export type DebtRowData = {
  id: number;
  direction: "i_owe" | "owed_to_me";
  counterparty: string;
  amount: number;
  currency: string;
  dueOn: string | null;
  status: "open" | "settled";
  note: string | null;
};

function statusBadge(status: "open" | "settled", size: "xs" | "tiny") {
  const cls =
    status === "settled"
      ? "bg-white/5 text-neutral-400 border-white/5"
      : "bg-amber-500/10 text-amber-300 border-amber-400/20";
  const sizeCls = size === "tiny" ? "text-[10px]" : "text-xs";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md border ${cls} ${sizeCls}`}
    >
      {status}
    </span>
  );
}

export function DebtRowDesktop({
  row,
  baseDisplay,
}: {
  row: DebtRowData;
  baseDisplay: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateDebt, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <tr className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
        <td className="px-5 py-3">{row.counterparty}</td>
        <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
          <Sensitive>
            {row.amount.toLocaleString()} {row.currency}
          </Sensitive>
        </td>
        <td className="px-5 py-3 text-right text-neutral-500 tabular-nums whitespace-nowrap">
          <Sensitive>{baseDisplay}</Sensitive>
        </td>
        <td className="px-5 py-3 text-neutral-400 whitespace-nowrap">
          {row.dueOn || ""}
        </td>
        <td className="px-5 py-3">{statusBadge(row.status, "xs")}</td>
        <td className="px-5 py-3 text-neutral-500">{row.note}</td>
        <td className="px-5 py-3 text-right">
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="btn-ghost"
              aria-label="Edit debt"
            >
              <Pencil size={13} /> Edit
            </button>
            <DebtToggleForm id={row.id} status={row.status} />
            <DebtDeleteForm id={row.id} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-white/[0.04] last:border-0 bg-white/[0.02]">
      <td colSpan={7} className="px-5 py-3">
        <form
          action={formAction}
          className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end"
        >
          <input type="hidden" name="id" value={row.id} />
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Direction
            </label>
            <select
              name="direction"
              defaultValue={row.direction}
              aria-label="Direction"
            >
              <option value="i_owe">I owe</option>
              <option value="owed_to_me">Owed to me</option>
            </select>
          </div>
          <div className="col-span-2 lg:col-span-2 min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Counterparty
            </label>
            <input
              name="counterparty"
              required
              defaultValue={row.counterparty}
              aria-label="Counterparty"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Amount
            </label>
            <input
              name="amount"
              type="number"
              step="0.01"
              required
              defaultValue={row.amount}
              aria-label="Amount"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">
              Currency
            </label>
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
            <label className="text-xs text-neutral-400 block mb-1.5">Due</label>
            <input
              name="dueOn"
              type="date"
              defaultValue={row.dueOn ?? ""}
              aria-label="Due date"
            />
          </div>
          <div className="col-span-2 lg:col-span-4 min-w-0">
            <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
            <input name="note" defaultValue={row.note ?? ""} aria-label="Note" />
          </div>
          <div className="col-span-2 lg:col-span-2 flex gap-2 lg:justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-ghost flex-1 lg:flex-initial justify-center"
            >
              <X size={13} /> Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="btn-primary flex-1 lg:flex-initial"
            >
              <Save size={13} /> {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function DebtRowMobile({
  row,
  baseDisplay,
}: {
  row: DebtRowData;
  baseDisplay: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateDebt, null);
  useToastResult(state);
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <li className="px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{row.counterparty}</span>
              {statusBadge(row.status, "tiny")}
            </div>
            <div className="text-sm tabular-nums mt-0.5">
              <Sensitive>
                {row.amount.toLocaleString()} {row.currency}
              </Sensitive>{" "}
              <span className="text-neutral-500">
                · <Sensitive>{baseDisplay}</Sensitive>
              </span>
            </div>
            {row.dueOn && (
              <div className="text-[11px] text-neutral-500 mt-0.5">
                due {row.dueOn}
              </div>
            )}
            {row.note && (
              <div className="text-xs text-neutral-500 mt-0.5 break-words">
                {row.note}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn-ghost flex-1 justify-center"
          >
            <Pencil size={13} /> Edit
          </button>
          <DebtToggleForm id={row.id} status={row.status} className="flex-1" />
          <DebtDeleteForm id={row.id} />
        </div>
      </li>
    );
  }

  return (
    <li className="px-4 py-3 bg-white/[0.02]">
      <form action={formAction} className="grid grid-cols-2 gap-2.5">
        <input type="hidden" name="id" value={row.id} />
        <div className="col-span-2 min-w-0">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Counterparty
          </label>
          <input
            name="counterparty"
            required
            defaultValue={row.counterparty}
            aria-label="Counterparty"
          />
        </div>
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Direction
          </label>
          <select name="direction" defaultValue={row.direction} aria-label="Direction">
            <option value="i_owe">I owe</option>
            <option value="owed_to_me">Owed to me</option>
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
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
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Amount
          </label>
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            defaultValue={row.amount}
            aria-label="Amount"
          />
        </div>
        <div className="min-w-0">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Due
          </label>
          <input
            name="dueOn"
            type="date"
            defaultValue={row.dueOn ?? ""}
            aria-label="Due date"
          />
        </div>
        <div className="col-span-2 min-w-0">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Note
          </label>
          <input name="note" defaultValue={row.note ?? ""} aria-label="Note" />
        </div>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="btn-ghost justify-center"
        >
          <X size={13} /> Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          <Save size={13} /> {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </li>
  );
}
