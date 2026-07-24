"use server";

/**
 * Account › Memories — server actions (ADR-0029 §#357).
 *
 * DAY-1 DATA LAYER: memories are backed by `persons.biographical_anchors`. Editing a memory writes the
 * corresponding anchor; "forgetting" a memory clears it to null. These actions are the seam that swaps
 * when the append-only `narrator_memory` ledger lands (#362): the ledger's `edit = supersede` and
 * `delete = dismiss` will replace the body here, but the section's action signatures (keyed by a stable
 * memory id) stay stable so the client + UI don't move.
 *
 * "User-stated facts win": a user editing their own anchor IS the user stating a fact, so it always
 * takes effect. The precedence rule only stops *extraction* from silently overwriting a set value — it
 * never blocks the person themselves. Self-only: the acting Person can only touch their own anchors.
 */
import type { BiographicalProfile } from "@chronicle/db";
import { updateBiographicalAnchor } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";

type SaveResult = { ok: true } | { error: string };

/** The anchor keys this section surfaces as memories. Stable ids in the anchor era. */
const TEXT_ANCHOR_KEYS = [
  "hometown",
  "siblingContext",
  "currentLocation",
  "occupationSummary",
] as const;
const BOOL_ANCHOR_KEYS = ["hasChildren", "hasGrandchildren"] as const;

type TextAnchorKey = (typeof TEXT_ANCHOR_KEYS)[number];
type BoolAnchorKey = (typeof BOOL_ANCHOR_KEYS)[number];

const TEXT_KEY_SET: ReadonlySet<string> = new Set(TEXT_ANCHOR_KEYS);
const BOOL_KEY_SET: ReadonlySet<string> = new Set(BOOL_ANCHOR_KEYS);

async function requireAccount(): Promise<
  { db: Awaited<ReturnType<typeof getRuntime>>["db"]; personId: string } | { error: string }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: "not_signed_in" };
  return { db, personId: ctx.personId };
}

/**
 * Edit a text-valued memory (hometown, siblings, current location, occupation). An empty string clears
 * it. In the ledger era this becomes "supersede the active memory with a user-authored revision".
 */
export async function saveTextMemoryAction(key: string, value: string): Promise<SaveResult> {
  if (!TEXT_KEY_SET.has(key)) return { error: "save_failed" };
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  const trimmed = value.trim();
  try {
    await updateBiographicalAnchor(
      ctx.db,
      ctx.personId,
      key as TextAnchorKey,
      trimmed === "" ? null : trimmed,
    );
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

/**
 * Edit a yes/no memory (has children, has grandchildren). `null` clears it. Clearing `hasChildren` to
 * `false` also clears the dependent `hasGrandchildren`, mirroring the profile editor.
 */
export async function saveBoolMemoryAction(
  key: string,
  value: boolean | null,
): Promise<SaveResult> {
  if (!BOOL_KEY_SET.has(key)) return { error: "save_failed" };
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx;
  try {
    await updateBiographicalAnchor(ctx.db, ctx.personId, key as BoolAnchorKey, value);
    if (key === "hasChildren" && value !== true) {
      await updateBiographicalAnchor(ctx.db, ctx.personId, "hasGrandchildren", null);
    }
    return { ok: true };
  } catch {
    return { error: "save_failed" };
  }
}

/**
 * "Forget this" — clear a memory to null. In the ledger era this becomes `status = dismissed` on the
 * memory row (a dismissal, not a hard delete, because the ledger is append-only).
 */
export async function forgetMemoryAction(key: string): Promise<SaveResult> {
  if (TEXT_KEY_SET.has(key)) return saveTextMemoryAction(key, "");
  if (BOOL_KEY_SET.has(key)) return saveBoolMemoryAction(key, null);
  return { error: "save_failed" };
}

// Re-export the anchor type so the section can key its view model off the same source of truth.
export type { BiographicalProfile };

/**
 * STUB — createCustomMemoryAction. This is an intentional seam for the Account › Memories "Add a
 * memory" UI, awaiting the narrator_memory ledger (issue #362), which is being built in a separate
 * workstream and will be wired in here later. Do not remove this stub without wiring real persistence.
 */
export async function createCustomMemoryAction(
  _title: string,
  _summary: string,
): Promise<{ ok: true } | { error: string }> {
  return { error: "not_yet_available" };
}
