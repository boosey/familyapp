/**
 * Kinship read surface (ADR-0016) — the authorized projection of a family's tree.
 *
 * This is kinship's OWN front door, PARALLEL to the Story authorization function and deliberately
 * NOT part of it: kinship is a distinct data category and never grants content access. The guarded
 * `@chronicle/db/kinship` tables are reachable ONLY from this file (enforced by the architecture
 * test's kinship allowlist), so every kinship read routes through here.
 *
 * What it resolves (all three, per ADR-0016):
 *   - first-asserter-wins: a bare `asserted` edge shows to the whole family as provisional truth,
 *     no endpoint confirmation; the original asserter is surfaced as `assertedBy` (audit).
 *   - latest-supersede: the current state/nature of a logical edge is its latest ledger row BY seq
 *     (the monotonic key; created_at can tie, seq never does). `denied` hides the edge.
 *   - subject-hide veto: a SEPARATE append-only overlay; if either endpoint's latest hide row is
 *     `hidden`, the edge is suppressed family-wide — overriding even a Steward affirmation.
 *
 * Only the two GENERATIVE primitives are stored (`parent_of`, `partnered_with`). Sibling / cousin /
 * grandparent / … are DERIVED here (`deriveKin`) by walking those edges — never stored, so a derived
 * fact can't contradict a stored one.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { kinshipAssertions, kinshipSubjectHides } from "@chronicle/db/kinship";
import { families, persons } from "@chronicle/db/schema";
import type {
  Database,
  KinshipEdgeType,
  KinshipNature,
  KinshipState,
  LifeStatus,
} from "@chronicle/db";
import { AuthorizationError } from "./errors";
import { viewerPersonId, type AuthContext } from "./authorization";
import { isActiveMember } from "./memberships";

/** A single edge in a family's current tree projection (the latest, visible, un-hidden state). */
export interface ResolvedKinshipEdge {
  edgeType: KinshipEdgeType;
  /** `parent_of`: the PARENT. `partnered_with`: the normalized lower-id endpoint. */
  personAId: string;
  /** `parent_of`: the CHILD. `partnered_with`: the normalized higher-id endpoint. */
  personBId: string;
  /** Set for `parent_of`, null for `partnered_with`. */
  nature: KinshipNature | null;
  /** The latest governance state — always one of the VISIBLE states here (never `denied`). */
  state: KinshipState;
  /** The ORIGINAL asserter (actor of the edge's earliest row) — audit / "who said so". */
  assertedBy: string;
  /** When the edge was first asserted, and when its latest transition landed. */
  assertedAt: Date;
  updatedAt: Date;
}

export interface KinshipProjection {
  familyId: string;
  edges: ResolvedKinshipEdge[];
}

/** States in which an edge is shown. `denied` is the only stored state that hides an edge (the
 *  subject-hide veto is a separate overlay, not a state). */
const VISIBLE_STATES: ReadonlySet<KinshipState> = new Set<KinshipState>([
  "asserted",
  "affirmed",
  "corrected",
]);

const SEP = "|";

/**
 * Normalize an edge's endpoints into the stored (personA, personB) convention:
 *   - `parent_of` is DIRECTED — order is meaningful (personA = parent, personB = child) — kept as-is.
 *   - `partnered_with` is UNDIRECTED — endpoints are sorted so (A,B) and (B,A) are one logical edge.
 * The write paths (issues #32/#33/#34) call this before insert; the read side keys off the same
 * convention. Exported so a single normalization rule is shared by writers and readers.
 */
export function normalizeEdgeEndpoints(
  edgeType: KinshipEdgeType,
  p1: string,
  p2: string,
): { personAId: string; personBId: string } {
  if (edgeType === "partnered_with" && p1 > p2) {
    return { personAId: p2, personBId: p1 };
  }
  return { personAId: p1, personBId: p2 };
}

function edgeKey(e: {
  edgeType: string;
  personAId: string;
  personBId: string;
}): string {
  return `${e.edgeType}${SEP}${e.personAId}${SEP}${e.personBId}`;
}

