import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import {
  debtCreateSchema,
  debtToggleSchema,
  debtUpdateSchema,
  idOnlySchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createDebt(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = debtCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { direction, counterparty, amount, currency, dueOn, note } = parsed.data;
  try {
    await db.insert(schema.debts).values({
      direction,
      counterparty,
      amount,
      currency,
      dueOn,
      note,
    });
    invalidate("debts", "dashboard");
    return { ok: true, message: "Debt added" };
  } catch (e) {
    console.error("createDebt failed", e);
    return { ok: false, error: "Could not add debt" };
  }
}

export async function toggleDebt(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = debtToggleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, status } = parsed.data;
  try {
    await db
      .update(schema.debts)
      .set({ status })
      .where(eq(schema.debts.id, id));
    invalidate("debts", "dashboard");
    return {
      ok: true,
      message: status === "settled" ? "Debt settled" : "Debt reopened",
    };
  } catch (e) {
    console.error("toggleDebt failed", e);
    return { ok: false, error: "Could not update debt" };
  }
}

export async function updateDebt(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = debtUpdateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { id, direction, counterparty, amount, currency, dueOn, note } = parsed.data;
  try {
    await db
      .update(schema.debts)
      .set({ direction, counterparty, amount, currency, dueOn, note })
      .where(eq(schema.debts.id, id));
    invalidate("debts", "dashboard");
    return { ok: true, message: "Debt updated" };
  } catch (e) {
    console.error("updateDebt failed", e);
    return { ok: false, error: "Could not update debt" };
  }
}

export async function deleteDebt(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.debts).where(eq(schema.debts.id, parsed.data.id));
    invalidate("debts", "dashboard");
    return { ok: true, message: "Debt removed" };
  } catch (e) {
    console.error("deleteDebt failed", e);
    return { ok: false, error: "Could not remove debt" };
  }
}
