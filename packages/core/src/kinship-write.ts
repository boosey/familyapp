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
import type {
  Database,
  InviteRelationship,
  KinshipEdgeType,
  KinshipNature,
  PersonSex,
} from "@chronicle/db";
import type { AuthContext } from "./authorization";
import { InvariantViolation } from "./errors";
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
  /**
   * Implicit anonymous middle node, when one was created. For a sibling add that mints a full
   * placeholder couple (ADR-0017) up to TWO placeholders are created; `bridgePersonId` holds the
   * FIRST for backward compatibility — see `bridgePersonIds` for the complete set.
   */
  bridgePersonId?: string;
  /**
   * ADR-0017: every anonymous placeholder Person minted this call. A grandparent add mints at most
   * one; a sibling add tops the anchor's parents up to a couple and may mint two (parentless anchor)
   * or one (anchor with a single recorded parent). Absent when nothing was minted (reuse path).
   */
  bridgePersonIds?: string[];
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
    /**
     * ADR-0021: the acting viewer who minted this Person — recorded as immutable `createdByPersonId`
     * provenance so they later satisfy the `creator` arm of `canEditPerson`. Every mention/bridge is
     * minted inside an authorized `addRelative` call, so a creator is always known here.
     */
    createdByPersonId: string;
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
      createdByPersonId: opts.createdByPersonId,
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
 * The CURRENT recorded partners of `personId` in this family: the OTHER endpoint of every visible
 * `partnered_with` edge touching `personId`. `partnered_with` is undirected and endpoints are
 * normalized (personAId < personBId), so `personId` may be on either side. Latest-state per logical
 * edge (keyed by the pair), excluding `denied`. Used by the sibling top-up (ADR-0017) to reuse an
 * existing partner as the second parent rather than always minting a ghost. Read directly in this
 * allowlisted file (same rationale as `currentParentIdsOf`).
 */
async function currentPartnerIdsOf(
  db: DbOrTx,
  familyId: string,
  personId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      seq: kinshipAssertions.seq,
      personAId: kinshipAssertions.personAId,
      personBId: kinshipAssertions.personBId,
      state: kinshipAssertions.state,
    })
    .from(kinshipAssertions)
    .where(
      and(
        eq(kinshipAssertions.familyId, familyId),
        eq(kinshipAssertions.edgeType, "partnered_with"),
      ),
    );
  // Keep only edges touching `personId`; resolve latest state per OTHER endpoint (by seq).
  const latest = new Map<string, { seq: number; state: string }>();
  for (const r of rows) {
    let other: string | undefined;
    if (r.personAId === personId) other = r.personBId;
    else if (r.personBId === personId) other = r.personAId;
    if (other === undefined) continue;
    const cur = latest.get(other);
    if (cur === undefined || r.seq > cur.seq) latest.set(other, { seq: r.seq, state: r.state });
  }
  const out: string[] = [];
  for (const [other, v] of latest) {
    if (v.state !== "denied") out.push(other);
  }
  return out;
}

/**
 * Write the primitive edge(s) that express `relation` between `anchor` and `targetPersonId`, inside
 * an open transaction, first-asserter-wins. This is the SHARED edge-writing core of both
 * `addRelative` (where `targetPersonId` is a freshly-minted mention) and `linkExistingMember` (where
 * it is an EXISTING active member) — it never mints the target itself, only the ADR-0017
 * bridges/placeholders a relation needs. `me` is the actor of every edge. Returns the ids of the
 * appended edges and every placeholder minted. Mirrors ADR-0016/ADR-0017 exactly (see `addRelative`).
 */
