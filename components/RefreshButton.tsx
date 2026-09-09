"use client";
import { useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { refreshAll } from "@/lib/refresh";
import { invalidate } from "@/lib/query/bus";

export default function RefreshButton() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null,
  );

  const onClick = async () => {
    setRunning(true);
    setStatus(null);
    try {
      const data = await refreshAll();
      setStatus({
        kind: "ok",
        msg:
          `Synced ${data.successes} source${data.successes === 1 ? "" : "s"}` +
          (data.failures ? `, ${data.failures} failed` : ""),
      });
      invalidate("*");
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Refresh failed",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={running}
        className="btn-primary"
      >
        <RefreshCw size={16} className={clsx(running && "animate-spin")} />
        {running ? "Refreshing..." : "Refresh all"}
      </button>
      {status && (
        <span
          className={clsx(
            "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border animate-fade-in-up",
            status.kind === "ok"
              ? "text-emerald-300 bg-emerald-500/10 border-emerald-400/20"
              : "text-rose-300 bg-rose-500/10 border-rose-400/20",
          )}
        >
          {status.kind === "ok" ? (
            <CheckCircle2 size={13} />
          ) : (
            <AlertTriangle size={13} />
          )}
          {status.msg}
        </span>
      )}
    </div>
  );
}
