"use client";
import { useCallback, useEffect, useState } from "react";
import { subscribe } from "./bus";
import { toast } from "@/lib/toast";

export function useFinanceData<T>(
  keys: string[],
  loader: () => Promise<T>,
): { data: T | null; isLoading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setError(msg);
          toast("err", msg);
        }
        console.error("[useFinanceData] load failed", keys, e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cleanup = reload();
    const off = subscribe(keys, () => {
      reload();
    });
    return () => {
      cleanup();
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join("|")]);

  return { data, isLoading, error, reload };
}