async function writeRelationEdges(
  tx: DbOrTx,
  opts: {
    familyId: string;
    me: string;
    anchor: string;
    targetPersonId: string;
    relation: AddRelativeRelation;
    nature: KinshipNature;
    coParentPersonId?: string;
  },
): Promise<{ edgeIds: string[]; bridgePersonIds: string[] }> {
  const { familyId, me, anchor, targetPersonId, relation, nature, coParentPersonId } = opts;
  const edgeIds: string[] = [];
  const bridgePersonIds: string[] = [];

  // Every relation attaches to `anchor`; `me` remains the actor of every edge.
  switch (relation) {
    case "parent": {
      edgeIds.push(await insertParentOf(tx, familyId, me, targetPersonId, anchor, nature));
      break;
    }
    case "child": {
      edgeIds.push(await insertParentOf(tx, familyId, me, anchor, targetPersonId, nature));
      if (coParentPersonId !== undefined) {
        edgeIds.push(await insertParentOf(tx, familyId, me, coParentPersonId, targetPersonId, nature));
      }
      break;
    }
    case "partner": {
      edgeIds.push(await insertPartneredWith(tx, familyId, me, anchor, targetPersonId));
      break;
    }
    case "grandparent": {
      const parents = await currentParentIdsOf(tx, familyId, anchor);
      if (parents.length > 0) {
        // Attach the grandparent above each existing parent (R is parent of each P).
        for (const p of parents) {
          edgeIds.push(await insertParentOf(tx, familyId, me, targetPersonId, p, nature));
        }
      } else {
        // No parent yet: mint one anonymous bridge parent B, then B->anchor and R->B.
        const bridge = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living", createdByPersonId: me });
        bridgePersonIds.push(bridge);
        edgeIds.push(await insertParentOf(tx, familyId, me, bridge, anchor, nature));
        edgeIds.push(await insertParentOf(tx, familyId, me, targetPersonId, bridge, nature));
      }
      break;
    }
    case "sibling": {
      // ADR-0017: a v1 sibling shares BOTH parents (a single shared parent is a *half*-sibling,
      // deferred). So we TOP the anchor's parents up to a couple and share BOTH with the new
      // sibling. Every parent_of edge written HERE is an INFERRED sibling-scaffold link (to a ghost,
      // or a top-up completing the couple), whose nature we do not know — so per ADR-0017 all carry
      // `nature = "unknown"`, NOT the caller's nature. All writes are in this tx.
      const SIBLING_NATURE: KinshipNature = "unknown";
      const parents = await currentParentIdsOf(tx, familyId, anchor);

      // Bring the anchor's parent set to exactly two, then share BOTH with the target.
      const couple = [...parents];
      if (couple.length === 0) {
        // 0 recorded parents → mint TWO placeholders, partner them, both parent_of anchor.
        const b1 = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living", createdByPersonId: me });
        const b2 = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living", createdByPersonId: me });
        bridgePersonIds.push(b1, b2);
        edgeIds.push(await insertPartneredWith(tx, familyId, me, b1, b2));
        edgeIds.push(await insertParentOf(tx, familyId, me, b1, anchor, SIBLING_NATURE));
        edgeIds.push(await insertParentOf(tx, familyId, me, b2, anchor, SIBLING_NATURE));
        couple.push(b1, b2);
      } else if (couple.length === 1) {
        // 1 recorded parent P → complete the couple to {P, R}. If P ALREADY has a recorded partner R
        // in this family, REUSE R (v1 is single-partner — never mint a second partnership for P);
        // otherwise mint a ghost Q to be P's partner.
        const p = couple[0]!;
        const partners = await currentPartnerIdsOf(tx, familyId, p);
        const r = partners[0];
        if (r !== undefined) {
          // Reuse P's real partner R as the second parent. R may not yet be recorded as anchor's
          // parent, so assert R -> anchor to complete the pair (idempotent). Mint NO ghost.
          edgeIds.push(await insertParentOf(tx, familyId, me, r, anchor, SIBLING_NATURE));
          couple.push(r);
        } else {
          // P has no partner → mint ghost Q, partner(P,Q), Q is a new parent_of anchor.
          const q = await insertMentionPerson(tx, { displayName: null, lifeStatus: "living", createdByPersonId: me });
          bridgePersonIds.push(q);
          edgeIds.push(await insertPartneredWith(tx, familyId, me, p, q));
          edgeIds.push(await insertParentOf(tx, familyId, me, q, anchor, SIBLING_NATURE));
          couple.push(q);
        }
      }
      // couple.length === 2 → reuse it as-is; mint nothing.
      // couple.length >= 3 → first-asserter-wins can leave 3+ recorded parents; we DON'T reduce them.
      //   A sibling shares ALL of the anchor's existing parents (loop below), minting nothing.

      // Share EACH parent of the (topped-up or over-full) set with the target sibling.
      for (const p of couple) {
        edgeIds.push(await insertParentOf(tx, familyId, me, p, targetPersonId, SIBLING_NATURE));
      }
      break;
    }
  }

  return { edgeIds, bridgePersonIds };
}

