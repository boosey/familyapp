"use server";

/**
 * Account › Privacy — server actions (ADR-0029 §#331). Writes the two contact-visibility booleans on
 * the viewer's OWN Person row (`persons.hideEmail` / `persons.hidePhone`). Always scoped to the
 * signed-in account's `personId` — a viewer can only change their own visibility. These flags gate
 * co-member-facing contact READS and Invite-modal prefill; they NEVER touch system notification
 * delivery (see `person-invite-actions.ts` for the enforced read, and `person-emails.ts` for the
 * delivery path that intentionally ignores them).
 */
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import { getRuntime } from "@/lib/runtime";

type SaveResult = { ok: true } | { error: string };

async function requireAccount(): Promise<
  { db: Awaited<ReturnType<typeof getRuntime>>["db"]; personId: string } | { error: string }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "not_signed_in" };
  return { db, personId: ctx.personId };
}

export async function saveHideEmailAction(hideEmail: boolean): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await ctx.db
      .update(persons)
      .set({ hideEmail, updatedAt: new Date() })
      .where(eq(persons.id, ctx.personId));
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

export async function saveHidePhoneAction(hidePhone: boolean): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await ctx.db
      .update(persons)
      .set({ hidePhone, updatedAt: new Date() })
      .where(eq(persons.id, ctx.personId));
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}
