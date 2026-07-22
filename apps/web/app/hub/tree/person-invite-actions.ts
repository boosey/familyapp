"use server";
/**
 * Person-bound Invite modal (#334, ADR-0028) — server actions backing `PersonInviteModal`.
 *
 * Two entry points:
 *   - `listPersonBoundInviteTargetsAction` — on open, resolves the modal's SERVER-PREPARED targets:
 *     the viewer's active families minus any the invitee already belongs to (#2), the single-family
 *     auto-seed, and a best-effort name/email/phone prefill. Never leaks a family list for a person the
 *     inviter has no standing to see (mirrors `createInvitation`'s own standing check, #333).
 *   - `createPersonBoundMemberInviteAction` — the write path, bound via `useActionState` (not a plain
 *     `<form action>`) so it can return `{ok,error}`/`{ok,sent}` IN PLACE instead of redirecting to
 *     `/hub?tab=invite` — the modal must never navigate the Tree/List surface away (#334 AC 1/4). Reuses
 *     the exact same validation/delivery helpers as the cold Invite tab's `createMemberInvite`
 *     (`InviteTab.tsx`), just anchored on an EXISTING Person via `existingInviteePersonId` (#333) and
 *     answering with a value instead of a redirect+flash-cookie.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  AlreadyFamilyMemberError,
  AuthorizationError,
  createInvitation,
  listActiveFamiliesForPerson,
  listActiveMembershipsForPerson,
  personVisibleToViewerAcrossFamilies,
  ThrottleError,
} from "@chronicle/core";
import { accountContacts, persons } from "@chronicle/db/schema";
import { normalizePhone } from "@chronicle/notifications";
import { beginLogContext, plog, plogError } from "@chronicle/pipeline";
import { revalidatePath } from "next/cache";
import { getRuntime } from "@/lib/runtime";
import { resolveInviteFamilyId } from "@/lib/invite-scope";
import { resolveInviteOrigin } from "@/lib/invite-origin";
import { parseInviteIntent, planInviteChannels } from "@/lib/invite-delivery-channels";
import { parseInviteRelationship } from "@/lib/invite-relationship";
import { resolvePersonInviteFamilies, type PersonInviteFamilyOption } from "@/lib/person-invite-targets";
import { hub } from "@/app/_copy";

export interface PersonInviteTargets {
  families: PersonInviteFamilyOption[];
  seededFamilyId: string | null;
  /** Best-effort display name from the Person row; "" when the Person carries none. */
  displayName: string;
  /** Best-effort prefill — modal-only state, never written back to the Person (#334 AC 3). */
  email: string;
  phone: string;
}

export type PersonInviteTargetsResult =
  | { ok: true; data: PersonInviteTargets }
  | { ok: false; error: "unauthorized" | "invalid" | "not-eligible" };

/**
 * Resolve the person-bound Invite modal's targets for `personId`. `personId` is UNTRUSTED and fully
 * re-validated: it must resolve to an identified, living Person the VIEWER has independent standing to
 * see (`personVisibleToViewerAcrossFamilies` — the same #333 hardening check `createInvitation` itself
 * enforces on write, checked again here so the modal never even DISPLAYS a stranger's name/families).
 */
