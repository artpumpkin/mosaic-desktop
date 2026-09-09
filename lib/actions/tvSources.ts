import { z } from "zod";
import { getTvSources, setTvSources } from "@/lib/settings";
import { invalidate } from "@/lib/query/bus";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";
import {
  BUILTIN_IPTV_ORG_ID,
  type TvSource,
  type TvSourcesState,
} from "@/lib/tv/sources";
import { clearTvCache } from "@/lib/tv/api";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(60, "Name must be 60 characters or fewer");

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .refine(
    (v) => v.startsWith("http://") || v.startsWith("https://"),
    "URL must start with http:// or https://",
  );

const optionalUrlSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine(
    (v) => v === null || v.startsWith("http://") || v.startsWith("https://"),
    "EPG URL must start with http:// or https://",
  );

const addSchema = z.object({
  name: nameSchema,
  url: httpUrlSchema,
  epgUrl: optionalUrlSchema,
});

const editSchema = z.object({
  id: z.string().min(1),
  name: nameSchema,
  url: httpUrlSchema,
  epgUrl: optionalUrlSchema,
});

const idSchema = z.object({ id: z.string().min(1) });

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function mutate(
  fn: (state: TvSourcesState) => TvSourcesState | Promise<TvSourcesState>,
): Promise<TvSourcesState> {
  const current = await getTvSources();
  const next = await fn(current);
  await setTvSources(next);
  invalidate("tv:sources");
  return next;
}

export async function addTvSource(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { name, url, epgUrl } = parsed.data;
  try {
    const id = genId();
    await mutate((state) => ({
      ...state,
      custom: [...state.custom, { id, kind: "m3u", name, url, epgUrl }],
    }));
    return { ok: true, message: `Added playlist "${name}"` };
  } catch (e) {
    console.error("addTvSource failed", e);
    return { ok: false, error: "Could not add playlist" };
  }
}

export async function updateTvSource(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, name, url, epgUrl } = parsed.data;
  if (id === BUILTIN_IPTV_ORG_ID) {
    return { ok: false, error: "The built-in source cannot be edited" };
  }
  try {
    let found = false;
    const next = await mutate((state) => {
      const custom = state.custom.map((s) => {
        if (s.id !== id) return s;
        found = true;
        return { ...s, name, url, epgUrl };
      });
      return { ...state, custom };
    });
    if (!found) return { ok: false, error: "Playlist not found" };
    // Different URL means the cached dataset is stale — drop it.
    clearTvCache(id);
    void next;
    return { ok: true, message: `Saved "${name}"` };
  } catch (e) {
    console.error("updateTvSource failed", e);
    return { ok: false, error: "Could not save playlist" };
  }
}

export async function deleteTvSource(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id } = parsed.data;
  if (id === BUILTIN_IPTV_ORG_ID) {
    return { ok: false, error: "The built-in source cannot be deleted" };
  }
  try {
    await mutate((state) => {
      const custom = state.custom.filter((s) => s.id !== id);
      const activeId =
        state.activeId === id ? BUILTIN_IPTV_ORG_ID : state.activeId;
      return { custom, activeId };
    });
    clearTvCache(id);
    return { ok: true, message: "Playlist deleted" };
  } catch (e) {
    console.error("deleteTvSource failed", e);
    return { ok: false, error: "Could not delete playlist" };
  }
}

export async function setActiveTvSource(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id } = parsed.data;
  try {
    let name = "iptv-org (built-in)";
    await mutate((state) => {
      const valid =
        id === BUILTIN_IPTV_ORG_ID || state.custom.some((s) => s.id === id);
      if (!valid) throw new Error("Unknown source");
      const match = state.custom.find((s) => s.id === id);
      if (match) name = match.name;
      return { ...state, activeId: id };
    });
    return { ok: true, message: `Switched to ${name}` };
  } catch (e) {
    console.error("setActiveTvSource failed", e);
    return { ok: false, error: "Could not switch source" };
  }
}

export type { TvSource };
