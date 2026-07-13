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
import { kinshipAssertions, kinshipSubjectHides } from "@chronicle/db/kinship";
import { families, persons } from "@chronicle/db/schema";
import type { Database, KinshipEdgeType, KinshipNature, PersonSex } from "@chronicle/db";
import type { AuthContext } from "./authorization";
import { isActiveMember } from "./memberships";
import { normalizeEdgeEndpoints, resolveKinshipProjection } from "./kinship-repository";

export type AddRelativeRelation = "parent" | "child" | "partner" | "grandparent" | "sibling";

export interface AddRelativeInput {
  familyId: string;
  relation: AddRelativeRelation;
  /**
   * ADR-0016 tree renderer (panel Add-relative): the person the relative attaches TO. Defaults to the
   * viewer. The viewer (actor) must be an active family member; the anchor must be someone the actor
   * can legitimately attach to in THIS family — an active member, or a person already visible in the
   * family's kinship projection (a mention/bridge node). Assertions are first-asserter-wins, so
   * anchoring on another visible person grants no new authority — it only records a relationship that
   * isn't about the actor.
   */
  anchorPersonId?: string;
  /** Trimmed non-empty => identified mention; empty/absent => anonymous bridge relative (identified=false). */
  displayName?: string | null;
  /** Optional calendar date "YYYY-MM-DD". */
  birthDate?: string | null;
  birthYear?: number | null;
  lifeStatus?: "living" | "deceased";
  /**
   * ADR-0016 tree renderer — captured only when lifeStatus = "deceased". `deathDate` is a calendar
   * date "YYYY-MM-DD"; `deathYear` the coarse anchor shown on tree nodes. Both optional/nullable.
   */
  deathDate?: string | null;
  deathYear?: number | null;
  /** For parent_of edges; default "unknown". */
  nature?: KinshipNature;
  /** ADR-0016 tree renderer — the relative's sex. Omitted => `"unknown"` (never inferred). */
  sex?: PersonSex;
  /**
   * ONLY for relation="child": also record this person as a second parent of the child; must be
   * attachable in the family — typically the anchor's partner. Ignored for every other relation.
   */
  coParentPersonId?: string;
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
 * Is `candidatePersonId` attachable in `familyId`: an active member, or a person already visible in
 * the family's kinship projection (a mention/bridge node). Shared by the anchor validation and the
 * co-parent validation (both need the identical "attachable in THIS family" rule).
 */
async function isAttachableInFamily(
  db: Database,
  ctx: AuthContext,
  familyId: string,
  candidatePersonId: string,
): Promise<boolean> {
  if (await isActiveMember(db, candidatePersonId, familyId)) return true;
  const { edges } = await resolveKinshipProjection(db, ctx, familyId);
  for (const e of edges) {
    if (e.personAId === candidatePersonId || e.personBId === candidatePersonId) return true;
  }
  return false;
}

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
    deathDate?: string | null;
    deathYear?: number | null;
    /** ADR-0016 tree renderer. Omitted => `"unknown"` — a bridge/placeholder's sex is always unknown. */
    sex?: PersonSex;
  },
): Promise<string> {
  const identified = opts.displayName !== null;
  const spokenName = identified ? (opts.displayName!.split(/\s+/)[0] ?? null) : null;
  // Death fields are meaningful only for a deceased Person (ADR-0016 tree renderer). We defensively
  // NULL them for a living relative so a stale/forged death year on a living node can never persist.
  const deceased = opts.lifeStatus === "deceased";
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
      deathDate: deceased ? (opts.deathDate ?? null) : null,
      deathYear: deceased ? (opts.deathYear ?? null) : null,
      accountId: null,
      sex: opts.sex ?? "unknown",
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

  // Resolve + validate the anchor (the person the relative attaches TO; defaults to the viewer).
  // Anchoring on someone else grants no new authority (first-asserter-wins), so we only require the
  // anchor to be attachable in THIS family: an active member, or a person already visible in the
  // family's kinship projection (a mention/bridge node). This runs on the pooled `db` (a pre-check),
  // before the write transaction opens.
  const anchor = input.anchorPersonId ?? me;
  if (anchor !== me) {
    if (!(await isAttachableInFamily(db, ctx, input.familyId, anchor))) {
      return { allowed: false, reason: "anchor person is not in this family" };
    }
  }

  // Co-parent (relation=child only): validate up-front like the anchor, so a supplied-but-invalid
  // co-parent is rejected with a clear reason rather than silently dropped (which would misleadingly
  // create a single-parent child when the user asked for two parents).
  let coParentPersonId: string | undefined;
  if (input.relation === "child" && input.coParentPersonId !== undefined) {
    const candidate = input.coParentPersonId;
    if (candidate !== anchor) {
      if (!(await isAttachableInFamily(db, ctx, input.familyId, candidate))) {
        return { allowed: false, reason: "co-parent person is not in this family" };
      }
      coParentPersonId = candidate;
    }
    // candidate === anchor: same person as the primary parent, so no second edge is added.
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
      // Only persisted when the relative is deceased (insertMentionPerson NULLs them otherwise).
      deathDate: input.deathDate ?? null,
      deathYear: input.deathYear ?? null,
      sex: input.sex ?? "unknown",
    });

    const edgeIds: string[] = [];
    let bridgePersonId: string | undefined;

    // Every relation attaches to `anchor` (defaults to `me`); `me` remains the actor of every edge.
    switch (input.relation) {
      case "parent": {
        edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, anchor, nature));
        break;
      }
      case "child": {
        edgeIds.push(await insertParentOf(tx, familyId, me, anchor, createdPersonId, nature));
        if (coParentPersonId !== undefined) {
          edgeIds.push(await insertParentOf(tx, familyId, me, coParentPersonId, createdPersonId, nature));
        }
        break;
      }
      case "partner": {
        edgeIds.push(await insertPartneredWith(tx, familyId, me, anchor, createdPersonId));
        break;
      }
      case "grandparent": {
        const parents = await currentParentIdsOf(tx, familyId, anchor);
        if (parents.length > 0) {
          // Attach the grandparent above each existing parent (R is parent of each P).
          for (const p of parents) {
            edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, p, nature));
          }
        } else {
          // No parent yet: mint one anonymous bridge parent B, then B->anchor and R->B.
          bridgePersonId = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living" });
          edgeIds.push(await insertParentOf(tx, familyId, me, bridgePersonId, anchor, nature));
          edgeIds.push(await insertParentOf(tx, familyId, me, createdPersonId, bridgePersonId, nature));
        }
        break;
      }
      case "sibling": {
        const parents = await currentParentIdsOf(tx, familyId, anchor);
        if (parents.length > 0) {
          // Share each existing parent (P is parent of R too).
          for (const p of parents) {
            edgeIds.push(await insertParentOf(tx, familyId, me, p, createdPersonId, nature));
          }
        } else {
          // No parent yet: mint one anonymous bridge parent B, parent of both anchor and R.
          bridgePersonId = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living" });
          edgeIds.push(await insertParentOf(tx, familyId, me, bridgePersonId, anchor, nature));
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

// ---------------------------------------------------------------------------
// Subject-hide veto (issue #34)
// ---------------------------------------------------------------------------

/**
 * Append a subject-hide transition (`hidden` true/false) on an existing edge (#34). Gate: the actor
 * MUST be a real `self` account (ctx.kind === "account") AND be an ENDPOINT of the edge AND that
 * endpoint Person must hold an account (`persons.accountId` not null) — a `mention` has no account so
 * the control is ABSENT for it. A non-endpoint cannot hide on someone else's behalf. The hide
 * overrides even a steward affirmation (enforced by the read overlay). Append-only; latest per (edge,
 * subject) wins.
 */
async function appendSubjectHide(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
  hidden: boolean,
): Promise<KinshipEdgeActionResult> {
  if (ctx.kind !== "account") {
    return { allowed: false, reason: "not signed in" };
  }
  const me = ctx.personId;

  const existing = await latestEdgeRow(db, ref);
  if (existing === null) {
    return { allowed: false, reason: "edge does not exist in this family" };
  }
  const { personAId, personBId } = existing;

  // The actor must be an endpoint of the (normalized) edge — the subject the edge is ABOUT.
  if (me !== personAId && me !== personBId) {
    return { allowed: false, reason: "only a subject of this edge may hide it" };
  }

  // ...and must be a real self account (a mention endpoint has no account → the control is absent).
  const [meRow] = await db
    .select({ accountId: persons.accountId })
    .from(persons)
    .where(eq(persons.id, me))
    .limit(1);
  if (meRow === undefined || meRow.accountId === null) {
    return { allowed: false, reason: "only a real account may hide an edge about them" };
  }

  const [row] = await db
    .insert(kinshipSubjectHides)
    .values({
      familyId: ref.familyId,
      edgeType: ref.edgeType,
      personAId,
      personBId,
      subjectPersonId: me,
      hidden,
      actorPersonId: me,
    })
    .returning({ id: kinshipSubjectHides.id });
  return { allowed: true, edgeId: row!.id };
}

/** Subject hides an edge they're an endpoint of (#34): suppresses it family-wide, overriding even a
 *  steward affirm. See `appendSubjectHide` for the full gate. */
export async function hideEdge(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
): Promise<KinshipEdgeActionResult> {
  return appendSubjectHide(db, ctx, ref, true);
}

/** Subject un-hides an edge they previously hid (#34): a later `hidden=false` row restores it. */
export async function unhideEdge(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
): Promise<KinshipEdgeActionResult> {
  return appendSubjectHide(db, ctx, ref, false);
}

// ===========================================================================
// Identity reconciliation (ADR-0016) — reconcileMentionIntoAccount.
//
// When someone named as kin (a `mention` Person, carrying the tree edges) LATER signs up (a `self`
// account Person, carrying login + content), the family has TWO rows for one human. Reconciliation
// MERGES the mention INTO the account. Because `kinship_assertions` is APPEND-ONLY (a DB trigger
// blocks UPDATE/DELETE), the merge is done ENTIRELY by APPENDING rows — never editing:
//   • for every VISIBLE edge with the mention as an endpoint, APPEND the account's equivalent edge
//     (asserted, actor = steward), then APPEND a superseding `denied` row for the mention's edge so
//     it drops from the projection;
//   • the mention Person row is LEFT as an inert tombstone (append-only forbids deleting it; all its
//     edges are now denied, so it never renders).
// Gated to the family's Steward. The only non-ledger write is optionally carrying the mention's `sex`
// onto the account when the account's is unset — a person-row UPDATE (persons is not append-only).
// ===========================================================================

export interface ReconcileMentionInput {
  familyId: string;
  /** The loser: an `origin='mention'` Person that carries the tree edges. */
  mentionPersonId: string;
  /** The winner: the canonical Person (typically `origin='self'` with an account). */
  accountPersonId: string;
}

export interface ReconcileResult {
  allowed: boolean;
  reason?: string;
  /** New edges appended pointing at the account (the mention's edges, redirected). */
  assertedEdgeIds?: string[];
  /** Superseding `denied` rows appended for the mention's own edges. */
  deniedEdgeIds?: string[];
  /** Whether the account's `sex` was filled from the mention. */
  sexCarried?: boolean;
}

/** The reconciliation-relevant fields of a Person, or null if the row does not exist. */
async function personReconcileRow(
  db: DbOrTx,
  personId: string,
): Promise<{ origin: string; accountId: string | null; sex: PersonSex | null } | null> {
  const [row] = await db
    .select({ origin: persons.origin, accountId: persons.accountId, sex: persons.sex })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);
  return row ?? null;
}

/**
 * Reconcile a duplicate `mention` Person INTO a canonical account Person (ADR-0016). Steward-gated,
 * ledger-native (append-only): redirects every visible mention edge onto the account and denies the
 * mention's own, optionally carrying the mention's sex onto an unset account. Idempotent — a second
 * run finds no visible mention edges and appends nothing. The mention row remains an inert tombstone.
 *
 * SAFETY GUARD: refuses if the loser is not a `mention`, or carries an `accountId` (a true mention
 * never does — that would mean orphaning a real login/identity). Content-ownership (stories/media on
 * the mention) is out of scope here: a mention has no content by construction, and those tables live
 * behind the Story front door (NOT the kinship allowlist), so we do not read them from this file. See
 * report note.
 */
export async function reconcileMentionIntoAccount(
  db: Database,
  ctx: AuthContext,
  input: ReconcileMentionInput,
): Promise<ReconcileResult> {
  // 1. Auth: real account AND this family's steward.
  if (ctx.kind !== "account") {
    return { allowed: false, reason: "not signed in" };
  }
  const me = ctx.personId;
  const steward = await stewardPersonIdOf(db, input.familyId);
  if (steward === null) {
    return { allowed: false, reason: "family not found" };
  }
  if (steward !== me) {
    return { allowed: false, reason: "only the family steward may reconcile a mention" };
  }

  // 2. Validate the two persons.
  if (input.mentionPersonId === input.accountPersonId) {
    return { allowed: false, reason: "mention and account are the same person" };
  }
  const mention = await personReconcileRow(db, input.mentionPersonId);
  if (mention === null) {
    return { allowed: false, reason: "mention person does not exist" };
  }
  const accountPerson = await personReconcileRow(db, input.accountPersonId);
  if (accountPerson === null) {
    return { allowed: false, reason: "account person does not exist" };
  }
  if (mention.origin !== "mention") {
    return { allowed: false, reason: "loser is not a mention — refusing to merge a real person away" };
  }

  // 3. SAFETY GUARD: a true mention never holds an account. A content-bearing loser would orphan a
  //    real login/identity, so refuse. (Story/media content ownership is out of scope — see doc.)
  if (mention.accountId !== null) {
    return { allowed: false, reason: "mention carries an account — reconciliation would orphan identity" };
  }

  // 3b. PERSON-SCOPE GUARD (cross-family bypass). Persons are GLOBAL rows, not family-scoped, and the
  //     auth gate above only proves the caller is THIS family's steward. Without this, a steward of X
  //     (who is also a member of Y) could pass Y's mention+account ids: the edge loop finds no edges in
  //     X (harmless), but the Step-5 sex UPDATE would still fire on Y's account — an unauthorized
  //     cross-family attribute write. Require BOTH ids to be attachable in THIS family (active member,
  //     or visible in its kinship projection) BEFORE any write, so a foreign person is rejected with no
  //     partial write. A mention created in this tree is visible → attachable; the real account is an
  //     active member → attachable; another family's persons are neither → rejected.
  if (!(await isAttachableInFamily(db, ctx, input.familyId, input.mentionPersonId))) {
    return { allowed: false, reason: "mention is not part of this family" };
  }
  if (!(await isAttachableInFamily(db, ctx, input.familyId, input.accountPersonId))) {
    return { allowed: false, reason: "account person is not part of this family" };
  }

  const familyId = input.familyId;
  const mentionId = input.mentionPersonId;
  const accountId = input.accountPersonId;

  return db.transaction(async (tx) => {
    // 4. Load the family's current VISIBLE projection and redirect every edge touching the mention.
    const { edges } = await resolveKinshipProjection(tx as unknown as Database, ctx, familyId);

    // Index the visible edges by their normalized key so we can skip an edge that already exists for
    // the account (idempotency) without re-appending it.
    const visibleKeys = new Set<string>();
    for (const e of edges) {
      const { personAId, personBId } = normalizeEdgeEndpoints(e.edgeType, e.personAId, e.personBId);
      visibleKeys.add(`${e.edgeType}|${personAId}|${personBId}`);
    }
    const keyOf = (edgeType: KinshipEdgeType, a: string, b: string): string => {
      const n = normalizeEdgeEndpoints(edgeType, a, b);
      return `${edgeType}|${n.personAId}|${n.personBId}`;
    };

    const assertedEdgeIds: string[] = [];
    const deniedEdgeIds: string[] = [];

    for (const e of edges) {
      const touchesMention = e.personAId === mentionId || e.personBId === mentionId;
      if (!touchesMention) continue;

      // Compute the equivalent edge with the mention endpoint replaced by the account. For parent_of
      // we keep DIRECTION (only swap the mention endpoint); partnered_with re-normalizes below.
      const newA = e.personAId === mentionId ? accountId : e.personAId;
      const newB = e.personBId === mentionId ? accountId : e.personBId;

      // The "other" endpoint after redirect. If it IS the account, the redirected edge is a self-loop
      // (e.g. the mention was partnered with the account itself) — skip appending it, but still deny
      // the mention's own edge so the duplicate drops out.
      const otherEndpoint = e.personAId === mentionId ? e.personBId : e.personAId;
      const isSelfLoop = otherEndpoint === accountId;

      if (!isSelfLoop) {
        const equivKey = keyOf(e.edgeType, newA, newB);
        // Idempotency: only append the redirected edge if the account doesn't already carry it.
        if (!visibleKeys.has(equivKey)) {
          if (e.edgeType === "parent_of") {
            assertedEdgeIds.push(
              await insertParentOf(tx, familyId, me, newA, newB, e.nature ?? "unknown"),
            );
          } else {
            assertedEdgeIds.push(await insertPartneredWith(tx, familyId, me, newA, newB));
          }
          visibleKeys.add(equivKey);
        }
      }

      // Deny the mention's OWN visible edge (same key/direction) so it leaves the projection.
      const { personAId, personBId } = normalizeEdgeEndpoints(e.edgeType, e.personAId, e.personBId);
      deniedEdgeIds.push(
        await appendGovernanceRow(
          tx,
          { familyId, edgeType: e.edgeType, personAId, personBId },
          personAId,
          personBId,
          me,
          "denied",
          natureToCarryForward(e.edgeType, e.nature),
          "reconciled: mention merged into account",
        ),
      );
    }

    // 5. Carry sex from the mention onto the account when the account's is null/unknown and the
    //    mention's is a real value. persons is NOT append-only, so this is a normal UPDATE.
    let sexCarried = false;
    const accountSexUnset = accountPerson.sex === null || accountPerson.sex === "unknown";
    const mentionSexKnown = mention.sex === "male" || mention.sex === "female";
    if (accountSexUnset && mentionSexKnown) {
      await tx
        .update(persons)
        .set({ sex: mention.sex, updatedAt: new Date() })
        .where(eq(persons.id, accountId));
      sexCarried = true;
    }

    return { allowed: true, assertedEdgeIds, deniedEdgeIds, sexCarried };
  });
}