/**
 * Add a relative of the signed-in Person to a family, first-asserter-wins. Re-resolves auth and
 * active membership server-side (never trusts the client). Creates the relative Person as a
 * `mention` (identified iff a real name is given) and appends the primitive edge(s) that express the
 * chosen relation. Grandparent mints ONE anonymous bridge parent when the anchor has none. Sibling
 * (ADR-0017) tops the anchor's parents up to a COUPLE and shares BOTH with the new sibling — minting
 * two placeholders for a parentless anchor, one for a single-parent anchor, none when a full couple
 * already exists — so a v1 sibling is always a FULL sibling, never a half. Returns the created ids
 * (`bridgePersonIds` lists every placeholder minted). See ADR-0016, ADR-0017 and the plan's section A.
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
      createdByPersonId: me,
    });

    // Write the relation's edges (shared with `linkExistingMember`). The target is the freshly-minted
    // mention; bridges/placeholders are minted inside as ADR-0017 requires.
    const { edgeIds, bridgePersonIds } = await writeRelationEdges(tx, {
      familyId,
      me,
      anchor,
      targetPersonId: createdPersonId,
      relation: input.relation,
      nature,
      coParentPersonId,
    });

    const result: AddRelativeResult = { allowed: true, createdPersonId, edgeIds };
    if (bridgePersonIds.length > 0) {
      result.bridgePersonId = bridgePersonIds[0];
      result.bridgePersonIds = bridgePersonIds;
    }
    return result;
  });
}

// ===========================================================================
// Accept-time auto-placement from a structured invite relationship (#164, ADR-0023).
//
// When an invitation carried a STRUCTURED relationship (the fixed invite vocabulary) and is
// accepted, the new member should appear in the family's tree the instant they join — the exact
// fact needed to place them was collected at invite time (the production incident that motivated
// this: an invite that said "Son" was discarded on accept, leaving the member invisible). Only the
// six DIRECT primitives auto-place; `other` records "no auto-edge" and the member is left unplaced
// for #161 — a sibling/grandparent/in-law needs a bridge node (ADR-0017) and is NEVER guessed here.
//
// The auto-written edge is NOT privileged: it is a normal `asserted` edge, actor = the inviter, so
// it flows through the SAME governance overlay as any manual assertion — first-asserter-wins, the
// subject hide-veto (#34), and steward deny/correct (#33). Lives in this allowlisted kinship file so
// `acceptInvitation` (invitations.ts) drives it WITHOUT importing the guarded kinship tables itself.
// ===========================================================================

/** A tx/db handle that can read, insert edges, and update the invitee's `sex`. */
type PlacementTx = DbOrTx & Pick<Database, "update">;

/**
 * The invite-picker vocabulary → (edge to write, invitee sex) placement table (#164). The value
 * names the INVITEE's role relative to the INVITER (the actor): `son` ⇒ the invitee is the inviter's
 * son ⇒ the inviter is a parent of the invitee; `mother` ⇒ the invitee is the inviter's mother ⇒ the
 * invitee is a parent of the inviter. `other` is absent — it writes no edge and touches no sex.
 */
const INVITE_PLACEMENT: Record<
  Exclude<InviteRelationship, "other">,
  { edge: "partner" | "inviteeIsParent" | "inviterIsParent"; sex: PersonSex }
