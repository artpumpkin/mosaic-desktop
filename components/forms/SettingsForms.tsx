"use client";
import { useActionState, useEffect, useState } from "react";
import { Save, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  updateBaseCurrency,
  updateAlchemyApiKey,
  updateRealDebridApiKey,
  updateUnitsPreference,
} from "@/lib/actions/settings";
import { validateToken, formatExpiry, type RdUser } from "@/lib/movies/realdebrid";
import { useToastResult } from "./useToastResult";

const currencies = ["MAD", "AED", "USD", "EUR"];

export function BaseCurrencyForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState(updateBaseCurrency, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-[1fr_auto] gap-2 items-end max-w-sm"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Base currency
        </label>
        <select
          name="baseCurrency"
          defaultValue={current}
          aria-label="Base currency"
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        <Save size={15} /> {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function AlchemyKeyForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState(updateAlchemyApiKey, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-[1fr_auto] gap-2 items-end max-w-xl"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          API key
        </label>
        <input
          name="alchemyApiKey"
          type="password"
          defaultValue={current}
          placeholder="Paste your Alchemy API key"
          aria-label="Alchemy API key"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        <Save size={15} /> {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

export function RealDebridKeyForm({ current }: { current: string }) {
  const [state, formAction, pending] = useActionState(updateRealDebridApiKey, null);
  useToastResult(state);

  // Validate the saved token on mount + after every successful save so the
  // user sees "Connected as foo (premium until 2026-…)" feedback.
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ok"; user: RdUser }
    | { kind: "err"; message: string }
  >({ kind: current ? "loading" : "idle" });

  useEffect(() => {
    if (!current) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "loading" });
    let cancelled = false;
    validateToken(current)
      .then((user) => {
        if (!cancelled) setStatus({ kind: "ok", user });
      })
      .catch((e) => {
        if (!cancelled)
          setStatus({
            kind: "err",
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [current, state?.ok]);

  return (
    <div className="space-y-2 max-w-xl">
      <form
        action={formAction}
        className="grid grid-cols-[1fr_auto] gap-2 items-end"
      >
        <div className="min-w-0">
          <label className="text-xs text-neutral-400 block mb-1.5">
            API token
          </label>
          <input
            name="realDebridApiKey"
            type="password"
            defaultValue={current}
            placeholder="Paste your Real-Debrid API token"
            aria-label="Real-Debrid API token"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" disabled={pending} className="btn-primary">
          <Save size={15} /> {pending ? "Saving…" : "Save"}
        </button>
      </form>

      {status.kind === "loading" && (
        <div className="text-[12px] text-neutral-400 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Checking token…
        </div>
      )}
      {status.kind === "ok" && (
        <div className="text-[12px] text-emerald-300 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> Connected as{" "}
          <span className="font-medium">{status.user.username}</span>
          {status.user.type === "premium" && (
            <span className="text-neutral-400">
              · premium until {formatExpiry(status.user)}
            </span>
          )}
          {status.user.type !== "premium" && (
            <span className="text-amber-300/90">· free tier</span>
          )}
        </div>
      )}
      {status.kind === "err" && (
        <div className="text-[12px] text-rose-300 flex items-center gap-1.5">
          <XCircle size={12} /> {status.message}
        </div>
      )}
    </div>
  );
}

export function UnitsPreferenceForm({ current }: { current: "metric" | "imperial" }) {
  const [state, formAction, pending] = useActionState(updateUnitsPreference, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      className="grid grid-cols-[1fr_auto] gap-2 items-end max-w-sm"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Units</label>
        <select
          name="unitsPreference"
          defaultValue={current}
          aria-label="Units preference"
        >
          <option value="metric">Metric (kg, cm)</option>
          <option value="imperial">Imperial (lb, ft/in)</option>
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        <Save size={15} /> {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
