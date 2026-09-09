import { db, schema } from "@/lib/db/client";
import { and, eq, ne, sql } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import { cashCreateSchema, cashUpdateSchema, idOnlySchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createCash(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = cashCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { label, currency, amount } = parsed.data;
  try {
    const dup = await db
      .select({ id: schema.cashHoldings.id })
      .from(schema.cashHoldings)
      .where(sql`lower(${schema.cashHoldings.label}) = lower(${label})`);
    if (dup.length > 0) {
      return { ok: false, error: `A cash holding labeled "${label}" already exists` };
    }
    await db.insert(schema.cashHoldings).values({ label, currency, amount });
    invalidate("cash", "dashboard");
    return { ok: true, message: "Cash added" };
  } catch (e) {
    console.error("createCash failed", e);
    return { ok: false, error: "Could not add cash holding" };
  }
}

export async function updateCash(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = cashUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, label, currency, amount } = parsed.data;
  try {
    const dup = await db
      .select({ id: schema.cashHoldings.id })
      .from(schema.cashHoldings)
      .where(
        and(
          sql`lower(${schema.cashHoldings.label}) = lower(${label})`,
          ne(schema.cashHoldings.id, id),
        ),
      );
    if (dup.length > 0) {
      return { ok: false, error: `A cash holding labeled "${label}" already exists` };
    }
    await db
      .update(schema.cashHoldings)
      .set({ label, currency, amount, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.cashHoldings.id, id));
    invalidate("cash", "dashboard");
    return { ok: true, message: "Cash updated" };
  } catch (e) {
    console.error("updateCash failed", e);
    return { ok: false, error: "Could not update cash holding" };
  }
}

export async function deleteCash(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.cashHoldings).where(eq(schema.cashHoldings.id, parsed.data.id));
    invalidate("cash", "dashboard");
    return { ok: true, message: "Cash removed" };
  } catch (e) {
    console.error("deleteCash failed", e);
    return { ok: false, error: "Could not remove cash holding" };
  }
}
