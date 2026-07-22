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
import { and, asc, eq, inArray } from "drizzle-orm";
import { kinshipAssertions, kinshipSubjectHides } from "@chronicle/db/kinship";
import { families, invitations, memberships, persons } from "@chronicle/db/schema";
import type {
  Database,
  KinshipEdgeType,
  KinshipNature,
  KinshipState,
  LifeStatus,
  MembershipRole,
  PersonSex,
} from "@chronicle/db";
import { AuthorizationError } from "./errors";
import { viewerPersonId, type AuthContext } from "./authorization";
import { isActiveMember } from "./memberships";
import { deriveKin, RELATION_PRECEDENCE } from "./kinship-derive";
import type {
  DerivedKin,
  KinRelation,
  ResolvedKinshipEdge,
} from "./kinship-derive";

// Re-export the pure derivation surface so the barrel + server consumers are unchanged.
export { deriveKin };
export type { DerivedKin, KinRelation, ResolvedKinshipEdge };

/** A single edge in a family's current tree projection (the latest, visible, un-hidden state). */
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
 * Can the VIEWER see `personId` at all — the person-visibility gate for any per-person surface
 * (e.g. `/hub/person/[id]`). This is the SAME reachability the tree renderer enforces: a person is
 * visible iff the viewer would encounter them in a family they can browse. Concretely:
 *   - Self is always visible (`viewer === personId`).
 *   - Otherwise the viewer and the person must share at least ONE family in which BOTH currently hold
 *     an ACTIVE membership (mirrors `resolveKinshipTree`'s per-family active-membership auth and the
 *     album's `activeFamilyIds` intersection). No shared active family ⇒ NOT visible.
 *   - An anonymous viewer sees no one (they hold no memberships).
 *
 * It answers ONLY "is this person on a surface the viewer may open" — it grants NO content. It exists
 * so a per-person page can gate existence + identity (name) disclosure with a viewer-scoped check,
 * turning a hidden person into `notFound()` (indistinguishable from a nonexistent id — no oracle).
 * Lives here (kinship's front door) because person reachability is a kinship concern; it touches only
 * the open `memberships` table, never content.
 */
export async function canViewerSeePerson(
  db: Database,
  ctx: AuthContext,
  personId: string,
): Promise<boolean> {
  const viewer = viewerPersonId(ctx);
  if (viewer === null) return false;
  if (viewer === personId) return true;
  // Do the viewer and the target share a family in which BOTH hold an ACTIVE membership? Fetch the
  // viewer's active families, then check the target for an active membership in any of them.
  const viewerFamilies = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, viewer), eq(memberships.status, "active")));
  if (viewerFamilies.length === 0) return false;
  const [shared] = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.status, "active"),
        inArray(
          memberships.familyId,
          viewerFamilies.map((r) => r.familyId),
        ),
      ),
    )
    .limit(1);
  return shared !== undefined;
}

/**
 * Invite-standing check (#333, ADR-0028 hardening): is `personId` visible to `viewerPersonId`
 * through some family they BOTH have a connection to? This is the gate a person-bound Invitation
 * create must pass — without it, any active member of the TARGET family could hand
 * `existingInviteePersonId` an arbitrary Person UUID from anywhere in the app, a cross-family PII
 * leak (a stranger's name/relationship surfaced via the invite flow).
 *
 * "Visible" mirrors the same reachability `canViewerSeePerson` and the List/Tree projections use,
 * generalized to a many-family standing check instead of a single boolean:
 *   - `personId` is an ACTIVE Member of some family where the viewer also holds active membership, OR
 *   - `personId` is an endpoint of a currently-VISIBLE kinship edge (latest-supersede + subject-hide
 *     applied, same as {@link resolveKinshipProjection}) in some family where the viewer holds active
 *     membership.
 * Self is always standing (a person always has standing on themselves).
 *
 * Batched across the viewer's WHOLE family set in a small, fixed number of queries (membership
 * lookup, co-membership check, one kinship-assertions scan, one hide-overlay scan) — never a query
 * per candidate family, so an inviter who belongs to many families does not create an N+1.
 */
