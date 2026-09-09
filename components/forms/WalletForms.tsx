"use client";
import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createWallet, deleteWallet } from "@/lib/actions/wallets";
import { useToastResult } from "./useToastResult";

export function WalletCreateForm() {
  const [state, formAction, pending] = useActionState(createWallet, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-1 md:grid-cols-[1fr_3fr_auto] gap-3 items-end"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Label</label>
        <input name="label" required placeholder="Hot wallet" className="w-full" aria-label="Wallet label" />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Address</label>
        <input
          name="address"
          required
          placeholder="0x..."
          className="w-full font-mono text-xs"
          aria-label="Ethereum address"
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        <Plus size={15} /> {pending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}

export function WalletDeleteForm({ id }: { id: number }) {
  const [state, formAction, pending] = useActionState(deleteWallet, null);
  useToastResult(state);
  return (
    <form action={formAction} className="mt-1.5">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="btn-danger">
        <Trash2 size={14} /> {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}
