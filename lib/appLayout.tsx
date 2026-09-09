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

type AppLayoutCtx = {
  // Edge-to-edge AND sidebar hidden — distraction-free "focus" mode.
  isFullWidth: boolean;
  setFullWidth: (v: boolean) => void;
  // Full width of the content area but the sidebar stays visible — drops
  // AppShell's centered max-w-6xl cap. Used by the media sections so their
  // rails/hero fill the whole pane (Apple-style) without hiding the nav.
  isWide: boolean;
  setWide: (v: boolean) => void;
};

const Ctx = createContext<AppLayoutCtx | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [isFullWidth, setFullWidthState] = useState(false);
  const [isWide, setWideState] = useState(false);
  const setFullWidth = useCallback((v: boolean) => setFullWidthState(v), []);
  const setWide = useCallback((v: boolean) => setWideState(v), []);
  const value = useMemo(
    () => ({ isFullWidth, setFullWidth, isWide, setWide }),
    [isFullWidth, setFullWidth, isWide, setWide],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppLayout(): AppLayoutCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppLayout must be used inside LayoutProvider");
  return ctx;
}

export function useFullWidth(active: boolean) {
  const { setFullWidth } = useAppLayout();
  useEffect(() => {
    setFullWidth(active);
    return () => setFullWidth(false);
  }, [active, setFullWidth]);
}

export function useWide(active: boolean) {
  const { setWide } = useAppLayout();
  useEffect(() => {
    setWide(active);
    return () => setWide(false);
  }, [active, setWide]);
}
