/**
 * Server actions for the hub's pending-invite confirm cards (issue #120).
 *
 * SECURITY: both actions RE-VERIFY that the invitation is genuinely surfaced to the caller's own
 * account before acting. Without that check, any logged-in user could POST an arbitrary
 * invitationId and `joinPendingInvite` would resolve its token and accept it — a join-any-invite
 * hole. The match list is the allow-list.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import {
  acceptInvitation,
  dismissInvitationForAccount,
  getInvitationTokenForDelivery,
  listPendingInvitationsForPerson,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

async function requireAccountContext() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");
  return { db, personId: ctx.personId };
}

/** True only when the invitation is currently surfaced to this account (the allow-list check). */
async function isSurfacedTo(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  personId: string,
  invitationId: string,
): Promise<boolean> {
  const matches = await listPendingInvitationsForPerson(db, personId);
  return matches.some((m) => m.invitationId === invitationId);
}

export async function joinPendingInvite(formData: FormData): Promise<void> {
  const { db, personId } = await requireAccountContext();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId || !(await isSurfacedTo(db, personId, invitationId))) {
    throw new Error(hub.pendingInvites.noLongerAvailable);
  }
  // Recover the durable token for the live invite (#116) and run the standard accept merge.
  const token = await getInvitationTokenForDelivery(db, invitationId);
  if (!token) throw new Error(hub.pendingInvites.noLongerAvailable);
  await acceptInvitation(db, { token, acceptedPersonId: personId });
  revalidatePath("/hub");
  redirect("/hub");
}

export async function dismissPendingInvite(formData: FormData): Promise<void> {
  const { db, personId } = await requireAccountContext();
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId || !(await isSurfacedTo(db, personId, invitationId))) {
    return; // already gone (accepted elsewhere, expired) — nothing to dismiss
  }
  const [self] = await db
    .select({ accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!self?.accountId) return;
  // "Not me" is per-account and never revokes the invite (#120).
  await dismissInvitationForAccount(db, {
    invitationId,
    accountId: self.accountId,
  });
  revalidatePath("/hub");
}
