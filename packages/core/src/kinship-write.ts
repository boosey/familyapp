/**
 * Kinship WRITE surface (ADR-0016, issue #32) — `addRelative`.
 *
 * The FIRST kinship write path. Parallel to (and NOT part of) the Story front door: kinship is its
 * own authorized surface (see kinship-repository.ts). The guarded `@chronicle/db/kinship` tables are
 * reachable only from the kinship allowlist, so this file is on it.
 *
 * Model (ADR-0016): only the two GENERATIVE primitives are stored — `parent_of` and
 * `partnered_with`. Every richer relation the user picks (grandparent, sibling, …) is expressed in
 * terms of those primitives, minting an anonymous BRIDGE Person when the graph needs a middle node.
 * First-asserter-wins: the edge is appended `asserted` and is immediately family-visible, no
 * endpoint confirmation. Every insert normalizes its endpoints via `normalizeEdgeEndpoints` (shared
 * with the read side) so partnered_with (A,B)/(B,A) collapse to one logical edge.
 */
import { and, eq } from "drizzle-orm";
import { kinshipAssertions } from "@chronicle/db/kinship";
import { families, persons } from "@chronicle/db/schema";
import type { Database, KinshipEdgeType, KinshipNature } from "@chronicle/db";
import type { AuthContext } from "./authorization";
import { isActiveMember } from "./memberships";
import { normalizeEdgeEndpoints } from "./kinship-repository";

export type AddRelativeRelation = "parent" | "child" | "partner" | "grandparent" | "sibling";

export interface AddRelativeInput {
  familyId: string;
  relation: AddRelativeRelation;
  /** Trimmed non-empty => identified mention; empty/absent => anonymous bridge relative (identified=false). */
  displayName?: string | null;
  /** Optional calendar date "YYYY-MM-DD". */
  birthDate?: string | null;
  birthYear?: number | null;
  lifeStatus?: "living" | "deceased";
  /** For parent_of edges; default "unknown". */
  nature?: KinshipNature;
}

export interface AddRelativeResult {
  allowed: boolean;
  reason?: string;
  /** The relative. */
  createdPersonId?: string;
  /** Implicit anonymous middle node, when one was created. */
  bridgePersonId?: string;
  /** Ids of the appended kinshipAssertions rows. */
  edgeIds?: string[];
}

/** A handle that is either the pooled client or an open transaction. */
type DbOrTx = Pick<Database, "select" | "insert">;

/**
 * Insert a `mention` Person. An identified mention carries `displayName` + `spokenName` (the first
 * whitespace-delimited word, mirroring `defaultSpokenName`); an anonymous bridge/placeholder carries
 * neither (both null, `identified=false`) and is rendered from its relation, never a name.
 */
async function insertMentionPerson(
  db: DbOrTx,
  opts: {
    displayName: string | null;
    birthDate?: string | null;
    birthYear?: number | null;
    lifeStatus: "living" | "deceased";
  },
): Promise<string> {
  const identified = opts.displayName !== null;
  const spokenName = identified ? (opts.displayName!.split(/\s+/)[0] ?? null) : null;
  const [row] = await db
    .insert(persons)
    .values({
      displayName: opts.displayName,
      spokenName,
      origin: "mention",
      identified,
      lifeStatus: opts.lifeStatus,
      birthDate: opts.birthDate ?? null,
      birthYear: opts.birthYear ?? null,
      accountId: null,
    })
    .returning({ id: persons.id });
  return row!.id;
}

/** Append one `parent_of` edge (parent -> child), normalized, `asserted`, actor = `me`. */
async function insertParentOf(
  db: DbOrTx,
  familyId: string,
  actorPersonId: string,
  parentId: string,
  childId: string,
  nature: KinshipNature,
): Promise<string> {
  const { personAId, personBId } = normalizeEdgeEndpoints("parent_of", parentId, childId);
  const [row] = await db
    .insert(kinshipAssertions)
    .values({
      familyId,
      edgeType: "parent_of",
      personAId,
      personBId,
      nature,
      state: "asserted",
      actorPersonId,
    })
    .returning({ id: kinshipAssertions.id });
  return row!.id;
}

/** Append one `partnered_with` edge (undirected), normalized, `asserted`, nature null. */
async function insertPartneredWith(
  db: DbOrTx,
  familyId: string,
  actorPersonId: string,
  p1: string,
  p2: string,
): Promise<string> {
  const { personAId, personBId } = normalizeEdgeEndpoints("partnered_with", p1, p2);
  const [row] = await db
    .insert(kinshipAssertions)
    .values({
      familyId,
      edgeType: "partnered_with",
      personAId,
      personBId,
      nature: null,
      state: "asserted",
      actorPersonId,
    })
    .returning({ id: kinshipAssertions.id });
  return row!.id;
}

