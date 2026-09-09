import { z } from "zod";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export function firstZodIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  return issue.message;
}
