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
import { persons } from "@chronicle/db/schema";
import type { Database, KinshipNature } from "@chronicle/db";
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