> = {
  wife: { edge: "partner", sex: "female" },
  husband: { edge: "partner", sex: "male" },
  mother: { edge: "inviteeIsParent", sex: "female" },
  father: { edge: "inviteeIsParent", sex: "male" },
  son: { edge: "inviterIsParent", sex: "male" },
  daughter: { edge: "inviterIsParent", sex: "female" },
};

export interface PlaceInvitedMemberResult {
  /** The appended kinship edge id, or null when the relationship was `other` (no auto-edge). */
  edgeId: string | null;
  /** The invitee `sex` written, or null when none was set (no gendered pick, or already set). */
  sexSet: PersonSex | null;
}

/**
 * Auto-place a just-accepted member from the invite's structured relationship (#164). MUST run
 * inside `acceptInvitation`'s transaction so the membership, merge, and edge commit atomically.
 * `inviterPersonId` is the actor (and the anchor the edge attaches to); `inviteePersonId` is the
 * REAL accepting Person (the provisional has already been merged away by the caller). Writes exactly
 * ONE primitive edge for a direct relationship and matches the invitee's `sex` to the gendered pick;
 * `other` (and any nullish relationship — handled by the caller) writes nothing.
 *
 * The `sex` write is CONSERVATIVE — only when the invitee's sex is currently unset (`null`/`unknown`)
 * — so accepting a second-family invite can never clobber a sex the member set themselves. The
 * common path (a freshly JIT-provisioned account, sex `unknown`) still gets labelled with no extra
 * data entry (user story #6). Mirrors `reconcileMentionIntoAccount`'s carry-when-unset rule.
 */
export async function placeInvitedMemberOnAccept(
  tx: PlacementTx,
  input: {
    familyId: string;
    inviterPersonId: string;
    inviteePersonId: string;
    relationship: Exclude<InviteRelationship, "other">;
  },
): Promise<PlaceInvitedMemberResult> {
  const { familyId, inviterPersonId: me, inviteePersonId } = input;
  // Self-accept guard (#173): when inviter and invitee resolve to the same Person (e.g. a member
  // accepts their own invite link), every placement would write a self-edge and trip
  // `kinship_assertions_no_self_ck` — rolling back the ENTIRE accept transaction, membership insert
  // included, so the invite could never be accepted. No-op instead: no edge, no sex write.
  if (me === inviteePersonId) {
    return { edgeId: null, sexSet: null };
  }
  // `INVITE_PLACEMENT` is total over the six direct values; the lookup is `T | undefined` only under
  // `noUncheckedIndexedAccess`, so the guard is a type-narrowing formality (unreachable at runtime).
  const plan = INVITE_PLACEMENT[input.relationship];
  if (plan === undefined) {
    throw new InvariantViolation(`no placement for invite relationship '${input.relationship}'`);
  }

  let edgeId: string;
  switch (plan.edge) {
    case "partner":
      edgeId = await insertPartneredWith(tx, familyId, me, me, inviteePersonId);
      break;
    case "inviteeIsParent":
      // The invitee is a parent of the inviter (mother/father).
      edgeId = await insertParentOf(tx, familyId, me, inviteePersonId, me, "unknown");
      break;
    case "inviterIsParent":
      // The inviter is a parent of the invitee (son/daughter).
      edgeId = await insertParentOf(tx, familyId, me, me, inviteePersonId, "unknown");
      break;
  }

  // Match the invitee's sex to the gendered pick — but only fill an unset value (see doc above).
  let sexSet: PersonSex | null = null;
  const [invitee] = await tx
    .select({ sex: persons.sex })
    .from(persons)
    .where(eq(persons.id, inviteePersonId))
    .limit(1);
  const sexUnset = invitee === undefined || invitee.sex === null || invitee.sex === "unknown";
  if (sexUnset) {
    await tx
      .update(persons)
      .set({ sex: plan.sex, updatedAt: new Date() })
      .where(eq(persons.id, inviteePersonId));
    sexSet = plan.sex;
  }

  return { edgeId, sexSet };
}

