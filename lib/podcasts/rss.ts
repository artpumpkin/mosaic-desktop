// Podcast RSS parsing. Fetches the feed XML (via the CORS-free afetch) and
// parses it with the browser DOMParser — available in the Tauri webview. We
// read RSS 2.0 + the common iTunes namespace fields.

import { afetch } from "@/lib/audio/fetch";
import type { PodcastEpisode, PodcastFeed } from "./types";

// "3600" → 3600; "1:02:03" / "02:03" → seconds.
function parseDuration(raw: string | null): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseDate(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

// Pull a namespaced tag's text/attr without relying on getElementsByTagNameNS
// (RSS namespaces are inconsistent in the wild). We match by local name.
function childText(el: Element, localName: string): string | null {
  for (const c of Array.from(el.children)) {
    if (c.localName === localName) return c.textContent?.trim() || null;
  }
  return null;
}

function childAttr(el: Element, localName: string, attr: string): string | null {
  for (const c of Array.from(el.children)) {
    if (c.localName === localName) return c.getAttribute(attr);
  }
  return null;
}

export async function fetchFeed(feedUrl: string): Promise<PodcastFeed> {
  const res = await afetch(feedUrl);
  if (!res.ok) throw new Error(`${feedUrl} → ${res.status}`);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid RSS feed");
  }
  const channel = doc.querySelector("channel");
  if (!channel) throw new Error("Not a podcast feed");

  const channelImage =
    childAttr(channel, "image", "href") || // itunes:image href
    (() => {
      const img = channel.querySelector("image > url");
      return img?.textContent?.trim() || null;
    })();

  const episodes: PodcastEpisode[] = [];
  for (const item of Array.from(channel.querySelectorAll("item"))) {
    const enclosure = item.querySelector("enclosure");
    const audioUrl = enclosure?.getAttribute("url") || null;
    if (!audioUrl) continue; // not a playable episode
    const guid = childText(item, "guid");
    episodes.push({
      id: guid || audioUrl,
      title: childText(item, "title") || "Untitled episode",
      audioUrl,
      durationSec: parseDuration(childText(item, "duration")),
      publishedAt: parseDate(childText(item, "pubDate")),
      image: childAttr(item, "image", "href") || channelImage,
      description: childText(item, "description"),
    });
  }

  return {
    feedUrl,
    title: childText(channel, "title") || "Untitled podcast",
    author: childText(channel, "author") || childText(channel, "managingEditor"),
    image: channelImage,
    description: childText(channel, "description"),
    episodes,
  };
}
