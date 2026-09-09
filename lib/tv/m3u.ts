export type M3uEntry = {
  url: string;
  name: string;
  tvgId?: string;
  tvgLogo?: string;
  groupTitle?: string;
  country?: string;
  language?: string;
};

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

function parseAttrs(tail: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(tail))) out[m[1]] = m[2];
  return out;
}

// Standard M3U/M3U8 with iptv extensions:
//   #EXTM3U
//   #EXTINF:-1 tvg-id="..." tvg-logo="..." group-title="...",Channel Name
//   http://stream.url/...
export function parseM3u(text: string): M3uEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: M3uEntry[] = [];
  let pending: { meta: string; name: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const colon = line.indexOf(":");
      const tail = colon >= 0 ? line.slice(colon + 1) : "";
      const commaIdx = tail.indexOf(",");
      const meta = commaIdx >= 0 ? tail.slice(0, commaIdx) : tail;
      const name = (commaIdx >= 0 ? tail.slice(commaIdx + 1) : "").trim();
      pending = { meta, name };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) {
      entries.push({ url: line, name: line });
      continue;
    }
    const attrs = parseAttrs(pending.meta);
    entries.push({
      url: line,
      name: pending.name || attrs["tvg-name"] || line,
      tvgId: attrs["tvg-id"] || undefined,
      tvgLogo: attrs["tvg-logo"] || undefined,
      groupTitle: attrs["group-title"] || undefined,
      country: attrs["tvg-country"] || undefined,
      language: attrs["tvg-language"] || undefined,
    });
    pending = null;
  }
  return entries;
}
