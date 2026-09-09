"use client";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  exportToFile,
  pickImportFile,
  importPlaintext,
  importEncrypted,
} from "@/lib/io/file";
import type { EncryptedEnvelope } from "@/lib/io/backupCrypto";
import type { ImportSummary } from "@/lib/io/serialize";
import { invalidate } from "@/lib/query/bus";
import { toast } from "@/lib/toast";
import PassphraseDialog from "@/components/PassphraseDialog";

type Mode = "export" | "import";

type PendingImport = { envelope: EncryptedEnvelope; path: string };

function summaryText(s: ImportSummary): string {
  const entries = Object.entries(s)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  return entries.length ? entries.join(", ") : "nothing";
}

export function DataIO() {
  const [busy, setBusy] = useState<Mode | null>(null);
  const [askingMode, setAskingMode] = useState<Mode | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const onExport = async () => {
    setAskingMode("export");
  };

  const onImport = async () => {
    setBusy("import");
    try {
      const result = await pickImportFile();
      if (!result) return;
      if (result.kind === "encrypted") {
        setPendingImport({ envelope: result.envelope, path: result.path });
        setAskingMode("import");
        return;
      }
      // plaintext path (legacy or unencrypted migration.json)
      const ok = await confirm(
        "This will replace the finance, health and settings tables included in this backup. Media and rental data are unchanged. Continue?",
        { title: "Import data", kind: "warning" },
      );
      if (!ok) return;
      const summary = await importPlaintext(result.contents);
      toast("ok", `Imported ${summaryText(summary)}`);
      invalidate("*");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const onPassphrase = async (pass: string) => {
    const mode = askingMode;
    setAskingMode(null);
    if (mode === "export") {
      setBusy("export");
      try {
        const path = await exportToFile(pass);
        if (path) toast("ok", `Exported (encrypted) to ${path}`);
      } catch (e) {
        toast("err", e instanceof Error ? e.message : "Export failed");
      } finally {
        setBusy(null);
      }
    } else if (mode === "import" && pendingImport) {
      const target = pendingImport;
      setPendingImport(null);
      const ok = await confirm(
        "This will replace the finance, health and settings tables included in this backup. Media and rental data are unchanged. Continue?",
        { title: "Import data", kind: "warning" },
      );
      if (!ok) {
        setBusy(null);
        return;
      }
      try {
        const summary = await importEncrypted(target.envelope, pass);
        toast("ok", `Imported ${summaryText(summary)}`);
        invalidate("*");
      } catch (e) {
        toast("err", e instanceof Error ? e.message : "Import failed");
      } finally {
        setBusy(null);
      }
    }
  };

  const onCancelPass = () => {
    setAskingMode(null);
    setPendingImport(null);
    setBusy(null);
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExport}
          disabled={busy !== null}
          className="btn-ghost"
        >
          <Download size={15} />
          {busy === "export" ? "Exporting…" : "Export encrypted JSON"}
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy !== null}
          className="btn-ghost"
        >
          <Upload size={15} />
          {busy === "import" ? "Importing…" : "Import JSON"}
        </button>
      </div>
      <PassphraseDialog
        open={askingMode !== null}
        mode={askingMode ?? "export"}
        onSubmit={onPassphrase}
        onCancel={onCancelPass}
      />
    </>
  );
}
