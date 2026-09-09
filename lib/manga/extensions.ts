// Mihon-style installable source extensions.
//
// An *extension* is a small JS module (an expression returning a source
// object). The user adds a *repo* (a URL serving a JSON index of extensions)
// once, browses the catalog, and installs individual extensions — each then
// becomes a toggleable source with no per-source URL, exactly like Mihon's
// repo → install flow.
//
// SECURITY: installed extension code runs in the app with `new Function`. It
// can make network requests via the provided ctx. Only add repositories you
// trust — this mirrors Mihon, where extensions are likewise untrusted code.
//
// Extension contract — the module is an expression returning:
//   ({
//     id, name, lang,
//     async search(ctx, query)      => [{ id, title, cover?, status? }]
//     async browse(ctx)?            => [{ id, title, cover? }]
//     async getManga(ctx, id)       => { id, title, cover?, description?, tags? }
//     async getChapters(ctx, id)    => [{ id, number?, title?, volume?, scanlator?, publishedAt? }]  (ascending)
//     async getPages(ctx, chapterId)=> [url, ...]  or  [{ url }, ...]
//   })
// ctx = { fetchText, fetchJson, parseHtml(html)->Document, log }

import { mfetch } from "./fetch";
import {
  getInstalledExtensions,
  setInstalledExtensions,
} from "@/lib/settings";
import type {
  InstalledExtension,
  RepoExtensionManifest,
} from "./types";

export type ExtCtx = {
  fetchText: (url: string, opts?: RequestInit) => Promise<string>;
  fetchJson: <T = unknown>(url: string, opts?: RequestInit) => Promise<T>;
  parseHtml: (html: string) => Document;
  log: (...args: unknown[]) => void;
};

export type CompiledExt = {
  id: string;
  name: string;
  lang: string;
  search: (query: string) => Promise<unknown[]>;
  browse?: () => Promise<unknown[]>;
  getManga: (id: string) => Promise<unknown>;
  getChapters: (id: string) => Promise<unknown[]>;
  getPages: (chapterId: string) => Promise<unknown[]>;
};

