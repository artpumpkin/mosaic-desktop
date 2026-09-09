import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { exportToJson, importFromJson, type ImportSummary } from "./serialize";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from "./backupCrypto";

function defaultFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `finance-tracker-${stamp}.json`;
}

export async function exportToFile(passphrase: string): Promise<string | null> {
  if (!passphrase) throw new Error("Passphrase required");
  const path = await save({
    title: "Export finance data",
    defaultPath: defaultFilename(),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  const inner = await exportToJson();
  const envelope = await encryptBackup(inner, passphrase);
  await invoke("write_text_file", {
    path,
    contents: JSON.stringify(envelope, null, 2),
  });
  return path;
}

/**
 * Read+parse an import file. Returns either:
 *   { kind: "plaintext", path, contents } — caller can hand `contents` to importFromJson
 *   { kind: "encrypted", path, envelope } — caller must prompt for passphrase, then call decryptAndImport
 * Returns null if the user cancelled the dialog.
 */
export async function pickImportFile(): Promise<
  | { kind: "plaintext"; path: string; contents: string }
  | { kind: "encrypted"; path: string; envelope: EncryptedEnvelope }
  | null
> {
  const picked = await open({
    title: "Import finance data",
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!picked || typeof picked !== "string") return null;
  const contents = await invoke<string>("read_text_file", { path: picked });
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("File is not valid JSON");
  }
  if (isEncryptedEnvelope(parsed)) {
    return { kind: "encrypted", path: picked, envelope: parsed };
  }
  return { kind: "plaintext", path: picked, contents };
}

export async function importPlaintext(contents: string): Promise<ImportSummary> {
  return importFromJson(contents);
}

export async function importEncrypted(
  envelope: EncryptedEnvelope,
  passphrase: string,
): Promise<ImportSummary> {
  const inner = await decryptBackup(envelope, passphrase);
  return importFromJson(inner);
}
