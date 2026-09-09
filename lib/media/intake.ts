// File intake: native open-dialog + drag-drop. In Tauri, HTML5 drop events
// are suppressed and real file paths arrive via the webview drag-drop event.

import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { MEDIA_KINDS } from "./presets";
import type { MediaKind } from "./types";

export function extOf(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function baseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  return norm.slice(norm.lastIndexOf("/") + 1);
}

/** Open the native picker filtered to the given kind's extensions. */
export async function pickFiles(kind: MediaKind): Promise<string[]> {
  const def = MEDIA_KINDS.find((k) => k.kind === kind)!;
  const picked = await open({
    title: `Add ${def.label.toLowerCase()}`,
    multiple: true,
    directory: false,
    filters: [{ name: def.label, extensions: def.extensions }],
  });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** Subscribe to native drag-drop. Returns an unlisten function. */
export async function onFilesDropped(
  cb: (paths: string[]) => void,
): Promise<() => void> {
  const webview = getCurrentWebview();
  return webview.onDragDropEvent((event) => {
    if (event.payload.type === "drop") cb(event.payload.paths);
  });
}
