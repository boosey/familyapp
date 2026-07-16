/**
 * Pure Clerk-webhook dispatch (issue #10) — factored out of the route handler so it can be unit-tested
 * without Clerk signature verification or Next.js request context.
 *
 * The route handler (app/api/webhooks/clerk/route.ts) owns the ONE vendor touch: `verifyWebhook` from
 * @clerk/nextjs. Everything below is provider-shape-in, domain-effect-out, driven by a real PGlite DB
 * in tests. We depend on a NARROW slice of Clerk's `user.updated` / `user.deleted` payloads (snake_case,
 * as Clerk delivers them) so an SDK bump is a non-event — the same discipline as `clerk-server.ts`.
 *
 * Dispatch policy:
 *   - `user.updated`  → `reconcileAccountProfile` (rename/email drift; spokenName is left untouched).
 *   - `user.deleted`  → `deactivateAccountByAuthProviderUserId` (SOFT-delete: sever login, keep content).
 *   - anything else   → ignored (a benign no-op; Clerk still gets its 2xx).
 * Every path is idempotent, so a Clerk retry/replay is safe.
 */
import "server-only";
import {
  deactivateAccountByAuthProviderUserId,
  reconcileAccountProfile,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";
import { clerkDisplayName } from "./clerk-server";

/** The narrow slice of Clerk's webhook envelope we consume. `data` shape depends on `type`. */
export interface ClerkWebhookEventLite {
  type: string;
  data: ClerkUserJson | ClerkDeletedJson | Record<string, unknown>;
}

/** Clerk `user.*` payload (snake_case). Only the fields we read are typed. */
export interface ClerkUserJson {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: { id: string; email_address: string }[];
  primary_email_address_id?: string | null;
}

/** Clerk `*.deleted` payload — the object id plus a `deleted` marker. */
export interface ClerkDeletedJson {
  id?: string;
  deleted?: boolean;
}

/** Resolve the primary email from a Clerk user payload, or null when none is marked primary. */
export function primaryEmailOf(data: ClerkUserJson): string | null {
  const list = data.email_addresses ?? [];
  const primary = data.primary_email_address_id
    ? list.find((e) => e.id === data.primary_email_address_id)
    : undefined;
  return primary?.email_address ?? list[0]?.email_address ?? null;
}

/** Outcome of dispatching one event — returned so the route can log/observe (not sent to Clerk). */
export interface ClerkWebhookOutcome {
  /** The event type we saw. */
  type: string;
  /** What we did: reconciled a profile, deactivated an account, or ignored an unhandled type. */
  action: "reconciled" | "deactivated" | "ignored";
  /** Whether a matching Account existed (false for update/delete of a never-provisioned user). */
  matched?: boolean;
}

/**
 * Apply one verified Clerk webhook event to the DB. Pure w.r.t. Clerk — the caller has already
 * verified the signature and parsed the JSON. Unknown / unhandled types are ignored (still a success
 * from Clerk's perspective). Never throws for a normal payload; a genuine DB failure propagates so the
 * route returns non-2xx and Clerk retries.
 */
export async function applyClerkWebhookEvent(
  db: Database,
  evt: ClerkWebhookEventLite,
): Promise<ClerkWebhookOutcome> {
  if (evt.type === "user.updated") {
    const data = evt.data as ClerkUserJson;
    if (!data?.id) return { type: evt.type, action: "ignored" };
    // Reuse the JIT-provisioning name rule, but only PASS a name when the provider actually sent one
    // (first/last present) — `clerkDisplayName` falls back to email/"Family member", which we must not
    // write over a good in-app-edited Person name. The core reconciler treats blank as leave-untouched.
    const hasName = Boolean((data.first_name ?? "").trim() || (data.last_name ?? "").trim());
    const email = primaryEmailOf(data);
    const displayName = hasName
      ? clerkDisplayName({
          id: data.id,
          firstName: data.first_name ?? null,
          lastName: data.last_name ?? null,
          primaryEmailAddress: email ? { emailAddress: email } : null,
        })
      : undefined;
    const result = await reconcileAccountProfile(db, {
      authProviderUserId: data.id,
      email,
      displayName,
    });
    return { type: evt.type, action: "reconciled", matched: result.matched };
  }

  if (evt.type === "user.deleted") {
    const data = evt.data as ClerkDeletedJson;
    // Defensive: a malformed deleted-event without an id can do nothing but be ignored.
    if (!data?.id) return { type: evt.type, action: "ignored" };
    const result = await deactivateAccountByAuthProviderUserId(db, data.id);
    return { type: evt.type, action: "deactivated", matched: result.matched };
  }

  return { type: evt.type, action: "ignored" };
}