/**
 * The CURRENT recorded parents of `childId` in this family: the distinct `personAId` of every
 * visible `parent_of` edge whose child is `childId`. Read directly from the ledger inside this
 * allowlisted file (a `parent_of` write only supersedes, never deletes, so the latest-state nuance
 * of the full projection is unnecessary for "does a parent link exist" — but we still exclude
 * denied rows via a latest-state pass to avoid re-bridging over a Steward-denied link).
 */
async function currentParentIdsOf(
  db: DbOrTx,
  familyId: string,
  childId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      seq: kinshipAssertions.seq,
      parentId: kinshipAssertions.personAId,
      state: kinshipAssertions.state,
    })
    .from(kinshipAssertions)
    .where(
      and(
        eq(kinshipAssertions.familyId, familyId),
        eq(kinshipAssertions.edgeType, "parent_of"),
        eq(kinshipAssertions.personBId, childId),
      ),
    );
  // Latest state per parent (by seq); keep only those whose latest state is not `denied`.
  const latest = new Map<string, { seq: number; state: string }>();
  for (const r of rows) {
    const cur = latest.get(r.parentId);
    if (cur === undefined || r.seq > cur.seq) latest.set(r.parentId, { seq: r.seq, state: r.state });
  }
  const out: string[] = [];
  for (const [parentId, v] of latest) {
    if (v.state !== "denied") out.push(parentId);
  }
  return out;
}

/**
 * Add a relative of the signed-in Person to a family, first-asserter-wins. Re-resolves auth and
 * active membership server-side (never trusts the client). Creates the relative Person as a
 * `mention` (identified iff a real name is given) and appends the primitive edge(s) that express the
 * chosen relation, minting an anonymous bridge node for grandparent/sibling when `me` has no
 * recorded parent yet. Returns the created ids. See ADR-0016 and the plan's section A.
 */
export async function addRelative(
  db: Database,
  ctx: AuthContext,
  input: AddRelativeInput,
): Promise<AddRelativeResult> {
  if (ctx.kind !== "account") {
    return { allowed: false, reason: "not signed in" };
  }
  const me = ctx.personId;

  if (!(await isActiveMember(db, me, input.familyId))) {
    return { allowed: false, reason: "not a member of this family" };
  }

  const familyId = input.familyId;
  const nature: KinshipNature = input.nature ?? "unknown";
  const lifeStatus = input.lifeStatus ?? "living";
  const trimmed = input.displayName?.trim();
  const relativeDisplayName = trimmed ? trimmed : null;

  return db.transaction(async (tx) => {
    const createdPersonId = await insertMentionPerson(tx, {
      displayName: relativeDisplayName,
      birthDate: input.birthDate ?? null,
      birthYear: input.birthYear ?? null,
      lifeStatus,
    });

    const edgeIds: string[] = [];
    let bridgePersonId: string | undefined;

    switch (input.relation) {
      case "parent": {
        edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, me, nature));
        break;
      }
      case "child": {
        edgeIds.push(await insertParentOf(tx, familyId, me, me, createdPersonId, nature));
        break;
      }
      case "partner": {
        edgeIds.push(await insertPartneredWith(tx, familyId, me, me, createdPersonId));
        break;
      }
      case "grandparent": {
        const parents = await currentParentIdsOf(tx, familyId, me);
        if (parents.length > 0) {
          // Attach the grandparent above each existing parent (R is parent of each P).
          for (const p of parents) {
            edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, p, nature));
          }
        } else {
          // No parent yet: mint one anonymous bridge parent B, then B->me and R->B.
          bridgePersonId = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living" });
          edgeIds.push(await insertParentOf(tx, familyId, me, bridgePersonId, me, nature));
          edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, bridgePersonId, nature));
        }
        break;
      }
      case "sibling": {
        const parents = await currentParentIdsOf(tx, familyId, me);
        if (parents.length > 0) {
          // Share each existing parent (P is parent of R too).
          for (const p of parents) {
            edgeIds.push(await insertParentOf(tx, familyId, me, p, createdPersonId, nature));
          }
        } else {
          // No parent yet: mint one anonymous bridge parent B, parent of both me and R.
          bridgePersonId = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living" });
          edgeIds.push(await insertParentOf(tx, familyId, me, bridgePersonId, me, nature));
          edgeIds.push(await insertParentOf(tx, familyId, me, bridgePersonId, createdPersonId, nature));
        }
        break;
      }
    }

    const result: AddRelativeResult = { allowed: true, createdPersonId, edgeIds };
    if (bridgePersonId !== undefined) result.bridgePersonId = bridgePersonId;
    return result;
  });
}

