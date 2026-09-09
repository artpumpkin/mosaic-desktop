// Suwayomi-Server (Tachidesk) extension-management REST helpers.
//
// Suwayomi runs the actual Tachiyomi/Mihon `.apk` extensions (e.g. the
// Keiyoushi catalogue) server-side. These helpers let Mosaic browse, install
// and uninstall those extensions on the user's server — the desktop
// equivalent of Mihon's extension list. The server must have an extension
// repository configured (e.g. Keiyoushi:
// https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json).

import { mfetch } from "./fetch";

export type SuwayomiExtension = {
  pkgName: string;
  name: string;
  lang: string;
  versionName?: string;
  isNsfw?: boolean;
  installed?: boolean;
  hasUpdate?: boolean;
  obsolete?: boolean;
  iconUrl?: string;
  repo?: string | null;
};

function base(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

export async function listSuwayomiExtensions(
  serverUrl: string,
): Promise<SuwayomiExtension[]> {
  const r = await mfetch(`${base(serverUrl)}/api/v1/extension/list`);
  if (!r.ok) throw new Error(`Suwayomi responded ${r.status}`);
  const json = (await r.json()) as SuwayomiExtension[];
  return Array.isArray(json) ? json : [];
}

// Install/uninstall: older Suwayomi uses GET, newer may use POST — try both.
async function hit(url: string): Promise<void> {
  let r = await mfetch(url, { method: "GET" });
  if (r.ok) return;
  if (r.status === 404 || r.status === 405) {
    r = await mfetch(url, { method: "POST" });
    if (r.ok) return;
  }
  throw new Error(`HTTP ${r.status}`);
}

export async function installSuwayomiExtension(
  serverUrl: string,
  pkgName: string,
): Promise<void> {
  await hit(`${base(serverUrl)}/api/v1/extension/install/${pkgName}`);
}

export async function uninstallSuwayomiExtension(
  serverUrl: string,
  pkgName: string,
): Promise<void> {
  await hit(`${base(serverUrl)}/api/v1/extension/uninstall/${pkgName}`);
}

export function suwayomiExtIcon(
  serverUrl: string,
  ext: SuwayomiExtension,
): string | null {
  if (!ext.iconUrl) return null;
  return ext.iconUrl.startsWith("http")
    ? ext.iconUrl
    : `${base(serverUrl)}${ext.iconUrl}`;
}

export const KEIYOUSHI_REPO_URL =
  "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json";