/**
 * Resolve a family's current kinship projection for a viewer. The viewer MUST hold an active
 * membership in the family (kinship visibility is family-membership-scoped, ADR-0010) — otherwise
 * `AuthorizationError`. Returns only edges whose latest state is visible and which no subject has
 * hidden.
 */
export async function resolveKinshipProjection(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<KinshipProjection> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null || !(await isActiveMember(db, viewer, familyId))) {
    throw new AuthorizationError(
      "viewer is not an active member of this family",
    );
  }

  // All assertion transitions in this family, oldest→newest BY seq. Because rows arrive in seq
  // order, the first row seen per logical edge is its original assertion and the last is its
  // current state (latest-supersede, deterministic).
  const rows = await db
    .select()
    .from(kinshipAssertions)
    .where(eq(kinshipAssertions.familyId, familyId))
    .orderBy(asc(kinshipAssertions.seq));

  const byEdge = new Map<
    string,
    { first: (typeof rows)[number]; last: (typeof rows)[number] }
  >();
  for (const r of rows) {
    const key = edgeKey(r);
    const g = byEdge.get(key);
    if (g === undefined) byEdge.set(key, { first: r, last: r });
    else g.last = r;
  }

  // Subject-hide overlay: latest hide row per (edge, subject) BY seq; if that latest is `hidden`,
  // the edge is suppressed family-wide. Either endpoint hiding is enough.
  const hideRows = await db
    .select()
    .from(kinshipSubjectHides)
    .where(eq(kinshipSubjectHides.familyId, familyId))
    .orderBy(asc(kinshipSubjectHides.seq));
  const latestHide = new Map<string, { edgeKey: string; hidden: boolean }>();
  for (const h of hideRows) {
    // A hide is the subject's veto, so the subject MUST be an endpoint of the edge. Ignore any row
    // whose subject is neither endpoint — a malformed hide can't suppress a stranger's edge. (The
    // write path enforces this too, in #34; the read side is defensive so the projection is robust.)
    if (h.subjectPersonId !== h.personAId && h.subjectPersonId !== h.personBId) continue;
    const ek = edgeKey(h);
    latestHide.set(`${ek}${SEP}${h.subjectPersonId}`, {
      edgeKey: ek,
      hidden: h.hidden,
    });
  }
  const hiddenEdgeKeys = new Set<string>();
  for (const v of latestHide.values()) {
    if (v.hidden) hiddenEdgeKeys.add(v.edgeKey);
  }

  const edges: ResolvedKinshipEdge[] = [];
  for (const [key, g] of byEdge) {
    if (!VISIBLE_STATES.has(g.last.state)) continue; // denied → not shown
    if (hiddenEdgeKeys.has(key)) continue; // subject veto
    edges.push({
      edgeType: g.last.edgeType,
      personAId: g.last.personAId,
      personBId: g.last.personBId,
      nature: g.last.nature,
      state: g.last.state,
      assertedBy: g.first.actorPersonId,
      assertedAt: g.first.createdAt,
      updatedAt: g.last.createdAt,
    });
  }
  return { familyId, edges };
}

// ---------------------------------------------------------------------------
// Derivation — sibling / grandparent / cousin / … computed from the stored
// `parent_of` + `partnered_with` edges. Never stored (ADR-0016). Labels are
// UNGENDERED (parent, not mother): the data model has no sex/gender attribute,
// so we cannot distinguish mother/father or grandmother/grandfather. Gendered
// display labels are a later concern (needs a person attribute) — issue #32.
// ---------------------------------------------------------------------------

export type KinRelation =
  | "parent"
  | "child"
  | "partner"
  | "sibling"
  | "grandparent"
  | "grandchild"
  | "aunt_uncle"
  | "niece_nephew"
  | "cousin";

export interface DerivedKin {
  personId: string;
  relation: KinRelation;
}