// ===========================================================================
// Steward governance (issue #33) + subject-hide veto (issue #34).
//
// LOAD-BEARING invariant (ADR-0016, user clarification): the Steward is NOT a
// visibility gate. An asserted edge is fact IMMEDIATELY (first-asserter-wins,
// handled by `addRelative` above and the read projection). Steward `affirm` is
// an OPTIONAL endorsement; `deny`/`correct` are after-the-fact moderation. A
// subject `hide` (#34) overrides even a steward affirm. None of the functions
// below add an approval prerequisite to the read side — they only append new
// superseding ledger rows, which the projection already resolves latest-wins.
// ===========================================================================

/**
 * A logical kinship edge, identified the way the ledger keys it. Callers pass raw endpoints; every
 * function normalizes via `normalizeEdgeEndpoints` before touching the ledger, so partnered_with
 * (A,B)/(B,A) collapse and parent_of stays directed.
 */
export interface EdgeRef {
  familyId: string;
  edgeType: KinshipEdgeType;
  /** parent_of: the PARENT. partnered_with: either endpoint (normalized before use). */
  personAId: string;
  /** parent_of: the CHILD. partnered_with: the other endpoint. */
  personBId: string;
}

/** Result of a governance / hide action. Mirrors `AddRelativeResult`'s allow-or-reason shape; the
 *  auth-denial path returns `{allowed:false, reason}` rather than throwing. */
export interface KinshipEdgeActionResult {
  allowed: boolean;
  reason?: string;
  /** The id of the appended row (assertion transition, or subject-hide row), when one was written. */
  edgeId?: string;
}

/** The family's steward Person id, or null if the family does not exist. Local read (families is not
 *  a guarded content/kinship table). */
async function stewardPersonIdOf(db: DbOrTx, familyId: string): Promise<string | null> {
  const [row] = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  return row?.stewardPersonId ?? null;
}

/**
 * Resolve the CURRENT ledger row for a logical edge (latest by seq), or null if the edge was never
 * asserted in this family. Used to (a) verify the edge exists before a steward transition and (b)
 * confirm hide targets a real edge. Reads directly in this allowlisted file — this is a governance
 * pre-check, not the family-visibility projection, so it looks at ALL states (even a latest `denied`
 * row still counts as an existing edge a steward may correct back).
 */
async function latestEdgeRow(
  db: DbOrTx,
  ref: EdgeRef,
): Promise<{
  personAId: string;
  personBId: string;
  state: string;
  nature: KinshipNature | null;
} | null> {
  const { personAId, personBId } = normalizeEdgeEndpoints(ref.edgeType, ref.personAId, ref.personBId);
  const rows = await db
    .select({
      seq: kinshipAssertions.seq,
      personAId: kinshipAssertions.personAId,
      personBId: kinshipAssertions.personBId,
      state: kinshipAssertions.state,
      nature: kinshipAssertions.nature,
    })
    .from(kinshipAssertions)
    .where(
      and(
        eq(kinshipAssertions.familyId, ref.familyId),
        eq(kinshipAssertions.edgeType, ref.edgeType),
        eq(kinshipAssertions.personAId, personAId),
        eq(kinshipAssertions.personBId, personBId),
      ),
    );
  if (rows.length === 0) return null;
  let latest = rows[0]!;
  for (const r of rows) if (r.seq > latest.seq) latest = r;
  return {
    personAId: latest.personAId,
    personBId: latest.personBId,
    state: latest.state,
    nature: latest.nature,
  };
}

/**
 * Shared server-side gate for a STEWARD governance action: the actor must be a real account AND be
 * THIS family's steward, and the target edge must already exist. Returns the normalized endpoints on
 * success, or a `{allowed:false, reason}` failure the callers propagate verbatim.
 */
async function requireStewardOverExistingEdge(
  db: DbOrTx,
  ctx: AuthContext,
  ref: EdgeRef,
): Promise<
  | { ok: true; personAId: string; personBId: string; nature: KinshipNature | null }
  | { ok: false; result: KinshipEdgeActionResult }
> {
  if (ctx.kind !== "account") {
    return { ok: false, result: { allowed: false, reason: "not signed in" } };
  }
  const steward = await stewardPersonIdOf(db, ref.familyId);
  if (steward === null) {
    return { ok: false, result: { allowed: false, reason: "family not found" } };
  }
  if (steward !== ctx.personId) {
    return { ok: false, result: { allowed: false, reason: "only the family steward may govern this edge" } };
  }
  const existing = await latestEdgeRow(db, ref);
  if (existing === null) {
    return { ok: false, result: { allowed: false, reason: "edge does not exist in this family" } };
  }
  return {
    ok: true,
    personAId: existing.personAId,
    personBId: existing.personBId,
    nature: existing.nature,
  };
}