export async function listPersonBoundInviteTargetsAction(
  personId: string,
): Promise<PersonInviteTargetsResult> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { ok: false, error: "unauthorized" };
  if (typeof personId !== "string" || !personId) return { ok: false, error: "invalid" };

  const [person] = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      identified: persons.identified,
      lifeStatus: persons.lifeStatus,
      accountId: persons.accountId,
    })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  if (!person) return { ok: false, error: "invalid" };
  if (!person.identified || person.lifeStatus !== "living") {
    return { ok: false, error: "not-eligible" };
  }

  const standing = await personVisibleToViewerAcrossFamilies(db, ctx.personId, person.id);
  if (!standing) return { ok: false, error: "not-eligible" };

  const [viewerFamilies, targetMemberships] = await Promise.all([
    listActiveFamiliesForPerson(db, ctx.personId),
    listActiveMembershipsForPerson(db, person.id),
  ]);
  const targetFamilyIds = targetMemberships.map((m) => m.familyId);
  const { families, seededFamilyId } = resolvePersonInviteFamilies(
    viewerFamilies.map((f) => ({ id: f.familyId, name: f.familyName, shortName: f.familyShortName })),
    targetFamilyIds,
  );

  // Prefill (best-effort, MODAL-ONLY — never written back to the Person, #334 AC 3): only when the
  // invitee has an Account AND the viewer shares an ACTIVE co-membership with them in some family
  // (stronger than the general "standing" check above, which also admits kinship-edge visibility with
  // no shared family) — mirrors the trust boundary `findActiveFamilyMemberByContact` already uses for
  // the cold path's duplicate-member guard. Verified contacts only (`verifiedAt` not null).
  let email = "";
  let phone = "";
  const viewerFamilyIds = new Set(viewerFamilies.map((f) => f.familyId));
  const sharesActiveFamily = targetFamilyIds.some((id) => viewerFamilyIds.has(id));
  if (person.accountId && sharesActiveFamily) {
    const contacts = await db
      .select({ kind: accountContacts.kind, value: accountContacts.value })
      .from(accountContacts)
      .where(
        and(eq(accountContacts.accountId, person.accountId), isNotNull(accountContacts.verifiedAt)),
      );
    for (const c of contacts) {
      if (c.kind === "email" && !email) email = c.value;
      if (c.kind === "phone" && !phone) phone = c.value;
    }
  }

  return {
    ok: true,
    data: {
      families,
      seededFamilyId,
      displayName: person.displayName?.trim() || "",
      email,
      phone,
    },
  };
}

export type PersonInviteFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "sent"; link: string; sendingTo: string | null };

export const PERSON_INVITE_IDLE_STATE: PersonInviteFormState = { status: "idle" };

/**
 * The write path, bound to `MemberInviteForm` via `useActionState` (see `PersonInviteModal`). Mirrors
 * `InviteTab.tsx`'s `createMemberInvite` field-by-field, EXCEPT it anchors on an existing Person
 * (`existingInviteePersonId`, #333) and returns a result instead of redirecting + a flash cookie — the
 * modal must stay mounted over Tree/List (#334 AC 1/4), so there is no page to redirect TO.
 */
export async function createPersonBoundMemberInviteAction(
  _prevState: PersonInviteFormState,
  formData: FormData,
): Promise<PersonInviteFormState> {
  "use server";
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { status: "error", message: hub.invite.signedOut };

  const existingInviteePersonId = String(formData.get("existingInviteePersonId") ?? "").trim();
  if (!existingInviteePersonId) {
    return { status: "error", message: hub.personInvite.genericError };
  }

  const inviteeName = String(formData.get("inviteeName") ?? "").trim();
  const inviteeEmail = String(formData.get("inviteeEmail") ?? "").trim();
  const inviteePhoneRaw = String(formData.get("inviteePhone") ?? "").trim();
  // #164 (ADR-0023): the STRUCTURED relationship picker drives tree placement — same fixed vocabulary
  // and "other" fallback as the cold path.
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

  // Server-side family-target guard (mirrors InviteTab's createMemberInvite): resolve against the
  // viewer's OWN active families so a crafted POST can't target an arbitrary family.
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
      existingInviteePersonId,
    }));
  } catch (err) {
    if (err instanceof ThrottleError) return { status: "error", message: hub.invite.throttled };
    if (err instanceof AlreadyFamilyMemberError) {
      return { status: "error", message: hub.invite.alreadyMember };
    }
    if (err instanceof AuthorizationError) {
      return { status: "error", message: hub.personInvite.genericError };
    }
    plogError("tree", "createPersonBoundMemberInvite: error", {
      family: familyId,
      person: existingInviteePersonId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { status: "error", message: hub.personInvite.genericError };
  }

  if (channels.length) {
    try {
      // Only the invitation id + channels cross this seam — the raw token never transits the async
      // delivery dispatch; both delivery paths recover it server-side.
      await rt.dispatchInviteDelivery({ invitationId, channels });
    } catch (err) {
      // Delivery dispatch must NEVER block invite creation or the copy-link fallback below.
      plogError("tree", "createPersonBoundMemberInvite: delivery dispatch failed", {
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

  plog("tree", "createPersonBoundMemberInvite: success", { family: familyId, person: existingInviteePersonId });
  // Person details stays open (#334 AC 4) — this only refreshes server-rendered data underneath it
  // (e.g. the invitee's `inviteStatus` flips to `pending`), never a navigation.
  revalidatePath("/hub");
  return { status: "sent", link, sendingTo };
}
