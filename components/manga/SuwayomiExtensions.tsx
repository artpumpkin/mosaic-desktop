"use client";
import { useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  Loader2,
  Download,
  Check,
  RefreshCw,
  AlertTriangle,
  Puzzle,
} from "lucide-react";
import {
  listSuwayomiExtensions,
  installSuwayomiExtension,
  uninstallSuwayomiExtension,
  suwayomiExtIcon,
  KEIYOUSHI_REPO_URL,
  type SuwayomiExtension,
} from "@/lib/manga/suwayomi-api";

type Props = {
  serverUrl: string;
  serverName: string;
  onClose: () => void;
};

const MAX_RENDER = 80;

export default function SuwayomiExtensions({ serverUrl, serverName, onClose }: Props) {
  const [exts, setExts] = useState<SuwayomiExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState<string>("en");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSuwayomiExtensions(serverUrl);
      setExts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrl]);

  const langs = useMemo(() => {
    const s = new Set<string>();
    for (const e of exts) s.add(e.lang || "other");
    return ["all", ...[...s].sort()];
  }, [exts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exts
      .filter((e) => (lang === "all" ? true : e.lang === lang))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        // Installed first, then by name.
        if (!!a.installed !== !!b.installed) return a.installed ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [exts, query, lang]);

  const setExtInstalled = (pkgName: string, installed: boolean) =>
    setExts((prev) =>
      prev.map((e) => (e.pkgName === pkgName ? { ...e, installed } : e)),
    );

  const install = async (e: SuwayomiExtension) => {
    setBusy(e.pkgName);
    try {
      await installSuwayomiExtension(serverUrl, e.pkgName);
      setExtInstalled(e.pkgName, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusy(null);
    }
  };
  const uninstall = async (e: SuwayomiExtension) => {
    setBusy(e.pkgName);
    try {
      await uninstallSuwayomiExtension(serverUrl, e.pkgName);
      setExtInstalled(e.pkgName, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setBusy(null);
    }
  };

  const installedCount = exts.filter((e) => e.installed).length;

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-md grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl h-[82vh] overflow-hidden rounded-2xl bg-[var(--surface-1,#111)] border border-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-violet-500/90 text-white shrink-0">
            <Puzzle size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-neutral-100 truncate">Extensions</h2>
            <p className="text-[11px] text-neutral-500 truncate">
              {serverName} · {exts.length} available · {installedCount} installed
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="grid place-items-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Refresh"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 grid w-9 place-items-center text-neutral-500">
              <Search size={14} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search extensions…"
              className="w-full rounded-full bg-white/[0.06] border border-white/10 focus:border-violet-400/50 focus:outline-none pl-9 pr-3 py-1.5 text-[12.5px] text-neutral-100 placeholder:text-neutral-500"
            />
          </div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            className="rounded-full bg-white/[0.06] border border-white/10 focus:outline-none px-2.5 py-1.5 text-[12px] text-neutral-200"
          >
            {langs.map((l) => (
              <option key={l} value={l} className="bg-neutral-900">
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-400/20 px-3 py-2 text-[12px] text-rose-200">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="grid place-items-center py-16 text-neutral-400">
              <span className="flex items-center gap-2 text-sm">
                <Loader2 size={16} className="animate-spin" /> Loading extensions…
              </span>
            </div>
          ) : exts.length === 0 && !error ? (
            <div className="px-3 py-10 text-center text-[12.5px] text-neutral-400 space-y-2">
              <p>No extensions found on this server.</p>
              <p className="text-neutral-500">
                Add an extension repository to your Suwayomi server settings
                (<code>extensionRepos</code>), e.g. the Keiyoushi catalogue:
              </p>
              <code className="block break-all rounded bg-white/5 px-2 py-1.5 text-[11px] text-neutral-300">
                {KEIYOUSHI_REPO_URL}
              </code>
            </div>
          ) : (
            <>
              {filtered.slice(0, MAX_RENDER).map((e) => {
                const icon = suwayomiExtIcon(serverUrl, e);
                const isBusy = busy === e.pkgName;
                return (
                  <div
                    key={e.pkgName}
                    className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"
                  >
                    <span className="grid place-items-center w-8 h-8 rounded-md bg-white/10 overflow-hidden shrink-0">
                      {icon ? (
                        <img src={icon} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Puzzle size={14} className="text-neutral-400" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] text-neutral-100 truncate">{e.name}</span>
                        {e.isNsfw && (
                          <span className="shrink-0 text-[9px] font-semibold px-1 py-0.5 rounded bg-rose-500/25 text-rose-200">
                            18+
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-neutral-500 truncate">
                        {(e.lang || "").toUpperCase()}
                        {e.versionName ? ` · v${e.versionName}` : ""}
                      </div>
                    </div>
                    {e.installed ? (
                      <button
                        type="button"
                        onClick={() => uninstall(e)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-neutral-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={12} className="text-emerald-400" />
                        )}
                        Installed
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => install(e)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-500 hover:bg-violet-400 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        Install
                      </button>
                    )}
                  </div>
                );
              })}
              {filtered.length > MAX_RENDER && (
                <p className="px-3 py-2 text-center text-[11px] text-neutral-500">
                  Showing {MAX_RENDER} of {filtered.length}. Refine your search to
                  see more.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