// ===========================================================================
// linkExistingMember (#161, ADR-0023) — place an EXISTING active member into the
// kinship tree. Same edge topology as `addRelative`, but attaches the member the
// caller names instead of minting a fresh mention. This is the "place in tree"
// cure for an unplaced member (a member with no kinship edge is invisible in the
// graph-only Family tab). Bridges/placeholders (ADR-0017) are still minted — they
// are not duplicates of the member.
// ===========================================================================

export interface LinkExistingMemberInput {
  familyId: string;
  relation: AddRelativeRelation;
  /** The person the member attaches TO. Defaults to the viewer. Same attachability rule as
   *  `addRelative`: an active member OR a person visible in the family's kinship projection. */
  anchorPersonId?: string;
  /** The EXISTING active member to place — attached, never minted. */
  existingPersonId: string;
  /** For parent_of edges; default "unknown". */
  nature?: KinshipNature;
  /** ONLY for relation="child": also record this person as a second parent of the child. Must be
   *  attachable in the family. Ignored for every other relation. */
  coParentPersonId?: string;
}

export interface LinkExistingMemberResult {
  allowed: boolean;
  reason?: string;
  /** Every anonymous placeholder minted (ADR-0017 bridges) — never a duplicate of the linked member. */
  bridgePersonIds?: string[];
  /** Ids of the appended kinshipAssertions rows. */
  edgeIds?: string[];
}

/**
 * Place an EXISTING active member (`existingPersonId`) into a family's kinship tree, first-asserter-
 * wins (#161, ADR-0023). Mirrors `addRelative`'s edge logic (via the shared `writeRelationEdges`) but
 * attaches the named member rather than minting a new Person — so it NEVER creates a duplicate of the
 * member (ADR-0017 bridges/placeholders may still be minted; those are not the member). Auth: the
 * actor must be an active member; `existingPersonId` must be an active member of THIS family; the
 * anchor must be attachable (active member OR visible in the projection); and a member cannot be
 * linked to itself (`existingPersonId !== anchor`). Re-resolves everything server-side.
 */