export async function personVisibleToViewerAcrossFamilies(
  db: Pick<Database, "select">,
  viewerPersonId: string,
  personId: string,
): Promise<boolean> {
  if (viewerPersonId === personId) return true;

  const viewerFamilyRows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(eq(memberships.personId, viewerPersonId), eq(memberships.status, "active")),
    );
  const familyIds = viewerFamilyRows.map((r) => r.familyId);
  if (familyIds.length === 0) return false;

  // Direct co-membership: `personId` is an active member of some family the viewer is also active in.
  const [coMember] = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.status, "active"),
        inArray(memberships.familyId, familyIds),
      ),
    )
    .limit(1);
  if (coMember) return true;

  // Otherwise: is `personId` an endpoint of a VISIBLE kinship edge in ANY of those families? One
  // query across every candidate family for the assertions, one for the hide overlay — mirrors
  // resolveKinshipProjection's latest-supersede + subject-hide logic, generalized over families.
  const rows = await db
    .select()
    .from(kinshipAssertions)
    .where(inArray(kinshipAssertions.familyId, familyIds))
    .orderBy(asc(kinshipAssertions.seq));
  if (rows.length === 0) return false;

  // Latest row per (family, edge) — rows arrive oldest→newest by seq, so the last write per key wins.
  const latestByFamilyEdge = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    latestByFamilyEdge.set(`${r.familyId}${SEP}${edgeKey(r)}`, r);
  }

  const hideRows = await db
    .select()
    .from(kinshipSubjectHides)
    .where(inArray(kinshipSubjectHides.familyId, familyIds))
    .orderBy(asc(kinshipSubjectHides.seq));
  const latestHideByFamilyEdgeSubject = new Map<string, boolean>();
  for (const h of hideRows) {
    // A hide is the subject's veto — ignore a malformed row whose subject is neither endpoint.
    if (h.subjectPersonId !== h.personAId && h.subjectPersonId !== h.personBId) continue;
    latestHideByFamilyEdgeSubject.set(
      `${h.familyId}${SEP}${edgeKey(h)}${SEP}${h.subjectPersonId}`,
      h.hidden,
    );
  }
  const hiddenFamilyEdgeKeys = new Set<string>();
  for (const [key, hidden] of latestHideByFamilyEdgeSubject) {
    if (hidden) hiddenFamilyEdgeKeys.add(key.slice(0, key.lastIndexOf(SEP)));
  }

  for (const [familyEdgeKey, edge] of latestByFamilyEdge) {
    if (!VISIBLE_STATES.has(edge.state)) continue; // denied → not shown
    if (hiddenFamilyEdgeKeys.has(familyEdgeKey)) continue; // subject veto
    if (edge.personAId === personId || edge.personBId === personId) return true;
  }
  return false;
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

// `KinRelation`, `DerivedKin`, `ResolvedKinshipEdge`, and `deriveKin` live in the dependency-free
// `./kinship-derive` module (client-safe) and are re-exported below so server consumers and the
// `@chronicle/core` barrel keep importing them from here unchanged.

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
// listUnplacedMembers (#161, ADR-0023) — active members who are an endpoint of
// NO visible kinship edge (and are not curated "non-family"), so the Family tab
// can surface them instead of leaving them invisible in the graph-only view.
// ---------------------------------------------------------------------------

/** An active member of the family who is not yet placed in the kinship tree. */
export interface UnplacedMember {
  personId: string;
  /** Null only for the (unreachable-here) placeholder mention case — members are named persons. */
  displayName: string | null;
  role: MembershipRole;
}

/**
 * List a family's active members who are NOT placed in its kinship tree (#161, ADR-0023). "Placed"
 * means being an endpoint of at least one VISIBLE kinship edge (reusing `resolveKinshipProjection`,
 * so denied/hidden edges do NOT count as placed). A member is unplaced iff they touch no visible
 * edge AND their membership's `non_family` flag is false (a member curated "non-family" is
 * intentionally excluded — they belong to the family but are not meant to appear as a tree node).
 * Auth flows through `resolveKinshipProjection` (viewer must be an active member; anonymous
 * rejected). Sorted by displayName then id for a deterministic list.
 */
