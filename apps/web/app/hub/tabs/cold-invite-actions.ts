"use server";
/**
 * Cold (non-person-bound) Invite modal — server action backing `ColdInviteModal`.
 *
 * Mirrors `createPersonBoundMemberInviteAction` field-by-field, EXCEPT it mints a fresh provisional
 * invitee (no `existingInviteePersonId`) and returns a result in place instead of redirecting + a
 * flash cookie — the Family-surface Invite button opens a modal, so there is no Invite-tab page to
 * land on for a show-once result.
 *
 * Idle initial state for `useActionState` lives in the client modal — a `"use server"` file may only
 * export async functions.
 */
import {
  AlreadyFamilyMemberError,
  AuthorizationError,
  ThrottleError,
  createInvitation,
  listActiveFamiliesForPerson,
} from "@chronicle/core";
import { normalizePhone } from "@chronicle/notifications";
import { hub } from "@/app/_copy";
import { resolveInviteFamilyId } from "@/lib/invite-scope";
import { parseInviteIntent, planInviteChannels } from "@/lib/invite-delivery-channels";
import { parseInviteRelationship } from "@/lib/invite-relationship";
import { resolveInviteOrigin } from "@/lib/invite-origin";
import { getRuntime } from "@/lib/runtime";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { revalidatePath } from "next/cache";
import type { PersonInviteFormState } from "../tree/person-invite-actions";

export type ColdInviteFormState = PersonInviteFormState;

export async function createColdMemberInviteAction(
  _prevState: ColdInviteFormState,
  formData: FormData,
): Promise<ColdInviteFormState> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { status: "error", message: hub.invite.signedOut };

  const inviteeName = String(formData.get("inviteeName") ?? "").trim();
  const inviteeEmail = String(formData.get("inviteeEmail") ?? "").trim();
  const inviteePhoneRaw = String(formData.get("inviteePhone") ?? "").trim();
  const relationship = parseInviteRelationship(String(formData.get("relationship") ?? ""));
  const relationshipLabel =
    relationship === "other" ? "" : hub.invite.relationshipDisplayLabels[relationship];
  const intent = parseInviteIntent(String(formData.get("intent") ?? ""));
  if (!inviteeName) return { status: "error", message: hub.personInvite.genericError };

  const normalizedPhone = inviteePhoneRaw ? normalizePhone(inviteePhoneRaw) : null;
  if (inviteePhoneRaw && normalizedPhone === null) {
    return { status: "error", message: hub.invite.phoneInvalid };
  }
  if (!inviteeEmail && !normalizedPhone) {
    return { status: "error", message: hub.invite.identifierRequired };
  }
  const plan = planInviteChannels(intent, { email: inviteeEmail || null, normalizedPhone });
  if (!plan.ok) {
    return {
      status: "error",
      message: plan.reason === "email_required" ? hub.invite.emailRequired : hub.invite.phoneRequired,
    };
  }
  const channels = plan.channels;

  const activeFamilyIds = (await listActiveFamiliesForPerson(db, ctx.personId)).map((f) => f.familyId);
  let familyId: string;
  try {
    familyId = resolveInviteFamilyId(String(formData.get("familyId") ?? ""), activeFamilyIds);
  } catch {
    return { status: "error", message: hub.invite.familyRequired };
  }

  let invitationId: string;
  let token: string;
  try {
    ({ invitationId, token } = await createInvitation(db, {
      familyId,
      inviterPersonId: ctx.personId,
      inviteeName,
      inviteeEmail: inviteeEmail || undefined,
      inviteePhone: normalizedPhone ?? undefined,
      deliveryChannels: channels.length ? channels : undefined,
      relationshipLabel: relationshipLabel || undefined,
      relationship,
    }));
  } catch (err) {
    if (err instanceof ThrottleError) return { status: "error", message: hub.invite.throttled };
    if (err instanceof AlreadyFamilyMemberError) {
      return { status: "error", message: hub.invite.alreadyMember };
    }
    if (err instanceof AuthorizationError) {
      return { status: "error", message: hub.personInvite.genericError };
    }
    plogError("hub", "createColdMemberInvite: error", {
      family: familyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { status: "error", message: hub.personInvite.genericError };
  }

  if (channels.length) {
    try {
      await rt.dispatchInviteDelivery({ invitationId, channels });
    } catch (err) {
      plogError("hub", "createColdMemberInvite: delivery dispatch failed", {
        invitationId,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }

  const link = `${await resolveInviteOrigin()}/join/${token}`;
  const sendingTo = channels.length
    ? [
        channels.includes("email") && inviteeEmail ? inviteeEmail : null,
        channels.includes("sms") && normalizedPhone ? normalizedPhone : null,
      ]
        .filter((t): t is string => Boolean(t))
        .join(", ") || null
    : null;

  plog("hub", "createColdMemberInvite: success", { family: familyId });
  revalidatePath("/hub");
  return { status: "sent", link, sendingTo };
}
