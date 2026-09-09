"use client";
import { useCallback, useState } from "react";
import clsx from "clsx";
import {
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

import { cancelInstall, formatBytes, installTool, uninstallTool } from "@/lib/media/engine";
import type { InstallProgress, ToolInfo, ToolName } from "@/lib/media/types";
import { toast } from "@/lib/toast";

const LABELS: Record<string, string> = {
  ffmpeg: "ffmpeg",
  ffprobe: "ffprobe",
  magick: "ImageMagick",
  gs: "Ghostscript",
  "realesrgan-ncnn-vulkan": "Real-ESRGAN",
};

export default function ToolStatus({
  tools,
  onChanged,
}: {
  tools: ToolInfo[];
  /** Re-fetch tool status after an install / uninstall completes. */
  onChanged?: () => void;
}) {
  // In-flight installs, keyed by tool name → latest progress event.
  const [progress, setProgress] = useState<Partial<Record<ToolName, InstallProgress>>>({});

  const setProg = useCallback((tool: ToolName, p: InstallProgress | undefined) => {
    setProgress((prev) => {
      const next = { ...prev };
      if (p) next[tool] = p;
      else delete next[tool];
      return next;
    });
  }, []);

  const install = useCallback(
    async (tool: ToolName) => {
      setProg(tool, { type: "downloading", received: 0, total: 0 });
      let terminal: InstallProgress | undefined;
      try {
        await installTool(tool, (p) => {
          if (p.type === "done" || p.type === "failed" || p.type === "canceled") terminal = p;
          setProg(tool, p);
        });
        if (terminal?.type === "done") toast("ok", `${LABELS[tool] ?? tool} installed`);
        else if (terminal?.type === "failed") toast("err", terminal.message);
      } catch (e) {
        toast("err", e instanceof Error ? e.message : `Could not install ${tool}`);
      } finally {
        setProg(tool, undefined);
        onChanged?.();
      }
    },
    [onChanged, setProg],
  );

  const cancel = useCallback((tool: ToolName) => {
    cancelInstall(tool).catch(() => {});
  }, []);

  const remove = useCallback(
    async (tool: ToolName) => {
      try {
        await uninstallTool(tool);
        toast("ok", `${LABELS[tool] ?? tool} removed`);
      } catch (e) {
        toast("err", e instanceof Error ? e.message : "Could not uninstall");
      }
      onChanged?.();
    },
    [onChanged],
  );

  const copyHint = useCallback((hint: string) => {
    navigator.clipboard?.writeText(hint).then(
      () => toast("ok", "Copied"),
      () => {},
    );
  }, []);

  if (tools.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tools.map((t) => {
        const label = LABELS[t.name] ?? t.name;
        const p = progress[t.name as ToolName];

        // Installing: download bar / extracting state.
        if (p && (p.type === "downloading" || p.type === "extracting")) {
          const pct =
            p.type === "downloading" && p.total > 0
              ? Math.min(100, Math.round((p.received / p.total) * 100))
              : null;
          return (
            <span
              key={t.name}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border bg-violet-500/10 border-violet-400/25 text-violet-200"
            >
              <Loader2 size={11} className="animate-spin" />
              {label}
              <span className="tabular-nums text-violet-300/80">
                {p.type === "extracting"
                  ? "extracting…"
                  : pct != null
                    ? `${pct}%`
                    : formatBytes(p.received)}
              </span>
              <button
                type="button"
                onClick={() => cancel(t.name as ToolName)}
                className="ml-0.5 text-violet-300/70 hover:text-violet-100"
                title="Cancel"
              >
                <XCircle size={12} />
              </button>
            </span>
          );
        }

        // Available: green chip; show source + version on hover. Managed
        // installs get an uninstall affordance.
        if (t.available) {
          const where = t.source === "path" ? "on system" : "installed";
          const size = t.sizeBytes ? ` · ${formatBytes(t.sizeBytes)}` : "";
          return (
            <span
              key={t.name}
              title={`${t.version ?? where}${t.source === "managed" ? `${size}` : ""}`}
              className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-emerald-500/10 border-emerald-400/20 text-emerald-300"
            >
              <CheckCircle2 size={11} />
              {label}
              {t.source === "path" && (
                <span className="text-emerald-400/60">· system</span>
              )}
              {t.source === "managed" && (
                <button
                  type="button"
                  onClick={() => remove(t.name as ToolName)}
                  className="ml-0.5 hidden group-hover:inline text-emerald-300/60 hover:text-rose-300"
                  title="Uninstall"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </span>
          );
        }

        // Missing + installable: Install button.
        if (t.installable) {
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => install(t.name as ToolName)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-amber-500/10 border-amber-400/25 text-amber-200 hover:bg-amber-500/20 transition-colors"
              title={`Install ${label}`}
            >
              <Download size={11} />
              Install {label}
            </button>
          );
        }

        // Missing + not installable: hint to install via package manager.
        return (
          <span
            key={t.name}
            title={t.hint ?? "not installed"}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-rose-500/10 border-rose-400/20 text-rose-300/90"
          >
            <XCircle size={11} />
            {label}
            {t.hint && (
              <button
                type="button"
                onClick={() => copyHint(t.hint!)}
                className="ml-0.5 inline-flex items-center gap-0.5 text-rose-300/70 hover:text-rose-100"
                title={`Copy: ${t.hint}`}
              >
                <code className="text-[10px]">{t.hint}</code>
                <Copy size={10} />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
