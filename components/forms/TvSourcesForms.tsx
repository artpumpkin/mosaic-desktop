"use client";
import { useActionState, useState } from "react";
import { Save, Plus, Trash2, Pencil, X } from "lucide-react";
import {
  addTvSource,
  updateTvSource,
  deleteTvSource,
  setActiveTvSource,
} from "@/lib/actions/tvSources";
import {
  BUILTIN_IPTV_ORG,
  type TvSource,
  type TvSourcesState,
} from "@/lib/tv/sources";
import { useToastResult } from "./useToastResult";

function PlaylistFields({
  name,
  url,
  epgUrl,
}: {
  name?: string;
  url?: string;
  epgUrl?: string | null;
}) {
  return (
    <div className="grid gap-3">
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">Name</label>
        <input
          name="name"
          type="text"
          defaultValue={name ?? ""}
          placeholder="My provider"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">M3U URL</label>
        <input
          name="url"
          type="url"
          defaultValue={url ?? ""}
          placeholder="https://example.com/playlist.m3u"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          EPG URL <span className="text-neutral-600">(optional, XMLTV)</span>
        </label>
        <input
          name="epgUrl"
          type="url"
          defaultValue={epgUrl ?? ""}
          placeholder="https://example.com/epg.xml"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export function AddTvSourceForm({ onAdded }: { onAdded?: () => void }) {
  const [state, formAction, pending] = useActionState(addTvSource, null);
  useToastResult(state);
  // Reset form fields after a successful add by remounting via a counter key.
  const [resetKey, setResetKey] = useState(0);
  if (state?.ok && onAdded) {
    // Fire once per new state — useToastResult uses a ref to avoid spam,
    // we just want to nudge the parent to refresh and clear the form.
    queueMicrotask(() => {
      onAdded();
      setResetKey((k) => k + 1);
    });
  }
  return (
    <form key={resetKey} action={formAction} className="space-y-3 max-w-xl">
      <PlaylistFields />
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className="btn-primary">
          <Plus size={15} /> {pending ? "Adding…" : "Add playlist"}
        </button>
      </div>
    </form>
  );
}

export function EditTvSourceForm({
  source,
  onDone,
}: {
  source: TvSource;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateTvSource, null);
  useToastResult(state);
  if (state?.ok) {
    queueMicrotask(onDone);
  }
  return (
    <form action={formAction} className="space-y-3 max-w-xl">
      <input type="hidden" name="id" value={source.id} />
      <PlaylistFields name={source.name} url={source.url} epgUrl={source.epgUrl} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="btn-ghost">
          <X size={14} /> Cancel
        </button>
        <button type="submit" disabled={pending} className="btn-primary">
          <Save size={15} /> {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function DeleteTvSourceButton({ id, name }: { id: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteTvSource, null);
  useToastResult(state);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Delete playlist "${name}"?`)) {
          e.preventDefault();
        }
      }}
      className="inline"
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="grid place-items-center w-8 h-8 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-rose-500/15 hover:border-rose-400/40 text-neutral-300 hover:text-rose-200 disabled:opacity-50"
        aria-label={`Delete ${name}`}
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </form>
  );
}

export function ActiveTvSourceForm({
  state: sourcesState,
}: {
  state: TvSourcesState;
}) {
  const [state, formAction, pending] = useActionState(setActiveTvSource, null);
  useToastResult(state);
  const options = [BUILTIN_IPTV_ORG, ...sourcesState.custom];
  return (
    <form
      action={formAction}
      className="grid grid-cols-[1fr_auto] gap-2 items-end max-w-md"
    >
      <div className="min-w-0">
        <label className="text-xs text-neutral-400 block mb-1.5">
          Active source
        </label>
        <select
          name="id"
          defaultValue={sourcesState.activeId}
          aria-label="Active TV source"
        >
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="btn-primary">
        <Save size={15} /> {pending ? "Saving…" : "Switch"}
      </button>
    </form>
  );
}

export function PlaylistsTable({ state }: { state: TvSourcesState }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  // Keep the container shape stable across refetch (add/delete) so the card
  // body doesn't collapse/jump between the empty and populated states.
  if (state.custom.length === 0) {
    return (
      <div className="min-h-[3.5rem] grid place-items-center py-6 text-center">
        <p className="text-sm text-neutral-400">
          No custom playlists yet. Add one below.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 min-h-[3.5rem]">
      {state.custom.map((s) => {
        const isEditing = editingId === s.id;
        return (
          <div
            key={s.id}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
          >
            {isEditing ? (
              <EditTvSourceForm source={s} onDone={() => setEditingId(null)} />
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{s.name}</div>
                  <div className="text-[11px] text-neutral-500 truncate font-mono">
                    {s.url}
                  </div>
                  {s.epgUrl && (
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">
                      EPG configured
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingId(s.id)}
                  className="grid place-items-center w-8 h-8 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.06] text-neutral-300"
                  aria-label={`Edit ${s.name}`}
                  title="Edit"
                >
                  <Pencil size={14} />
                </button>
                <DeleteTvSourceButton id={s.id} name={s.name} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