/** Append one governance transition row (affirmed / denied / corrected) on an existing edge, actor =
 *  the steward. Carries `nature` for parent_of, null for partnered_with, and an optional `note`. */
async function appendGovernanceRow(
  db: DbOrTx,
  ref: EdgeRef,
  personAId: string,
  personBId: string,
  actorPersonId: string,
  state: "affirmed" | "denied" | "corrected",
  nature: KinshipNature | null,
  note: string | null,
): Promise<string> {
  const [row] = await db
    .insert(kinshipAssertions)
    .values({
      familyId: ref.familyId,
      edgeType: ref.edgeType,
      personAId,
      personBId,
      nature,
      state,
      actorPersonId,
      note,
    })
    .returning({ id: kinshipAssertions.id });
  return row!.id;
}

/**
 * Steward AFFIRMS an existing edge (#33): an OPTIONAL endorsement, never a visibility prerequisite.
 * Appends one superseding `affirmed` row (append-only; the original assertion is never mutated). The
 * projection then shows `state: "affirmed"` with the original asserter preserved as `assertedBy`.
 */
export async function affirmEdge(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
  note?: string | null,
): Promise<KinshipEdgeActionResult> {
  const gate = await requireStewardOverExistingEdge(db, ctx, ref);
  if (!gate.ok) return gate.result;
  const edgeId = await appendGovernanceRow(
    db,
    ref,
    gate.personAId,
    gate.personBId,
    (ctx as { personId: string }).personId,
    "affirmed",
    natureToCarryForward(ref.edgeType, gate.nature),
    note ?? null,
  );
  return { allowed: true, edgeId };
}

/**
 * Steward DENIES an existing edge (#33): after-the-fact moderation. Appends one superseding `denied`
 * row; the read projection then omits the edge (VISIBLE_STATES excludes `denied`) while every
 * historical row survives (append-only). An optional `note` records the reason.
 */
export async function denyEdge(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
  note?: string | null,
): Promise<KinshipEdgeActionResult> {
  const gate = await requireStewardOverExistingEdge(db, ctx, ref);
  if (!gate.ok) return gate.result;
  const edgeId = await appendGovernanceRow(
    db,
    ref,
    gate.personAId,
    gate.personBId,
    (ctx as { personId: string }).personId,
    "denied",
    natureToCarryForward(ref.edgeType, gate.nature),
    note ?? null,
  );
  return { allowed: true, edgeId };
}

export interface CorrectEdgeInput {
  ref: EdgeRef;
  /** The corrected `nature` for a `parent_of` edge. Correction is scoped to NATURE (part of the
   *  mutable payload, not the edge key). Endpoint correction is expressed as deny + a fresh assertion,
   *  not here — see the plan doc. */
  nature: KinshipNature;
  note?: string | null;
}

/**
 * Steward CORRECTS an existing `parent_of` edge's `nature` (#33): a superseding `corrected` row that
 * restores visibility (corrected is a VISIBLE_STATE) with the new nature. Rejected for
 * `partnered_with` (which carries no nature). Endpoint correction (wrong parent/child) is out of
 * scope for `correctEdge` — the steward denies the wrong edge and a fresh edge is asserted; that keeps
 * this operation a clean same-edge-key supersede and avoids inventing a second logical edge inside a
 * "correct". Append-only; the original row is untouched.
 */
export async function correctEdge(
  db: Database,
  ctx: AuthContext,
  input: CorrectEdgeInput,
): Promise<KinshipEdgeActionResult> {
  if (input.ref.edgeType !== "parent_of") {
    return {
      allowed: false,
      reason: "only a parent_of edge's nature can be corrected (partnered_with has no nature)",
    };
  }
  const gate = await requireStewardOverExistingEdge(db, ctx, input.ref);
  if (!gate.ok) return gate.result;
  const edgeId = await appendGovernanceRow(
    db,
    input.ref,
    gate.personAId,
    gate.personBId,
    (ctx as { personId: string }).personId,
    "corrected",
    input.nature,
    input.note ?? null,
  );
  return { allowed: true, edgeId };
}

/**
 * `nature` must be present for parent_of, null for partnered_with (DB check constraint). Affirm/deny
 * are pure supersedes that must NOT lose information, so they CARRY FORWARD the edge's current nature
 * (the latest row's value) rather than resetting it — otherwise an affirm after a `correctEdge` to
 * `adoptive` would silently write `unknown` and clobber the correction. `unknown` is used only as a
 * defensive fallback for the (constraint-impossible) case of a parent_of edge whose latest nature is
 * null. Only `correctEdge` supplies a NEW nature value.
 */
function natureToCarryForward(
  edgeType: KinshipEdgeType,
  currentNature: KinshipNature | null,
): KinshipNature | null {
  if (edgeType === "partnered_with") return null;
  return currentNature ?? "unknown";
}
