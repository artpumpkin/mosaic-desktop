"use client";
import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import type { ActionResult } from "@/lib/actions/result";

export function useToastResult(state: ActionResult | null) {
  const seen = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    toast(state.ok ? "ok" : "err", state.ok ? state.message ?? "Saved" : state.error);
  }, [state]);
}
