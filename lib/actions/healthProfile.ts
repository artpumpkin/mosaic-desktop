import { setHealthProfile } from "@/lib/settings";
import { invalidate } from "@/lib/query/bus";
import { healthProfileSchema } from "@/lib/validation/forms";
import { firstZodIssue, type ActionResult } from "@/lib/actions/result";

export async function updateHealthProfile(
  _: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = healthProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: firstZodIssue(parsed.error) };
  try {
    await setHealthProfile(parsed.data);
    invalidate("health-profile", "health-overview", "weight", "metabolism", "dashboard");
    return { ok: true, message: "Profile saved" };
  } catch (e) {
    console.error("updateHealthProfile failed", e);
    return { ok: false, error: "Could not save profile" };
  }
}
