import { db, schema } from "@/lib/db/client";
import { and, eq, isNull } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import {
  fastStartSchema,
  fastEndSchema,
  fastLogSchema,
  fastUpdateSchema,
  idOnlySchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";
import { defaultTargetHours } from "@/lib/health/fasting";

export async function startFast(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = fastStartSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { type, startedAt, targetHours, note } = parsed.data;
  try {
    const existing = await db
      .select({ id: schema.fastingSessions.id })
      .from(schema.fastingSessions)
      .where(isNull(schema.fastingSessions.endedAt));
    if (existing.length > 0) {
      return { ok: false, error: "A fast is already in progress" };
    }
    const target = targetHours ?? defaultTargetHours(type);
    await db.insert(schema.fastingSessions).values({
      type,
      startedAt: startedAt ?? new Date().toISOString(),
      endedAt: null,
      targetHours: target,
      note: note ?? null,
    });
    invalidate("fasting", "dashboard");
    return { ok: true, message: "Fast started" };
  } catch (e) {
    console.error("startFast failed", e);
    return { ok: false, error: "Could not start fast" };
  }
}

export async function endFast(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = fastEndSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, endedAt } = parsed.data;
  try {
    await db
      .update(schema.fastingSessions)
      .set({ endedAt: endedAt ?? new Date().toISOString() })
      .where(
        and(eq(schema.fastingSessions.id, id), isNull(schema.fastingSessions.endedAt)),
      );
    invalidate("fasting", "dashboard");
    return { ok: true, message: "Fast ended" };
  } catch (e) {
    console.error("endFast failed", e);
    return { ok: false, error: "Could not end fast" };
  }
}

export async function logFast(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = fastLogSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { type, startedAt, endedAt, targetHours, note } = parsed.data;
  try {
    const target = targetHours ?? defaultTargetHours(type);
    await db.insert(schema.fastingSessions).values({
      type,
      startedAt,
      endedAt,
      targetHours: target,
      note: note ?? null,
    });
    invalidate("fasting", "dashboard");
    return { ok: true, message: "Fast logged" };
  } catch (e) {
    console.error("logFast failed", e);
    return { ok: false, error: "Could not log fast" };
  }
}

export async function updateFast(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = fastUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, type, startedAt, endedAt, targetHours, note } = parsed.data;
  try {
    const target = targetHours ?? defaultTargetHours(type);
    await db
      .update(schema.fastingSessions)
      .set({ type, startedAt, endedAt: endedAt ?? null, targetHours: target, note: note ?? null })
      .where(eq(schema.fastingSessions.id, id));
    invalidate("fasting", "dashboard");
    return { ok: true, message: "Fast updated" };
  } catch (e) {
    console.error("updateFast failed", e);
    return { ok: false, error: "Could not update fast" };
  }
}

export async function deleteFast(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db
      .delete(schema.fastingSessions)
      .where(eq(schema.fastingSessions.id, parsed.data.id));
    invalidate("fasting", "dashboard");
    return { ok: true, message: "Fast removed" };
  } catch (e) {
    console.error("deleteFast failed", e);
    return { ok: false, error: "Could not remove fast" };
  }
}
