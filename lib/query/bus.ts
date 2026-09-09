"use client";
import { useEffect } from "react";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

const ALL = "*";

export function invalidate(...keys: string[]) {
  const targets = new Set<Listener>();
  for (const cb of listeners.get(ALL) ?? []) targets.add(cb);
  for (const k of keys) {
    for (const cb of listeners.get(k) ?? []) targets.add(cb);
  }
  for (const cb of targets) cb();
}

export function subscribe(keys: string[], cb: Listener): () => void {
  const watched = keys.length ? keys : [ALL];
  for (const k of watched) {
    if (!listeners.has(k)) listeners.set(k, new Set());
    listeners.get(k)!.add(cb);
  }
  return () => {
    for (const k of watched) listeners.get(k)?.delete(cb);
  };
}

export function useInvalidation(keys: string[], cb: () => void) {
  useEffect(() => {
    const off = subscribe(keys, cb);
    return off;
  }, [keys.join("|"), cb]);
}
