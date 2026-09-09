"use client";
import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createIncome, deleteIncome } from "@/lib/actions/income";
import { useToastResult } from "./useToastResult";

const currencies = ["MAD", "AED", "USD", "EUR"];

export function IncomeCreateForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(createIncome, null);
  useToastResult(state);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div className="col-span-2 lg:col-span-2 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">Source</label>
          <input name="source" required placeholder="Salary, freelance, ..." aria-label="Source" />
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
        <label className="text-sm flex items-center gap-2 lg:self-center lg:mt-5 text-neutral-300">
          <input type="checkbox" name="recurring" />
          Recurring
        </label>
        <div className="col-span-2 lg:col-span-6 min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            Note <span className="text-neutral-600">(optional)</span>
          </label>
          <input name="note" placeholder="Optional" className="w-full" aria-label="Note" />
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

export function IncomeDeleteForm({
  id,
  className,
}: {
  id: number;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(deleteIncome, null);
  useToastResult(state);
  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger" aria-label="Delete income">
        <Trash2 size={13} />
      </button>
    </form>
  );
}
