"use client";
import { useEffect, useState } from "react";
import {
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  ServerCog,
  BookOpen,
  Globe,
  Puzzle,
  ShieldAlert,
  Loader2,
  Download,
  Check,
  RefreshCw,
  Blocks,
  Settings2,
} from "lucide-react";
import clsx from "clsx";
import SuwayomiExtensions from "./SuwayomiExtensions";
import {
  setMangaSources,
  getMangaRepos,
  setMangaRepos,
} from "@/lib/settings";
import {
  BUILTIN_CATALOG,
  fetchRepoCatalog,
  installExtension,
  uninstallExtension,
} from "@/lib/manga/extensions";
import { invalidate } from "@/lib/query/bus";
import {
  allSources,
  BUILTIN_IDS,
  BUILTIN_MANGADEX_ID,
} from "@/lib/manga/sources";
import type {
  MangaSource,
  MangaSourcesState,
  ExtRepo,
  RepoExtensionManifest,
} from "@/lib/manga/types";

type Props = {
  state: MangaSourcesState;
  onClose: () => void;
};

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MangaSources({ state, onClose }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Extensions
  const [repos, setRepos] = useState<ExtRepo[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RepoExtensionManifest[]>(BUILTIN_CATALOG);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which Suwayomi server (if any) we're browsing extensions for.
  const [extServer, setExtServer] = useState<MangaSource | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const installedExtIds = new Set(
    state.custom.filter((c) => c.kind === "extension").map((c) => c.id),
  );

  const refreshCatalog = async (list: ExtRepo[]) => {
    setCatalogLoading(true);
    const merged: RepoExtensionManifest[] = [...BUILTIN_CATALOG];
    for (const r of list) {
      try {
        const items = await fetchRepoCatalog(r.url);
        merged.push(...items);
      } catch {
        /* skip unreachable repo */
      }
    }
    // De-dupe by id (later repos win over built-ins only if same id).
    const seen = new Set<string>();
    setCatalog(merged.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))));
    setCatalogLoading(false);
  };

  useEffect(() => {
    getMangaRepos().then((r) => {
      setRepos(r);
      refreshCatalog(r);
    });
  }, []);

  const apply = (next: MangaSourcesState) => {
    setMangaSources(next).catch(() => {});
    invalidate("manga:sources");
  };

  const list = allSources(state);

  const toggleEnabled = (s: MangaSource) => {
    if (BUILTIN_IDS.has(s.id)) {
      const disabled = new Set(state.disabledBuiltins);
      if (disabled.has(s.id)) disabled.delete(s.id);
      else disabled.add(s.id);
      apply({ ...state, disabledBuiltins: [...disabled] });
    } else {
      apply({
        ...state,
        custom: state.custom.map((c) =>
          c.id === s.id ? { ...c, enabled: !c.enabled } : c,
        ),
      });
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const order = list.map((s) => s.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    apply({ ...state, order });
  };

  const setActive = (id: string) => apply({ ...state, activeId: id });

  const removeSource = async (s: MangaSource) => {
    if (s.kind === "extension") {
      await uninstallExtension(s.id);
    }
    setMangaSources({
      ...state,
      custom: state.custom.filter((c) => c.id !== s.id),
      order: state.order.filter((o) => o !== s.id),
      activeId: state.activeId === s.id ? BUILTIN_MANGADEX_ID : state.activeId,
    }).catch(() => {});
    invalidate("manga:sources", "manga:extensions");
  };

  const addSuwayomi = () => {
    const n = name.trim();
    const u = url.trim();
    if (!n) return setFormError("Name is required");
    if (!u.startsWith("http://") && !u.startsWith("https://"))
      return setFormError("URL must start with http:// or https://");
    const id = genId();
    apply({
      ...state,
      custom: [
        ...state.custom,
        { id, kind: "suwayomi", name: n, url: u.replace(/\/+$/, ""), enabled: true },
      ],
      order: [...state.order, id],
    });
    setName("");
    setUrl("");
    setFormError(null);
  };

  const addRepo = async () => {
    const u = repoUrl.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://"))
      return setRepoError("URL must start with http:// or https://");
    setRepoError(null);
    setBusyId("__repo");
    try {
      const items = await fetchRepoCatalog(u);
      const repoName = items[0]?.repo || u;
      const next = [...repos.filter((r) => r.url !== u), { url: u, name: repoName }];
      await setMangaRepos(next);
      setRepos(next);
      await refreshCatalog(next);
      setRepoUrl("");
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : "Could not load repository");
    } finally {
      setBusyId(null);
    }
  };

  const removeRepo = async (u: string) => {
    const next = repos.filter((r) => r.url !== u);
    await setMangaRepos(next);
    setRepos(next);
    await refreshCatalog(next);
  };

  const install = async (m: RepoExtensionManifest) => {
    setBusyId(m.id);
    try {
      await installExtension(m);
      const order = state.order.includes(m.id) ? state.order : [...state.order, m.id];
      await setMangaSources({
        ...state,
        custom: [
          ...state.custom.filter((c) => c.id !== m.id),
          { id: m.id, kind: "extension", name: m.name, url: "", enabled: true },
        ],
        order,
      });
      invalidate("manga:sources", "manga:extensions");
    } catch (e) {
      setRepoError(e instanceof Error ? e.message : "Install failed");
    } finally {
      setBusyId(null);
    }
  };

  const uninstall = async (id: string) => {
    setBusyId(id);
    try {
      await uninstallExtension(id);
      await setMangaSources({
        ...state,
        custom: state.custom.filter((c) => c.id !== id),
        order: state.order.filter((o) => o !== id),
        activeId: state.activeId === id ? BUILTIN_MANGADEX_ID : state.activeId,
      });
      invalidate("manga:sources", "manga:extensions");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
    <div
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-md grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg max-h-[88vh] overflow-hidden rounded-2xl bg-[var(--surface-1,#111)] border border-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <h2 className="text-sm font-semibold text-neutral-100">Manga sources</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          {/* Active sources */}
          <div className="space-y-2">
            {list.map((s, i) => {
              const isActive = state.activeId === s.id;
              const isBuiltin = BUILTIN_IDS.has(s.id);
              const Icon =
                s.kind === "suwayomi"
                  ? ServerCog
                  : s.kind === "extension"
                    ? Puzzle
                    : s.kind === "comick"
                      ? Globe
                      : BookOpen;
              return (
                <div
                  key={s.id}
                  className={clsx(
                    "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                    isActive
                      ? "bg-violet-500/[0.08] border-violet-400/30"
                      : "bg-white/[0.03] border-white/5",
                  )}
                >
                  <span
                    className={clsx(
                      "shrink-0 grid place-items-center w-9 h-9 rounded-lg",
                      s.enabled ? "bg-amber-500/90 text-white" : "bg-white/10 text-neutral-500",
                    )}
                  >
                    <Icon size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-neutral-100 truncate">
                        {s.name}
                      </span>
                      {isActive && (
                        <span className="shrink-0 text-[9.5px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-200">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {isBuiltin
                        ? "Built-in source"
                        : s.kind === "extension"
                          ? "Installed extension"
                          : s.url}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {s.kind === "suwayomi" && (
                      <button
                        type="button"
                        onClick={() => setExtServer(s)}
                        className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-200 hover:bg-violet-500/20"
                        title="Browse & install extensions on this server"
                      >
                        <Blocks size={12} /> Extensions
                      </button>
                    )}
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => setActive(s.id)}
                        disabled={!s.enabled}
                        className="hidden sm:inline-flex items-center rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                      >
                        Set active
                      </button>
                    )}

                    {list.length > 1 && (
                      <div className="flex flex-col rounded-md bg-white/[0.04] border border-white/10">
                        <button
                          type="button"
                          onClick={() => move(s.id, -1)}
                          disabled={i === 0}
                          className="grid place-items-center w-6 h-4 text-neutral-400 hover:text-white disabled:opacity-20"
                          aria-label="Move up"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(s.id, 1)}
                          disabled={i === list.length - 1}
                          className="grid place-items-center w-6 h-4 text-neutral-400 hover:text-white disabled:opacity-20 border-t border-white/10"
                          aria-label="Move down"
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleEnabled(s)}
                      className={clsx(
                        "relative w-10 h-[22px] rounded-full transition-colors",
                        s.enabled ? "bg-violet-500" : "bg-white/15",
                      )}
                      aria-pressed={s.enabled}
                      title={s.enabled ? "Enabled" : "Disabled"}
                    >
                      <span
                        className={clsx(
                          "absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform",
                          s.enabled ? "translate-x-[18px]" : "translate-x-0",
                        )}
                      />
                    </button>

                    {!isBuiltin && (
                      <button
                        type="button"
                        onClick={() => removeSource(s)}
                        className="grid place-items-center w-8 h-8 rounded-lg text-rose-300 hover:bg-rose-500/15"
                        aria-label="Remove source"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Extensions (Mihon-style) */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3.5 py-2.5 bg-white/[0.03] text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              <Puzzle size={13} /> Extensions
            </div>

            <div className="p-3.5 space-y-3">
              <p className="text-[11.5px] text-neutral-400 leading-snug">
                Tap <span className="text-violet-300">Install</span> to add a
                source — it appears in the source picker right away. No URLs, no
                setup.
              </p>

              {/* Catalog */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Available sources
                </span>
                <button
                  type="button"
                  onClick={() => refreshCatalog(repos)}
                  className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-white"
                >
                  {catalogLoading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  Refresh
                </button>
              </div>

              <div className="space-y-1.5">
                {catalog.map((m) => {
                  const installed = installedExtIds.has(m.id);
                  const busy = busyId === m.id;
                  return (
                    <div
                      key={`${m.repo}:${m.id}`}
                      className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"
                    >
                      <span className="grid place-items-center w-7 h-7 rounded-md bg-white/10 text-neutral-300 shrink-0">
                        <Puzzle size={13} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] text-neutral-100 truncate">{m.name}</div>
                        <div className="text-[10.5px] text-neutral-500 truncate">
                          {(m.lang || "en").toUpperCase()} · {m.repo}
                        </div>
                      </div>
                      {installed ? (
                        <button
                          type="button"
                          onClick={() => uninstall(m.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-white/10 disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} className="text-emerald-400" />}
                          Installed
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => install(m)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-full bg-violet-500 hover:bg-violet-400 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          Install
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Advanced (repos + Suwayomi) */}
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 bg-white/[0.03] text-[11px] font-semibold uppercase tracking-wide text-neutral-400 hover:text-neutral-200"
            >
              <span className="flex items-center gap-1.5">
                <Settings2 size={13} /> Advanced
              </span>
              <ChevronDown
                size={14}
                className={clsx("transition-transform", showAdvanced && "rotate-180")}
              />
            </button>
            {showAdvanced && (
              <div className="p-3.5 space-y-4">
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-2 text-[11.5px] text-amber-200/90">
                  <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Custom repositories and servers run external code/requests.
                    Only add ones you trust.
                  </span>
                </div>

                {/* Extension repository */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Extension repository
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="Repository URL (index.json)"
                      className="flex-1 rounded-lg bg-white/5 border border-white/10 focus:border-violet-400/50 focus:outline-none px-2.5 py-1.5 text-[12.5px] text-neutral-100 placeholder:text-neutral-500"
                    />
                    <button
                      type="button"
                      onClick={addRepo}
                      disabled={busyId === "__repo"}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-[12.5px] font-medium text-neutral-100 disabled:opacity-50"
                    >
                      {busyId === "__repo" ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Plus size={14} />
                      )}
                      Add
                    </button>
                  </div>
                  {repoError && <p className="text-[11.5px] text-rose-300">{repoError}</p>}
                  {repos.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {repos.map((r) => (
                        <span
                          key={r.url}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 pl-2.5 pr-1.5 py-1 text-[11px] text-neutral-300"
                        >
                          {r.name}
                          <button
                            type="button"
                            onClick={() => removeRepo(r.url)}
                            className="grid place-items-center w-4 h-4 rounded-full hover:bg-white/15 text-neutral-400 hover:text-white"
                            aria-label={`Remove ${r.name}`}
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Suwayomi server */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    <ServerCog size={13} /> Suwayomi / Tachidesk server
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-snug">
                    For the full Tachiyomi/Mihon (Keiyoushi) catalogue. Add a
                    server, then hit{" "}
                    <span className="text-violet-300">Extensions</span> on its
                    row. e.g. <code>http://localhost:4567</code>
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name"
                      className="flex-1 rounded-lg bg-white/5 border border-white/10 focus:border-violet-400/50 focus:outline-none px-2.5 py-1.5 text-[12.5px] text-neutral-100 placeholder:text-neutral-500"
                    />
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://localhost:4567"
                      className="flex-1 rounded-lg bg-white/5 border border-white/10 focus:border-violet-400/50 focus:outline-none px-2.5 py-1.5 text-[12.5px] text-neutral-100 placeholder:text-neutral-500"
                    />
                    <button
                      type="button"
                      onClick={addSuwayomi}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-500 hover:bg-violet-400 px-3 py-1.5 text-[12.5px] font-medium text-white"
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {formError && <p className="text-[11.5px] text-rose-300">{formError}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {extServer && (
      <SuwayomiExtensions
        serverUrl={extServer.url}
        serverName={extServer.name}
        onClose={() => setExtServer(null)}
      />
    )}
    </>
  );
}
