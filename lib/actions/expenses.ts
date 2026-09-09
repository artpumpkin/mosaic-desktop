import { db, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { invalidate } from "@/lib/query/bus";
import {
  budgetUpsertSchema,
  expenseCreateSchema,
  idOnlySchema,
} from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function createExpense(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = expenseCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { category, amount, currency, occurredOn, note } = parsed.data;
  try {
    await db.insert(schema.expenses).values({
      category,
      amount,
      currency,
      occurredOn,
      note,
    });
    invalidate("expenses", "dashboard");
    return { ok: true, message: "Expense logged" };
  } catch (e) {
    console.error("createExpense failed", e);
    return { ok: false, error: "Could not log expense" };
  }
}

export async function deleteExpense(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db.delete(schema.expenses).where(eq(schema.expenses.id, parsed.data.id));
    invalidate("expenses", "dashboard");
    return { ok: true, message: "Expense removed" };
  } catch (e) {
    console.error("deleteExpense failed", e);
    return { ok: false, error: "Could not remove expense" };
  }
}

export async function upsertBudget(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = budgetUpsertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  const { category, monthlyAmountMad } = parsed.data;
  try {
    await db
      .insert(schema.expenseBudgets)
      .values({ category, monthlyAmountMad })
      .onConflictDoUpdate({
        target: schema.expenseBudgets.category,
        set: { monthlyAmountMad },
      });
    invalidate("expenses");
    return { ok: true, message: "Budget saved" };
  } catch (e) {
    console.error("upsertBudget failed", e);
    return { ok: false, error: "Could not save budget" };
  }
}

export async function deleteBudget(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = idOnlySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await db
      .delete(schema.expenseBudgets)
      .where(eq(schema.expenseBudgets.id, parsed.data.id));
    invalidate("expenses");
    return { ok: true, message: "Budget removed" };
  } catch (e) {
    console.error("deleteBudget failed", e);
    return { ok: false, error: "Could not remove budget" };
  }
}
