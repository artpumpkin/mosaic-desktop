"use client";
import { useActionState } from "react";
import { Plus, Target, Trash2 } from "lucide-react";
import {
  createExpense,
  deleteExpense,
  upsertBudget,
  deleteBudget,
} from "@/lib/actions/expenses";
import { useToastResult } from "./useToastResult";

const currencies = ["MAD", "AED", "USD", "EUR"];

export function ExpenseCreateForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(createExpense, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end"
    >
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Category</label>
        <input name="category" required placeholder="Food, Rent, ..." aria-label="Category" />
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
        <label className="text-xs text-neutral-400 block mb-1.5">Date</label>
        <input name="occurredOn" type="date" defaultValue={today} max={today} aria-label="Date" />
      </div>
      <div className="col-span-2 lg:col-span-1 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Note</label>
        <input name="note" aria-label="Note" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="btn-primary col-span-2 lg:col-span-1"
      >
        <Plus size={15} /> {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

export function ExpenseDeleteForm({
  id,
  className,
}: {
  id: number;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(deleteExpense, null);
  useToastResult(state);
  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger" aria-label="Delete expense">
        <Trash2 size={13} />
      </button>
    </form>
  );
}

export function BudgetUpsertForm() {
  const [state, formAction, pending] = useActionState(upsertBudget, null);
  useToastResult(state);
  return (
    <form action={formAction} className="flex gap-3 mb-6 items-end flex-wrap">
      <div className="flex-1 min-w-[140px]">
        <label className="text-xs text-neutral-400 block mb-1.5">Category</label>
        <input name="category" required placeholder="e.g. Food" aria-label="Budget category" />
      </div>
      <div className="flex-1 min-w-[180px]">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Monthly budget (MAD)
        </label>
        <input name="monthlyAmountMad" type="number" step="0.01" required aria-label="Monthly budget in MAD" />
      </div>
      <button type="submit" disabled={pending} className="btn-ghost">
        <Target size={13} /> {pending ? "Saving…" : "Set budget"}
      </button>
    </form>
  );
}

export function BudgetDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteBudget, null);
  useToastResult(state);
  return (
    <form action={formAction} className="mt-1.5">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-[11px] text-neutral-500 hover:text-rose-300"
      >
        {pending ? "Removing…" : "Remove budget"}
      </button>
    </form>
  );
}
