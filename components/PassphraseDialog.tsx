"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, X } from "lucide-react";

type Mode = "export" | "import";

export type PassphraseDialogProps = {
  open: boolean;
  mode: Mode;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
};

export default function PassphraseDialog({
  open,
  mode,
  onSubmit,
  onCancel,
}: PassphraseDialogProps) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPass("");
      setConfirm("");
      setError(null);
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass) {
      setError("Passphrase is required");
      return;
    }
    if (mode === "export") {
      if (pass.length < 8) {
        setError("Use at least 8 characters");
        return;
      }
      if (pass !== confirm) {
        setError("Passphrases don't match");
        return;
      }
    }
    onSubmit(pass);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={submit}
        className="relative w-[min(420px,92vw)] rounded-2xl border border-white/10 bg-neutral-950/95 p-5 shadow-2xl"
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-3 right-3 text-neutral-500 hover:text-neutral-200"
          aria-label="Cancel"
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-2 mb-1.5">
          <KeyRound size={16} className="text-violet-300" />
          <h2 className="font-medium">
            {mode === "export" ? "Encrypt backup" : "Decrypt backup"}
          </h2>
        </div>
        <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
          {mode === "export"
            ? "Choose a passphrase. You'll need it to import this backup on another device. There's no recovery if you forget it."
            : "Enter the passphrase used when this backup was created."}
        </p>
        <label className="text-xs text-neutral-400 block mb-1.5">Passphrase</label>
        <input
          ref={inputRef}
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mb-3"
        />
        {mode === "export" && (
          <>
            <label className="text-xs text-neutral-400 block mb-1.5">
              Confirm passphrase
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mb-3"
            />
          </>
        )}
        {error && (
          <div className="mb-3 px-2.5 py-1.5 rounded-md text-xs text-rose-300 bg-rose-500/10 border border-rose-400/20">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {mode === "export" ? "Encrypt & save" : "Decrypt & import"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