function makeCtx(): ExtCtx {
  return {
    async fetchText(url, opts) {
      const r = await mfetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    },
    async fetchJson(url, opts) {
      const r = await mfetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    parseHtml(html) {
      return new DOMParser().parseFromString(html, "text/html");
    },
    log: (...args) => console.log("[manga-ext]", ...args),
  };
}

type RawExt = {
  id: string;
  name?: string;
  lang?: string;
  search: (ctx: ExtCtx, q: string) => Promise<unknown[]>;
  browse?: (ctx: ExtCtx) => Promise<unknown[]>;
  getManga: (ctx: ExtCtx, id: string) => Promise<unknown>;
  getChapters: (ctx: ExtCtx, id: string) => Promise<unknown[]>;
  getPages: (ctx: ExtCtx, chapterId: string) => Promise<unknown[]>;
};

export function compileExtension(code: string): CompiledExt {
  const factory = new Function('"use strict"; return (' + code + ");");
  const ext = factory() as RawExt;
  if (!ext || typeof ext.search !== "function" || typeof ext.getPages !== "function") {
    throw new Error("Invalid extension: missing required methods");
  }
  const ctx = makeCtx();
  return {
    id: String(ext.id),
    name: String(ext.name || ext.id),
    lang: ext.lang || "en",
    search: (q) => ext.search(ctx, q),
    browse: typeof ext.browse === "function" ? () => ext.browse!(ctx) : undefined,
    getManga: (id) => ext.getManga(ctx, id),
    getChapters: (id) => ext.getChapters(ctx, id),
    getPages: (cid) => ext.getPages(ctx, cid),
  };
}

// In-memory registry of compiled extensions, keyed by extension id (== the
// MangaSource id for kind "extension").
const registry = new Map<string, CompiledExt>();

export function getCompiled(id: string): CompiledExt | undefined {
  return registry.get(id);
}

export async function loadInstalledExtensions(): Promise<void> {
  const list = await getInstalledExtensions();
  registry.clear();
  for (const e of list) {
    try {
      registry.set(e.id, compileExtension(e.code));
    } catch (err) {
      console.warn(`[manga-ext] failed to compile "${e.id}"`, err);
    }
  }
}

// Fetch a repo index. Format: { name, extensions: RepoExtensionManifest[] }.
export async function fetchRepoCatalog(
  repoUrl: string,
): Promise<RepoExtensionManifest[]> {
  const r = await mfetch(repoUrl);
  if (!r.ok) throw new Error(`Repo HTTP ${r.status}`);
  const j = (await r.json()) as { name?: string; extensions?: RepoExtensionManifest[] };
  const name = j.name || repoUrl;
  return (j.extensions || []).map((e) => ({ ...e, repo: name }));
}

export async function resolveCode(m: RepoExtensionManifest): Promise<string> {
  if (m.code) return m.code;
  if (m.codeUrl) {
    const r = await mfetch(m.codeUrl);
    if (!r.ok) throw new Error(`Code HTTP ${r.status}`);
    return r.text();
  }
  throw new Error("Extension manifest has no code");
}

// Install: resolve code, compile (validate), persist, register.
export async function installExtension(
  m: RepoExtensionManifest,
): Promise<InstalledExtension> {
  const code = await resolveCode(m);
  const compiled = compileExtension(code); // throws if invalid
  const entry: InstalledExtension = {
    id: m.id,
    name: m.name,
    lang: m.lang || "en",
    version: m.version || 1,
    code,
  };
  const list = (await getInstalledExtensions()).filter((e) => e.id !== m.id);
  await setInstalledExtensions([...list, entry]);
  registry.set(m.id, compiled);
  return entry;
}

export async function uninstallExtension(id: string): Promise<void> {
  const list = (await getInstalledExtensions()).filter((e) => e.id !== id);
  await setInstalledExtensions(list);
  registry.delete(id);
}

// --- Built-in starter catalog --------------------------------------------
// Always available (no repo needed) so the install flow works out of the box.
// The MangaDex entry is a guaranteed-working reference implementation; the
// scraper entries are best-effort betas.

// Weeb Central — server-rendered HTML, scraped with DOMParser. Verified end
// to end (search → series → full-chapter-list → images endpoint). Images load
// hotlink-free from its CDN.
const WEEBCENTRAL_CODE = `({
  id: "weebcentral",
  name: "Weeb Central",
  lang: "en",
  _base: "https://weebcentral.com",
  _cover: function(id){ return "https://temp.compsci88.com/cover/normal/"+id+".jpg"; },
  async search(ctx,q){
    var self=this;
    var html=await ctx.fetchText(this._base+"/search/data?text="+encodeURIComponent(q)+"&sort=Best%20Match&order=Descending&limit=32&display_mode=Full%20Display");
    var doc=ctx.parseHtml(html); var map={};
    // The cover <img alt="<Title> cover"> is the cleanest title source.
    doc.querySelectorAll("a[href*='/series/'] img[alt]").forEach(function(img){
      var alt=img.getAttribute("alt")||""; if(!/cover$/i.test(alt))return;
      var a=img.closest("a[href*='/series/']"); if(!a)return;
      var href=a.getAttribute("href")||""; var id=(href.split("/series/")[1]||"").split("/")[0]; if(!id||map[id])return;
      map[id]={id:id,title:alt.replace(/ cover$/i,""),cover:img.getAttribute("src")||self._cover(id)};
    });
    return Object.keys(map).map(function(k){return map[k];});
  },
  async getManga(ctx,id){
    var html=await ctx.fetchText(this._base+"/series/"+id); var doc=ctx.parseHtml(html);
    var h1=doc.querySelector("h1"); var title=h1?(h1.textContent||"").trim():id;
    var og=doc.querySelector('meta[property="og:image"]'); var cover=og?og.getAttribute("content"):null;
    var md=doc.querySelector('meta[name="description"]'); var desc=md?md.getAttribute("content"):null;
    return {id:id,title:title||id,cover:cover||this._cover(id),description:desc};
  },
  async getChapters(ctx,id){
    var html=await ctx.fetchText(this._base+"/series/"+id+"/full-chapter-list"); var doc=ctx.parseHtml(html); var out=[];
    doc.querySelectorAll("a[href*='/chapters/']").forEach(function(a){
      var href=a.getAttribute("href")||""; var cid=(href.split("/chapters/")[1]||"").split("/")[0].split("?")[0]; if(!cid)return;
      var txt=(a.textContent||""); var num=(txt.match(/[0-9.]+/)||[])[0]||null;
      out.push({id:cid,number:num,title:num?("Chapter "+num):txt.trim()});
    });
    out.reverse(); return out;
  },
  async getPages(ctx,chapterId){
    var html=await ctx.fetchText(this._base+"/chapters/"+chapterId+"/images?is_prev=False&current_page=1&reading_style=long_strip", {headers:{"HX-Request":"true"}});
    var doc=ctx.parseHtml(html); var out=[];
    doc.querySelectorAll("img").forEach(function(img){ var u=img.getAttribute("src")||""; if(u.indexOf("http")===0)out.push(u); });
    return out;
  }
})`;

const MANGAPILL_CODE = `({
  id: "mangapill",
  name: "MangaPill",
  lang: "en",
  _base: "https://mangapill.com",
  async search(ctx,q){ var html=await ctx.fetchText(this._base+"/search?q="+encodeURIComponent(q)+"&type=&status="); var doc=ctx.parseHtml(html); var map={}; doc.querySelectorAll('a[href^="/manga/"]').forEach(function(a){ var href=a.getAttribute("href")||""; var id=href.replace("/manga/",""); var key=id.split("/")[0]; if(!key)return; if(!map[key])map[key]={id:id,title:"",cover:null}; var img=a.querySelector("img"); if(img&&!map[key].cover)map[key].cover=img.getAttribute("data-src")||img.getAttribute("src"); var txt=(a.textContent||"").trim(); if(txt&&!map[key].title)map[key].title=txt; }); return Object.keys(map).map(function(k){var m=map[k]; if(!m.title)m.title=k; return m;}); },
  async getManga(ctx,id){ var html=await ctx.fetchText(this._base+"/manga/"+id); var doc=ctx.parseHtml(html); var h1=doc.querySelector("h1"); var img=doc.querySelector("img"); var p=doc.querySelector("p.text-sm")||doc.querySelector("p"); return {id:id,title:h1?h1.textContent.trim():id,cover:img?(img.getAttribute("data-src")||img.getAttribute("src")):null,description:p?p.textContent.trim():null}; },
  async getChapters(ctx,id){ var html=await ctx.fetchText(this._base+"/manga/"+id); var doc=ctx.parseHtml(html); var out=[]; doc.querySelectorAll('a[href^="/chapters/"]').forEach(function(a){ var cid=a.getAttribute("href").replace("/chapters/",""); var txt=(a.textContent||"").trim(); var num=(txt.match(/[0-9.]+/)||[])[0]||null; out.push({id:cid,number:num,title:txt}); }); out.reverse(); return out; },
  async getPages(ctx,chapterId){ var html=await ctx.fetchText(this._base+"/chapters/"+chapterId); var doc=ctx.parseHtml(html); var out=[]; doc.querySelectorAll("img.js-page, picture img, chapter-page img").forEach(function(img){ var u=img.getAttribute("data-src")||img.getAttribute("src"); if(u)out.push(u); }); return out; }
})`;

export const BUILTIN_CATALOG: RepoExtensionManifest[] = [
  {
    id: "weebcentral",
    name: "Weeb Central",
    lang: "en",
    version: 1,
    code: WEEBCENTRAL_CODE,
    repo: "Built-in catalog",
  },
  {
    id: "mangapill",
    name: "MangaPill",
    lang: "en",
    version: 1,
    code: MANGAPILL_CODE,
    repo: "Built-in catalog",
  },
];
