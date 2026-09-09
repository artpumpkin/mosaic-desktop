"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import clsx from "clsx";
import { subscribeToasts, type Toast } from "@/lib/toast";

const AUTO_DISMISS_MS = 4000;

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, AUTO_DISMISS_MS);
    });
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[calc(100vw-2rem)] sm:max-w-sm pointer-events-none"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "err" ? "alert" : "status"}
          className={clsx(
            "pointer-events-auto flex items-start gap-2 px-3 py-2.5 rounded-lg border backdrop-blur-md shadow-lg text-sm animate-fade-in-up",
            t.kind === "ok"
              ? "text-emerald-200 bg-emerald-500/10 border-emerald-400/30"
              : "text-rose-200 bg-rose-500/10 border-rose-400/30"
          )}
        >
          {t.kind === "ok" ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1 break-words">{t.msg}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