export async function listUnplacedMembers(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<UnplacedMember[]> {
  // Auth + the visible edge set in one call (throws for a non-member / anonymous viewer).
  const { edges } = await resolveKinshipProjection(db, ctx, familyId);

  // The set of persons touched by SOME visible edge — i.e. "placed" in the tree.
  const placed = new Set<string>();
  for (const e of edges) {
    placed.add(e.personAId);
    placed.add(e.personBId);
  }

  // Active members of this family that are NOT curated non-family, with name + role.
  const rows = await db
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(
      and(
        eq(memberships.familyId, familyId),
        eq(memberships.status, "active"),
        eq(memberships.nonFamily, false),
      ),
    );

  const unplaced = rows.filter((r) => !placed.has(r.personId));
  unplaced.sort(
    (a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
  );
  return unplaced;
}

// ---------------------------------------------------------------------------
// listPlacedPersons (#169, #250) — people the place-in-tree UX may offer as
// anchors. Prefer endpoints of visible kinship edges ("already placed"). When
// the family has no visible edges yet, fall back to active members: a brand-new
// single-person tree still materializes that person as a lone root
// (`resolveKinshipTree`), so they must be a valid anchor even with zero edges.
// ---------------------------------------------------------------------------

export interface PlacedPersonView {
  personId: string;
  displayName: string | null;
}

function sortPlacedPersonViews(
  rows: { id: string; displayName: string | null }[],
): PlacedPersonView[] {
  rows.sort(
    (a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? "") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return rows.map((r) => ({ personId: r.id, displayName: r.displayName }));
}

/**
 * List people who may anchor an unplaced-member placement in `familyId` (#169, #250).
 *
 * Primary set: endpoints of at least one VISIBLE kinship edge (same "placed" definition
 * `listUnplacedMembers` complements). Seed fallback (#250): when that set is empty, return
 * active non-`non_family` members — matching the tree's lone-root materialization so a
 * brand-new single-person tree still offers someone to connect to. Auth flows through
 * `resolveKinshipProjection` (active-membership required, anonymous rejected). Sorted by
 * displayName then id. Callers placing a specific member should exclude that member from
 * the picker (a self-link is rejected on the write path).
 */
export async function listPlacedPersons(
  db: Database,
  ctx: AuthContext,
  familyId: string,
): Promise<PlacedPersonView[]> {
  const { edges } = await resolveKinshipProjection(db, ctx, familyId);
  const placed = new Set<string>();
  for (const e of edges) {
    placed.add(e.personAId);
    placed.add(e.personBId);
  }

  if (placed.size === 0) {
    // #250: no visible edges yet — seed anchors from active members (the people who can still
    // appear as a self-rooted lone node on the tree). Exclude curated non-family; they are not
    // meant to be tree nodes.
    const seedRows = await db
      .select({
        id: persons.id,
        displayName: persons.displayName,
      })
      .from(memberships)
      .innerJoin(persons, eq(persons.id, memberships.personId))
      .where(
        and(
          eq(memberships.familyId, familyId),
          eq(memberships.status, "active"),
          eq(memberships.nonFamily, false),
        ),
      );
    return sortPlacedPersonViews(seedRows);
  }

  const rows = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
    })
    .from(persons)
    .where(inArray(persons.id, Array.from(placed)));

  return sortPlacedPersonViews(rows);
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
  /** The Person who ORIGINALLY asserted this edge (the earliest ledger row's actor) — audit + #256's
   *  asserter-retract gate (`viewerCanRemove`). */
  assertedBy: string;
  /** True iff the viewer may affirm/correct THIS edge: family steward AND both endpoints identified
   *  (#259 — placeholder scaffold edges are not stewardship targets). */
  viewerIsSteward: boolean;
  /** True iff the viewer is a self-account endpoint of THIS edge — may hide/unhide it (cleared when
   *  either endpoint is unidentified, #259). */
  viewerCanHide: boolean;
  /** True iff the viewer may DENY (remove) this specific edge (#256): the steward, OR the Person who
   *  originally asserted it — cleared when either endpoint is unidentified (#259). Narrower than
   *  `viewerIsSteward` for named edges — affirm/correct stay steward-only. */
  viewerCanRemove: boolean;
}

/**
 * #259/#289 — structural placeholder edges (either endpoint `identified = false`) are not governance
 * targets: Endorse / Hide / Remove / Correct must not be offered, and writes must refuse. Pure so the
 * read composition and write gates share one rule.
 */
export function bothEndpointsIdentified(edge: {
  personAIdentified: boolean;
  personBIdentified: boolean;
}): boolean {
  return edge.personAIdentified && edge.personBIdentified;
}

/**
 * List a family's currently-visible kinship edges for the governance UI, annotated with the viewer's
 * per-edge capabilities. Auth flows through `resolveKinshipProjection` (active-membership required,
 * anonymous rejected). Then it hydrates endpoint names from `persons` and computes, for the viewer:
 * steward-of-this-family (a single `families` lookup) and, per edge, whether the viewer is a
 * self-account endpoint of it (so the hide control appears only where it applies) and whether the
 * viewer is the steward or the edge's original asserter (`viewerCanRemove`, #256 — drives the Family
 * tree's Remove affordance). Capability flags are cleared when either endpoint is unidentified (#259).
 * The flags are advisory; the write path re-verifies them.
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
  const viewerIsFamilySteward = fam?.stewardPersonId === viewer;

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
    const personAIdentified = a?.identified ?? false;
    const personBIdentified = b?.identified ?? false;
    const governable = bothEndpointsIdentified({ personAIdentified, personBIdentified });
    return {
      edgeType: e.edgeType,
      personAId: e.personAId,
      personBId: e.personBId,
      personADisplayName: a?.displayName ?? null,
      personAIdentified,
      personBDisplayName: b?.displayName ?? null,
      personBIdentified,
      nature: e.nature,
      state: e.state,
      assertedBy: e.assertedBy,
      viewerIsSteward: governable && viewerIsFamilySteward,
      viewerCanHide: governable && viewerIsEndpoint && viewerHasAccount,
      viewerCanRemove: governable && (viewerIsFamilySteward || e.assertedBy === viewer),
    };
  });
}

// ---------------------------------------------------------------------------
// resolveKinshipTree — the read behind the visual tree renderer (ADR-0016 seam).
// SHARED CONTRACT (Stage-0 stub). Implemented by Track-B "B-core".
// See docs/99-pruned/superpowers/specs/2026-07-12-kinship-tree-viz-design.md §5.
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
  /** ADR-0016: card color only, never a relation label. Bridge/unidentified nodes surface "unknown". */
  sex: PersonSex;
  /** Most-specific derived relation to the root; "self" for the root; null if unrelated/bridge-only. */
  relationToRoot: KinRelation | "self" | null;
  /** True when parents/children exist in the projection but were not materialized in this window. */
  hasHiddenParents: boolean;
  hasHiddenChildren: boolean;
  /**
   * Slice D (#6) / #332 (ADR-0028): whether this person can be invited into one of the viewer's
   * Families. Kinship/person metadata (derived from `persons.accountId`/`identified`/`lifeStatus`,
   * the `invitations` ledger, and `memberships`) — NOT content, so it never widens the Story/Media
   * front door.
   *
   * ADR-0028 supersedes Slice D's Account-hides-Invite rule with **membership-gap eligibility**: an
   * Account no longer auto-hides Invite. Order matters:
   *   - `not-applicable` — bridge/unidentified, or deceased.
   *   - `pending`        — has a LIVE (`pending`, unexpired) invitation INTO THE BROWSED family
   *                        (family-scoped — a live invite into a different family does not count).
   *   - `invitable`      — the viewer has a MEMBERSHIP GAP for this person: at least one of the
   *                        viewer's own active Families where this person is NOT an active member.
   *                        Applies whether or not the person has an Account (the canonical case: an
   *                        Account-holder Member of Family A is still invitable into Family B).
   *   - `accepted`       — has an Account and NO membership gap (already an active member of every
   *                        Family the viewer belongs to). Retained for backward compatibility with
   *                        existing consumers; #335 retires this union member once they're migrated.
   *   - `not-applicable` — otherwise (no account, no gap — nothing left to invite into).
   */
  inviteStatus: "invitable" | "pending" | "accepted" | "not-applicable";
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
 * #332 (ADR-0028): the pure invite-status rule, factored out so the projection and the tests share
 * ONE source of truth. Membership-gap eligibility supersedes Slice D's Account-hides-Invite rule —
 * order matters:
 *   1. Not identified or deceased → `not-applicable` (never invitable regardless of gap/account).
 *   2. A LIVE pending invitation into the browsed family → `pending` (wins over a gap or an account —
 *      already-in-flight).
 *   3. A membership gap (the viewer has ≥1 active Family where this person is not an active member) →
 *      `invitable`, Account or not — this is the canonical Zach-on-Boudreaux → Carney case.
 *   4. An Account and no gap → `accepted` (compat path: already a member everywhere the viewer is).
 *   5. Otherwise → `not-applicable` (no account, no gap — nothing left to invite into).
 */
export function inviteStatusFor(p: {
  hasAccount: boolean;
  identified: boolean;
  lifeStatus: "living" | "deceased";
  hasLivePendingInvite: boolean;
  hasMembershipGap: boolean;
}): TreeNode["inviteStatus"] {
  if (!p.identified || p.lifeStatus === "deceased") return "not-applicable";
  if (p.hasLivePendingInvite) return "pending";
  if (p.hasMembershipGap) return "invitable";
  if (p.hasAccount) return "accepted";
  return "not-applicable";
}

/** One person's raw metadata inputs to {@link resolveInviteStatuses} — everything `inviteStatusFor`
 *  needs EXCEPT the two batched facts (`hasLivePendingInvite`/`hasMembershipGap`) that the helper
 *  itself resolves. */
export interface InviteStatusSubject {
  personId: string;
  identified: boolean;
  lifeStatus: "living" | "deceased";
  hasAccount: boolean;
}

/**
 * #334 (ADR-0028/#332 shared helper): batch-resolve `TreeNode["inviteStatus"]` for an ARBITRARY set
 * of persons — not just a `resolveKinshipTree` window. Factored out of that function so a second
 * consumer (List's `loadFamilyTabData`, which must hydrate a real invite status for people OUTSIDE
 * the tree window — #334) shares the exact same two batched queries and the exact same
 * `inviteStatusFor` rule, instead of re-deriving them and risking drift.
 *
 * Same contract `resolveKinshipTree` applies to its window:
 *   - "live pending invite" is scoped to `familyId` (the browsed/current family) — an invite into a
 *     different family never marks a person `pending` here.
 *   - "membership gap" is computed across `viewingPersonId`'s WHOLE active-family set (not just
 *     `familyId`) — the canonical case is a person the viewer sees in Family A who is invitable into
 *     Family B because the viewer belongs to B and this person doesn't.
 *
 * Batched: one query for the viewer's own active families, one for every subject's active families,
 * one for live pending invites scoped to `familyId` — never a query per subject.
 */
export async function resolveInviteStatuses(
  db: Database,
  viewingPersonId: string,
  familyId: string,
  subjects: readonly InviteStatusSubject[],
): Promise<Map<string, TreeNode["inviteStatus"]>> {
  const result = new Map<string, TreeNode["inviteStatus"]>();
  if (subjects.length === 0) return result;
  const ids = subjects.map((s) => s.personId);

  // Which subjects have a LIVE (pending, unexpired) invitation INTO THIS FAMILY. `expiresAt === null`
  // is treated as non-expiring (mirrors `acceptInvitation`'s expiry convention).
  const now = Date.now();
  const inviteRows = await db
    .select({ inviteePersonId: invitations.inviteePersonId, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(
      and(
        inArray(invitations.inviteePersonId, ids),
        eq(invitations.familyId, familyId),
        eq(invitations.status, "pending"),
      ),
    );
  const pendingInvitedIds = new Set<string>();
  for (const iv of inviteRows) {
    if (iv.expiresAt === null || iv.expiresAt.getTime() >= now) {
      pendingInvitedIds.add(iv.inviteePersonId);
    }
  }

  // Membership-gap eligibility (#332): does the VIEWER hold active membership in some family where
  // this subject does NOT? Computed across ALL of the viewer's active families.
  const viewerFamilyRows = await db
    .select({ familyId: memberships.familyId })
    .from(memberships)
    .where(and(eq(memberships.personId, viewingPersonId), eq(memberships.status, "active")));
  const viewerFamilyIds = viewerFamilyRows.map((r) => r.familyId);

  const activeFamiliesByPerson = new Map<string, Set<string>>();
  if (viewerFamilyIds.length > 0) {
    const memberRows = await db
      .select({ personId: memberships.personId, familyId: memberships.familyId })
      .from(memberships)
      .where(and(inArray(memberships.personId, ids), eq(memberships.status, "active")));
    for (const row of memberRows) {
      let s = activeFamiliesByPerson.get(row.personId);
      if (s === undefined) {
        s = new Set<string>();
        activeFamiliesByPerson.set(row.personId, s);
      }
      s.add(row.familyId);
    }
  }
  const hasMembershipGap = (personId: string): boolean => {
    const theirFamilies = activeFamiliesByPerson.get(personId);
    return viewerFamilyIds.some((fid) => !theirFamilies?.has(fid));
  };

  for (const s of subjects) {
    result.set(
      s.personId,
      inviteStatusFor({
        hasAccount: s.hasAccount,
        identified: s.identified,
        lifeStatus: s.lifeStatus,
        hasLivePendingInvite: pendingInvitedIds.has(s.personId),
        hasMembershipGap: hasMembershipGap(s.personId),
      }),
    );
  }
  return result;
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
  db: Database,
  ctx: AuthContext,
  familyId: string,
  rootPersonId: string,
  window: TreeWindow = DEFAULT_TREE_WINDOW,
): Promise<KinshipTreeData> {
  // Inherit auth (active-membership required, anonymous rejected) + the latest-supersede /
  // subject-hide overlay for free. `edges` here are already the family's VISIBLE edges only.
  //
  // HONESTY NOTE (scalability seam): `resolveKinshipProjection` currently reads ALL of the family's
  // edges server-side — but those rows are cheap and id-only. The windowing below bounds the two
  // expensive/on-the-wire parts: the HYDRATION (we hit `persons` only for in-window ids) and the
  // RETURNED PAYLOAD (nodes/edges). Pushing the generation bound down into recursive SQL so we never
  // even fetch the far edges is a documented later seam (see spec §5) — NOT built here.
  const { edges: visibleEdges } = await resolveKinshipProjection(db, ctx, familyId);

  // ROOT GUARD (authorization — do not remove). `resolveKinshipProjection` validates that the VIEWER
  // is an active member, but says nothing about `rootPersonId`. Without this check a member could pass
  // `?root=<any persons.id>` (or the fetch-on-expand action an arbitrary `centerPersonId`) and we would
  // hydrate that person's name/birth/death/lifeStatus from `persons` even though they belong to another
  // family or have no edge here — a cross-family PII leak. A root is legitimate ONLY if it is the viewer
  // themselves (their own tree, possibly edge-less) OR an endpoint of one of THIS family's visible
  // edges (any reachable relative / boundary node). Anything else yields an empty tree; the caller
  // (page) then falls back to the viewer's self-root.
  const viewer = viewerPersonId(ctx); // non-null: projection above already rejected anon/non-members
  const rootIsVisibleEndpoint = visibleEdges.some(
    (e) => e.personAId === rootPersonId || e.personBId === rootPersonId,
  );
  if (rootPersonId !== viewer && !rootIsVisibleEndpoint) {
    return { familyId, rootPersonId, nodes: [], edges: [] };
  }

  // Build undirected/directed adjacency over the VISIBLE edges only. `parent_of` is directed
  // (A=parent, B=child); `partnered_with` is same-generation and symmetric.
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
  for (const e of visibleEdges) {
    if (e.edgeType === "parent_of") {
      add(parentsOf, e.personBId, e.personAId);
      add(childrenOf, e.personAId, e.personBId);
    } else {
      add(partnersOf, e.personAId, e.personBId);
      add(partnersOf, e.personBId, e.personAId);
    }
  }
  const nb = (m: Map<string, Set<string>>, k: string): Set<string> =>
    m.get(k) ?? new Set<string>();

  // Assign each reachable person a generation offset from root (root = 0), then materialize only
  // those within [-generationsUp, +generationsDown].
  //
  // Generation is defined by `parent_of` DISTANCE — that primitive alone encodes generational depth
  // (a parent is gen-1, a child gen+1). `partnered_with` is same-generation but is a SOFT hint, never
  // authoritative: a person could be both someone's partner (a step-parent, my-generation-of-partner)
  // AND, by blood via `parent_of`, a different generation entirely (e.g. also my grandparent). Letting
  // a partner hop set a generation on equal footing with parent hops makes the result depend on BFS
  // visitation order and can mis-window such a node (cold-review finding). So we do it in two phases:
  //   (1) BFS over `parent_of` only → authoritative, order-independent generations.
  //   (2) fixpoint: a still-ungenerationed person adjacent to a generationed one via `partnered_with`
  //       inherits that generation (partners share a row). Parent-derived generations always win.
  // Pure `parent_of` DAGs (cousins sharing a grandparent) never conflict — every path to the shared
  // ancestor is a parent hop and agrees — so this is correct AND order-independent for them too.
  const up = window.generationsUp;
  const down = window.generationsDown;
  const genOf = new Map<string, number>();
  // Whether a person's current generation came from a `parent_of` path (authoritative) vs. a
  // `partner_of` hint (soft). A parent_of relaxation may overwrite a soft gen and re-enqueue; a
  // partner hint may only set an as-yet-unset person. This makes blood generations win regardless of
  // visitation order, while still letting a partner bridge into a new subgraph whose OWN parent_of
  // edges are then explored (so a step-child, reached via the partner, still gets its gen+1).
  const authoritative = new Set<string>();

  // Single relaxation loop from root (root = 0, authoritative). Anchor on root even with no edges (a
  // lone node still materializes if the person row exists; an invalid root that is no real person
  // yields zero nodes). Terminates: a person is enqueued only when its gen is newly set or upgraded
  // from soft→authoritative, and generations along a consistent parent_of DAG are bounded.
  genOf.set(rootPersonId, 0);
  authoritative.add(rootPersonId);
  const queue: string[] = [rootPersonId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const g = genOf.get(cur)!;
    // parent_of neighbors — authoritative. Set if unseen, or upgrade/correct a soft (partner-hinted)
    // gen. We never contradict an existing authoritative gen (a consistent tree won't produce one).
    const relaxParent = (other: string, og: number) => {
      if (!genOf.has(other) || (!authoritative.has(other) && genOf.get(other) !== og)) {
        genOf.set(other, og);
        authoritative.add(other);
        queue.push(other);
      } else if (!authoritative.has(other)) {
        // Same gen a hint already guessed — just promote it to authoritative (no re-enqueue needed).
        authoritative.add(other);
      }
    };
    for (const p of nb(parentsOf, cur)) relaxParent(p, g - 1);
    for (const c of nb(childrenOf, cur)) relaxParent(c, g + 1);
    // partner neighbors — soft, same generation. Only seeds an as-yet-unplaced person; once placed it
    // is enqueued so its own parent_of edges (e.g. a step-child) get explored.
    for (const pt of nb(partnersOf, cur)) {
      if (!genOf.has(pt)) {
        genOf.set(pt, g); // soft (not added to `authoritative`)
        queue.push(pt);
      }
    }
  }

  // MATERIALIZE the persons whose generation is within the window. A person reachable only through a
  // beyond-window ancestor/descendant never got a generation at all (phase-1 BFS never reached it),
  // so it is correctly excluded; the boundary pass below still SEES it via a single edge hop.
  const inWindow = new Set<string>();
  for (const [person, g] of genOf) {
    if (g >= -up && g <= down) inWindow.add(person);
  }

  // Boundary flags: a materialized node has hidden parents/children iff it has a VISIBLE parent/child
  // edge whose other endpoint was NOT materialized. Those boundary edges are also returned so the
  // client can justify the caret without our hydrating the beyond-window person.
  const boundaryEdgeKeys = new Set<string>();
  const hasHiddenParents = new Map<string, boolean>();
  const hasHiddenChildren = new Map<string, boolean>();
  for (const id of inWindow) {
    for (const p of nb(parentsOf, id)) {
      if (!inWindow.has(p)) {
        hasHiddenParents.set(id, true);
        boundaryEdgeKeys.add(edgeKey({ edgeType: "parent_of", personAId: p, personBId: id }));
      }
    }
    for (const c of nb(childrenOf, id)) {
      if (!inWindow.has(c)) {
        hasHiddenChildren.set(id, true);
        boundaryEdgeKeys.add(edgeKey({ edgeType: "parent_of", personAId: id, personBId: c }));
      }
    }
  }

  // Return edges: every visible edge whose BOTH endpoints are materialized, plus the boundary edges
  // (one endpoint beyond the window) that justify the hidden flags.
  const edges = visibleEdges.filter((e) => {
    const bothIn = inWindow.has(e.personAId) && inWindow.has(e.personBId);
    return bothIn || boundaryEdgeKeys.has(edgeKey(e));
  });

  // Relations are derived over the WHOLE visible edge set (not just materialized), so a relation is
  // correct even when an intermediate node sits at the boundary. Root ⇒ "self"; unrelated/bridge ⇒ null.
  const kin = deriveKin(visibleEdges, rootPersonId);
  const relationOf = new Map<string, KinRelation>(kin.map((k) => [k.personId, k.relation]));

  // Hydrate ONLY materialized persons. A materialized id with no `persons` row (e.g. an invalid root)
  // is dropped — the tree simply has no node for it.
  const ids = Array.from(inWindow);
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: persons.id,
            displayName: persons.displayName,
            identified: persons.identified,
            lifeStatus: persons.lifeStatus,
            birthYear: persons.birthYear,
            deathYear: persons.deathYear,
            sex: persons.sex,
            // Slice D (#6): account presence resolves `accepted`; `origin` is read as person metadata
            // (bridge/mention/self/invitee) — neither is content.
            accountId: persons.accountId,
          })
          .from(persons)
          .where(inArray(persons.id, ids));

  // Slice D (#6) / #332 (ADR-0028) — resolve `inviteStatus` for every in-window person via the shared
  // batch helper (factored out for #334 so List's `loadFamilyTabData` can hydrate the SAME real
  // status for people outside the tree window without duplicating these queries).
  const inviteStatusById = await resolveInviteStatuses(
    db,
    viewer!,
    familyId,
    rows.map((r) => ({
      personId: r.id,
      identified: r.identified,
      lifeStatus: r.lifeStatus,
      hasAccount: r.accountId !== null,
    })),
  );

  const nodes: TreeNode[] = rows.map((r) => ({
    personId: r.id,
    displayName: r.displayName,
    identified: r.identified,
    lifeStatus: r.lifeStatus,
    birthYear: r.birthYear,
    deathYear: r.deathYear,
    sex: r.sex ?? "unknown",
    relationToRoot: r.id === rootPersonId ? "self" : (relationOf.get(r.id) ?? null),
    hasHiddenParents: hasHiddenParents.get(r.id) ?? false,
    hasHiddenChildren: hasHiddenChildren.get(r.id) ?? false,
    inviteStatus: inviteStatusById.get(r.id) ?? "not-applicable",
  }));

  // Materialized-but-nonexistent ids (only the invalid root, realistically) don't become nodes; drop
  // their boundary edges too so the payload never references a person that has no node.
  const materializedWithRow = new Set(nodes.map((n) => n.personId));
  const prunedEdges = edges.filter(
    (e) =>
      (materializedWithRow.has(e.personAId) || !inWindow.has(e.personAId)) &&
      (materializedWithRow.has(e.personBId) || !inWindow.has(e.personBId)),
  );

  return { familyId, rootPersonId, nodes, edges: prunedEdges };
}
