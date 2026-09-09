import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import {
  idOnlySchema,
  weightCreateSchema,
  weightUpdateSchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createWeight(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = weightCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { weightKg, recordedAt, note } = parsed.data;
  try {
    await db.insert(schema.weightEntries).values({ weightKg, recordedAt, note });
    invalidate("weight", "health-overview", "dashboard");
    return { ok: true, message: "Weight logged" };
  } catch (e) {
    console.error("createWeight failed", e);
    return { ok: false, error: "Could not log weight" };
  }
}

export async function updateWeight(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = weightUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, weightKg, recordedAt, note } = parsed.data;
  try {
    await db
      .update(schema.weightEntries)
      .set({ weightKg, recordedAt, note })
      .where(eq(schema.weightEntries.id, id));
    invalidate("weight", "health-overview", "dashboard");
    return { ok: true, message: "Entry updated" };
  } catch (e) {
    console.error("updateWeight failed", e);
    return { ok: false, error: "Could not update entry" };
  }
}

export async function deleteWeight(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db
      .delete(schema.weightEntries)
      .where(eq(schema.weightEntries.id, parsed.data.id));
    invalidate("weight", "health-overview", "dashboard");
    return { ok: true, message: "Entry removed" };
  } catch (e) {
    console.error("deleteWeight failed", e);
    return { ok: false, error: "Could not remove entry" };
  }
}
