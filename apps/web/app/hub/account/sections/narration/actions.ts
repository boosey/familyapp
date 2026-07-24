"use server";

/**
 * Account › Narration server actions (#351 / ADR-0029). Persist the two per-narrator booleans on the
 * `persons` row. Auth is resolved server-side (personId is NEVER trusted from the client) exactly as
 * the Profile section's actions do. Both flags are stored as *opt-out* (default false = the behaviour
 * is ON), so the UI's "on" toggle maps to `optOut = false`.
 */
import { setFollowUpsOptOut, setAskSuggestionOptOut } from "@chronicle/core";
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

/**
 * Save the follow-up preference. `enabled` is the narrator-facing value ("ask me follow-ups"); it is
 * stored inverted as `followUpsOptOut`. When off, the follow-up cascade short-circuits at the top (no
 * evaluation LLM, no ask) and records an audited `suppressed_narrator_opt_out` disposition. Memory
 * extraction (a separate post-approval pipeline) is unaffected.
 */
export async function saveFollowUpsEnabledAction(enabled: boolean): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await setFollowUpsOptOut(ctx.db, ctx.personId, !enabled);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

/**
 * Save the ask-suggestion preference. `enabled` is the narrator-facing value ("suggest better
 * wording"); stored inverted as `askSuggestionOptOut`. No code path consumes this flag yet — the
 * helper is not built — so this is persist-only for now (ADR-0029).
 */
export async function saveAskSuggestionEnabledAction(enabled: boolean): Promise<SaveResult> {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await setAskSuggestionOptOut(ctx.db, ctx.personId, !enabled);
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}