/** Assign the CLOSEST relation when a person is reachable more than one way (e.g. also a partner). */
const RELATION_PRECEDENCE: readonly KinRelation[] = [
  "parent",
  "child",
  "partner",
  "sibling",
  "grandparent",
  "grandchild",
  "aunt_uncle",
  "niece_nephew",
  "cousin",
];

/**
 * Derive every labeled relative of `rootPersonId` from a resolved edge set (the output of
 * `resolveKinshipProjection`, so already visibility- and hide-filtered). Pure — no DB, no auth.
 * Covers the first- and second-degree relations; `sibling` = shares ≥1 parent, `cousin` = parents
 * are siblings. When a person qualifies for several relations the most specific (by precedence) wins.
 */
export function deriveKin(
  edges: ResolvedKinshipEdge[],
  rootPersonId: string,
): DerivedKin[] {
  // Adjacency from the two primitives.
  const parentsOf = new Map<string, Set<string>>(); // child -> parents
  const childrenOf = new Map<string, Set<string>>(); // parent -> children
  const partnersOf = new Map<string, Set<string>>(); // person -> partners

  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    let s = m.get(k);
    if (s === undefined) {
      s = new Set<string>();
      m.set(k, s);
    }
    s.add(v);
  };

  for (const e of edges) {
    if (e.edgeType === "parent_of") {
      add(parentsOf, e.personBId, e.personAId);
      add(childrenOf, e.personAId, e.personBId);
    } else {
      add(partnersOf, e.personAId, e.personBId);
      add(partnersOf, e.personBId, e.personAId);
    }
  }

  const get = (m: Map<string, Set<string>>, k: string): Set<string> =>
    m.get(k) ?? new Set<string>();

  /** Siblings of x = others sharing ≥1 parent with x. */
  const siblingsOf = (x: string): Set<string> => {
    const out = new Set<string>();
    for (const p of get(parentsOf, x)) {
      for (const c of get(childrenOf, p)) {
        if (c !== x) out.add(c);
      }
    }
    return out;
  };

  // Collect candidates per relation, then pick the most specific per person.
  const candidates = new Map<string, Set<KinRelation>>();
  const mark = (personId: string, relation: KinRelation) => {
    if (personId === rootPersonId) return;
    add(candidates as Map<string, Set<string>>, personId, relation);
  };

  const parents = get(parentsOf, rootPersonId);
  const children = get(childrenOf, rootPersonId);

  for (const p of parents) mark(p, "parent");
  for (const c of children) mark(c, "child");
  for (const pt of get(partnersOf, rootPersonId)) mark(pt, "partner");
  for (const s of siblingsOf(rootPersonId)) mark(s, "sibling");

  // grandparents = parents of parents; grandchildren = children of children.
  for (const p of parents) for (const gp of get(parentsOf, p)) mark(gp, "grandparent");
  for (const c of children) for (const gc of get(childrenOf, c)) mark(gc, "grandchild");

  // aunts/uncles = siblings of parents; cousins = their children.
  for (const p of parents) {
    for (const au of siblingsOf(p)) {
      mark(au, "aunt_uncle");
      for (const cousin of get(childrenOf, au)) mark(cousin, "cousin");
    }
  }
  // nieces/nephews = children of siblings.
  for (const s of siblingsOf(rootPersonId)) {
    for (const nn of get(childrenOf, s)) mark(nn, "niece_nephew");
  }

  const result: DerivedKin[] = [];
  for (const [personId, rels] of candidates) {
    const relation = RELATION_PRECEDENCE.find((r) => rels.has(r));
    if (relation !== undefined) result.push({ personId, relation });
  }
  return result;
}

// ---------------------------------------------------------------------------
// listMyKin (issue #32) — the read composition the kin list UI renders: resolve
// the family's projection for the viewer, derive the viewer's labeled relatives,
// then hydrate each relative's display fields from `persons`.
// ---------------------------------------------------------------------------

/** One entry in the viewer's kin list — a labeled relative with just enough to render a row. */
export interface KinListEntry {
  personId: string;
  /** The derived relation (from `deriveKin`). */
  relation: KinRelation;
  /** Null when the person is an unidentified placeholder (an anonymous bridge node). */
  displayName: string | null;
  identified: boolean;
  lifeStatus: LifeStatus;
}

