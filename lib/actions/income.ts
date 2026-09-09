import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import { incomeCreateSchema, idOnlySchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createIncome(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = incomeCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { source, amount, currency, occurredOn, recurring, note } = parsed.data;
  try {
    await db.insert(schema.incomes).values({
      source,
      amount,
      currency,
      occurredOn,
      recurring,
      note,
    });
    invalidate("income", "dashboard");
    return { ok: true, message: "Income logged" };
  } catch (e) {
    console.error("createIncome failed", e);
    return { ok: false, error: "Could not log income" };
  }
}

export async function deleteIncome(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.incomes).where(eq(schema.incomes.id, parsed.data.id));
    invalidate("income", "dashboard");
    return { ok: true, message: "Income removed" };
  } catch (e) {
    console.error("deleteIncome failed", e);
    return { ok: false, error: "Could not remove income" };
  }
}
