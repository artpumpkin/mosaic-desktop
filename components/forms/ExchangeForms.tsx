"use client";
import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createExchange, deleteExchange } from "@/lib/actions/exchanges";
import { useToastResult } from "./useToastResult";

export function ExchangeCreateForm() {
  const [state, formAction, pending] = useActionState(createExchange, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-2 lg:grid-cols-6 gap-3 items-end"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Exchange</label>
        <select name="exchange" aria-label="Exchange">
          <option value="binance">Binance</option>
          <option value="okx">OKX</option>
        </select>
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Label</label>
        <input name="label" required placeholder="Main" aria-label="Account label" />
      </div>
      <div className="col-span-2 lg:col-span-2 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">API Key</label>
        <input name="apiKey" required className="font-mono text-xs" aria-label="API key" />
      </div>
      <div className="col-span-2 lg:col-span-2 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">API Secret</label>
        <input
          name="apiSecret"
          type="password"
          required
          className="font-mono text-xs"
          aria-label="API secret"
        />
      </div>
      <div className="col-span-2 lg:col-span-2 min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Passphrase (OKX only)
        </label>
        <input name="passphrase" type="password" className="font-mono text-xs" aria-label="Passphrase (OKX only)" />
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

export function ExchangeDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteExchange, null);
  useToastResult(state);
  return (
    <form action={formAction} className="mt-1.5">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger">
        <Trash2 size={12} /> {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}