export async function linkExistingMember(
  db: Database,
  ctx: AuthContext,
  input: LinkExistingMemberInput,
): Promise<LinkExistingMemberResult> {
  if (ctx.kind !== "account") {
    return { allowed: false, reason: "not signed in" };
  }
  const me = ctx.personId;

  if (!(await isActiveMember(db, me, input.familyId))) {
    return { allowed: false, reason: "not a member of this family" };
  }

  // The linked member must be an ACTIVE member of THIS family (never mint, never link a non-member).
  if (!(await isActiveMember(db, input.existingPersonId, input.familyId))) {
    return { allowed: false, reason: "person to link is not an active member of this family" };
  }

  // Resolve + validate the anchor (defaults to the viewer). Same attachability rule as `addRelative`.
  const anchor = input.anchorPersonId ?? me;
  if (anchor !== me) {
    if (!(await isAttachableInFamily(db, ctx, input.familyId, anchor))) {
      return { allowed: false, reason: "anchor person is not in this family" };
    }
  }

  // A member cannot be linked to itself.
  if (input.existingPersonId === anchor) {
    return { allowed: false, reason: "cannot link a member to the same person (self-link)" };
  }

  // Co-parent (relation=child only): validate up-front like `addRelative`.
  let coParentPersonId: string | undefined;
  if (input.relation === "child" && input.coParentPersonId !== undefined) {
    const candidate = input.coParentPersonId;
    // A co-parent that IS the linked child would write parent_of(child, child) — a self-loop the DB
    // CHECK `kinship_assertions_no_self_ck` rejects as a raw exception. Reject cleanly here instead.
    // (`addRelative` cannot hit this: its child is a freshly-minted person, never a caller id.)
    if (candidate === input.existingPersonId) {
      return {
        allowed: false,
        reason: "co-parent cannot be the linked child (a person cannot be their own parent)",
      };
    }
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

  return db.transaction(async (tx) => {
    const { edgeIds, bridgePersonIds } = await writeRelationEdges(tx, {
      familyId,
      me,
      anchor,
      targetPersonId: input.existingPersonId,
      relation: input.relation,
      nature,
      coParentPersonId,
    });

    const result: LinkExistingMemberResult = { allowed: true, edgeIds };
    if (bridgePersonIds.length > 0) result.bridgePersonIds = bridgePersonIds;
    return result;
  });
}

// ===========================================================================
// Steward governance (issue #33) + subject-hide veto (issue #34) + asserter
// retract (issue #256).
//
// LOAD-BEARING invariant (ADR-0016, user clarification): the Steward is NOT a
// visibility gate. An asserted edge is fact IMMEDIATELY (first-asserter-wins,
// handled by `addRelative` above and the read projection). Steward `affirm` is
// an OPTIONAL endorsement; `deny`/`correct` are after-the-fact moderation. A
// subject `hide` (#34) overrides even a steward affirm. None of the functions
// below add an approval prerequisite to the read side — they only append new
// superseding ledger rows, which the projection already resolves latest-wins.
//
// #256 widens ONLY `denyEdge`: the Person who originally asserted an edge may
// also retract it themselves (append-only deny, same as the steward's). This
// is deliberately narrow — `affirmEdge`/`correctEdge` stay Steward-only; a
// non-steward asserter may undo their own mistake but not endorse or re-type
// it, and can never deny someone ELSE's edge.
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

/**
 * The ORIGINAL asserter of a logical edge: the `actorPersonId` of its EARLIEST row (min `seq`), or
 * null if the edge was never asserted in this family. Mirrors `latestEdgeRow`'s row-scan but picks
 * the FIRST row instead of the latest — the original assertion is never mutated (append-only), so its
 * actor is a stable, audit-grade fact for the lifetime of the edge (#256).
 */
async function originalAsserterPersonId(db: DbOrTx, ref: EdgeRef): Promise<string | null> {
  const { personAId, personBId } = normalizeEdgeEndpoints(ref.edgeType, ref.personAId, ref.personBId);
  const rows = await db
    .select({ seq: kinshipAssertions.seq, actorPersonId: kinshipAssertions.actorPersonId })
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
  let earliest = rows[0]!;
  for (const r of rows) if (r.seq < earliest.seq) earliest = r;
  return earliest.actorPersonId;
}

/**
 * Shared server-side gate for `denyEdge` ONLY (#256): mistakes may be fixed by the family's Steward
 * OR the Person who originally asserted the currently-visible edge — deny is the one governance
 * action a non-steward may exercise, and only over their OWN assertion. `affirmEdge`/`correctEdge`
 * remain Steward-only (`requireStewardOverExistingEdge`); widening THOSE to the asserter is out of
 * scope for #256 (endorsing or re-typing your own claim is a different trust question than retracting
 * it). Returns the normalized endpoints on success, or a `{allowed:false, reason}` failure.
 */
async function requireDenyAuthorityOverExistingEdge(
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
  const existing = await latestEdgeRow(db, ref);
  if (existing === null) {
    return { ok: false, result: { allowed: false, reason: "edge does not exist in this family" } };
  }
  if (steward !== ctx.personId) {
    const asserter = await originalAsserterPersonId(db, ref);
    if (asserter !== ctx.personId) {
      return {
        ok: false,
        result: {
          allowed: false,
          reason: "only the steward or the person who added this relationship may remove it",
        },
      };
    }
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
 * The Steward, OR the ORIGINAL ASSERTER, DENIES an existing edge (#33, widened by #256): after-the-
 * fact moderation, or the asserter retracting their own mistake. Appends one superseding `denied` row;
 * the read projection then omits the edge (VISIBLE_STATES excludes `denied`) while every historical
 * row survives (append-only). An optional `note` records the reason.
 */
export async function denyEdge(
  db: Database,
  ctx: AuthContext,
  ref: EdgeRef,
  note?: string | null,
): Promise<KinshipEdgeActionResult> {
  const gate = await requireDenyAuthorityOverExistingEdge(db, ctx, ref);
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
