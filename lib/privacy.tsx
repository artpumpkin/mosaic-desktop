"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "mosaic.privacy";

type PrivacyCtx = {
  // When true, monetary amounts are masked (blurred) across the app.
  hidden: boolean;
  toggle: () => void;
  setHidden: (v: boolean) => void;
};

const Ctx = createContext<PrivacyCtx | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHiddenState] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      setHiddenState(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const persist = (v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const setHidden = useCallback((v: boolean) => {
    setHiddenState(v);
    persist(v);
  }, []);

  const toggle = useCallback(() => {
    setHiddenState((prev) => {
      const next = !prev;
      persist(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ hidden, toggle, setHidden }),
    [hidden, toggle, setHidden],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrivacy(): PrivacyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrivacy must be used inside PrivacyProvider");
  return ctx;
}
