export type ToastKind = "ok" | "err";

export type Toast = {
  id: number;
  kind: ToastKind;
  msg: string;
};

type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function toast(kind: ToastKind, msg: string): void {
  const t: Toast = { id: nextId++, kind, msg };
  for (const fn of listeners) fn(t);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