/**
 * List the viewer's kin in a family: `resolveKinshipProjection` (enforces `ctx.kind==="account"`
 * and active membership) → `deriveKin(edges, viewer)` → hydrate each relative's
 * `displayName/identified/lifeStatus` from `persons`. Sorted stably by relation closeness (the
 * derivation precedence) then name, so the list is deterministic. An unidentified placeholder
 * (bridge node) has `displayName === null` and `identified === false` — the caller renders it from
 * the relation ("Unknown parent") rather than a name.
 */
export async function listMyKin(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<KinListEntry[]> {
  const { edges } = await resolveKinshipProjection(db, ctx, familyId);
  // resolveKinshipProjection already rejected anonymous viewers; viewerPersonId is non-null here.
  const viewer = viewerPersonId(ctx)!;
  const kin = deriveKin(edges, viewer);
  if (kin.length === 0) return [];

  const ids = kin.map((k) => k.personId);
  const rows = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      identified: persons.identified,
      lifeStatus: persons.lifeStatus,
    })
    .from(persons)
    .where(inArray(persons.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const entries: KinListEntry[] = [];
  for (const k of kin) {
    const p = byId.get(k.personId);
    if (p === undefined) continue; // referential integrity guarantees this, but stay defensive
    entries.push({
      personId: k.personId,
      relation: k.relation,
      displayName: p.displayName,
      identified: p.identified,
      lifeStatus: p.lifeStatus,
    });
  }

  const rank = (r: KinRelation): number => {
    const i = RELATION_PRECEDENCE.indexOf(r);
    return i === -1 ? RELATION_PRECEDENCE.length : i;
  };
  entries.sort(
    (a, b) =>
      rank(a.relation) - rank(b.relation) ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
  );
  return entries;
}

// ---------------------------------------------------------------------------
// listGovernableKinEdges (issues #33/#34) — the read composition the governance
// UI renders: the family's CURRENT visible edges (already latest-supersede- and
// hide-filtered) with each endpoint's display name, plus two viewer capability
// flags per edge: `viewerIsSteward` (may affirm/deny/correct) and
// `viewerCanHide` (the viewer is a self-account endpoint of this edge).
//
// NOTE these flags are UI affordances only — the write path re-checks every gate
// server-side (kinship-write.ts). This composition never widens authority; it
// just tells the page which controls to show.
// ---------------------------------------------------------------------------

/** One visible edge, ready for the governance UI. Endpoints carry display metadata; `endpoint*` names
 *  are null for an unidentified bridge placeholder (rendered from the relation, never a name). */
export interface GovernableKinEdge {
  edgeType: KinshipEdgeType;
  personAId: string;
  personBId: string;
  personADisplayName: string | null;
  personAIdentified: boolean;
  personBDisplayName: string | null;
  personBIdentified: boolean;
  nature: KinshipNature | null;
  state: KinshipState;
  /** True iff the viewer is THIS family's steward — may affirm/deny/correct. */
  viewerIsSteward: boolean;
  /** True iff the viewer is a self-account endpoint of THIS edge — may hide/unhide it. */
  viewerCanHide: boolean;
}

/**
 * List a family's currently-visible kinship edges for the governance UI, annotated with the viewer's
 * per-edge capabilities. Auth flows through `resolveKinshipProjection` (active-membership required,
 * anonymous rejected). Then it hydrates endpoint names from `persons` and computes, for the viewer:
 * steward-of-this-family (a single `families` lookup) and, per edge, whether the viewer is a
 * self-account endpoint of it (so the hide control appears only where it applies). The flags are
 * advisory; the write path re-verifies them.
 */
export async function listGovernableKinEdges(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<GovernableKinEdge[]> {
  const { edges } = await resolveKinshipProjection(db, ctx, familyId);
  const viewer = viewerPersonId(ctx)!; // resolveKinshipProjection rejected anonymous viewers
  if (edges.length === 0) return [];

  const [fam] = await db
    .select({ stewardPersonId: families.stewardPersonId })
    .from(families)
    .where(eq(families.id, familyId))
    .limit(1);
  const viewerIsSteward = fam?.stewardPersonId === viewer;

  // Hydrate every endpoint's display fields + account-ness in one query.
  const ids = Array.from(new Set(edges.flatMap((e) => [e.personAId, e.personBId])));
  const rows = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
      identified: persons.identified,
      accountId: persons.accountId,
    })
    .from(persons)
    .where(inArray(persons.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const viewerHasAccount = byId.get(viewer)?.accountId != null;

  return edges.map((e) => {
    const a = byId.get(e.personAId);
    const b = byId.get(e.personBId);
    const viewerIsEndpoint = viewer === e.personAId || viewer === e.personBId;
    return {
      edgeType: e.edgeType,
      personAId: e.personAId,
      personBId: e.personBId,
      personADisplayName: a?.displayName ?? null,
      personAIdentified: a?.identified ?? false,
      personBDisplayName: b?.displayName ?? null,
      personBIdentified: b?.identified ?? false,
      nature: e.nature,
      state: e.state,
      viewerIsSteward,
      viewerCanHide: viewerIsEndpoint && viewerHasAccount,
    };
  });
}

// ---------------------------------------------------------------------------
// resolveKinshipTree — the read behind the visual tree renderer (ADR-0016 seam).
// SHARED CONTRACT (Stage-0 stub). Implemented by Track-B "B-core".
// See docs/superpowers/specs/2026-07-12-kinship-tree-viz-design.md §5.
// ---------------------------------------------------------------------------

/**
 * How much of the graph a single `resolveKinshipTree` read materializes, measured in generations
 * from the root. This is the scalability seam: the read fetches a BOUNDED neighborhood, never the
 * whole family, so a large/imported tree costs the same first read as a small one.
 */
export interface TreeWindow {
  generationsUp: number;
  generationsDown: number;
}

/** Default window: two generations each way (grandparents → grandchildren). */
export const DEFAULT_TREE_WINDOW: TreeWindow = {
  generationsUp: 2,
  generationsDown: 2,
};

export interface TreeNode {
  personId: string;
  /** null ⇒ anonymous bridge node; render from `relationToRoot`. */
  displayName: string | null;
  identified: boolean;
  lifeStatus: "living" | "deceased";
  birthYear: number | null;
  deathYear: number | null;
  /** Most-specific derived relation to the root; "self" for the root; null if unrelated/bridge-only. */
  relationToRoot: KinRelation | "self" | null;
  /** True when parents/children exist in the projection but were not materialized in this window. */
  hasHiddenParents: boolean;
  hasHiddenChildren: boolean;
}

export interface KinshipTreeData {
  familyId: string;
  rootPersonId: string;
  /** Only the persons within `window` of root (plus what boundary flags describe). */
  nodes: TreeNode[];
  /** parent_of (directed) + partnered_with (normalized) among the materialized nodes + boundary. */
  edges: ResolvedKinshipEdge[];
}

/**
 * Resolve a bounded, root-anchored neighborhood of a family's kinship projection for rendering the
 * visual tree. Composes {@link resolveKinshipProjection} (family-membership gating + subject-hide
 * overlay), walks outward from `rootPersonId` only as far as `window`, hydrates the materialized
 * persons, and attaches `relationToRoot` via {@link deriveKin}. Kinship metadata only — never widens
 * the content front door.
 *
 * SHARED CONTRACT STUB — Track-B "B-core" implements this against the spec.
 */
export async function resolveKinshipTree(
  _db: Database,
  _ctx: AuthContext,
  _familyId: string,
  _rootPersonId: string,
  _window: TreeWindow = DEFAULT_TREE_WINDOW,
): Promise<KinshipTreeData> {
  throw new Error("NOT_IMPLEMENTED: resolveKinshipTree (Stage-0 contract stub)");
}
