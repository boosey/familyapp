/**
 * Family search — the discovery seam (ADR-0001).
 *
 * A stranger types free text ("the Espositos, bakers from Naples") and gets back a handful of
 * DISCOVERABLE families. This is the seam where a real LLM-backed semantic search slots in later;
 * the Phase-0 implementation is a deterministic keyword matcher so the surface, ranking shape, and
 * privacy posture are pinned and testable now.
 *
 * Privacy posture (load-bearing): the search reads ONLY families with `discoverable = true`, and
 * although it matches the query against member display names as a *signal*, it NEVER returns them —
 * a result exposes only family name + steward name. So discovery cannot be used to enumerate a
 * family's members. (Same minimal-exposure rule as the schema comment on `families.discoverable`.)
 */
import { and, eq } from "drizzle-orm";
import { families, memberships, persons } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import {
  DISCOVERABLE_FAMILIES_DEFAULT_LIMIT,
  FAMILY_SEARCH_DEFAULT_LIMIT,
  FAMILY_SEARCH_WEIGHT_DESCRIPTION,
  FAMILY_SEARCH_WEIGHT_MEMBER,
  FAMILY_SEARCH_WEIGHT_NAME,
  FAMILY_SEARCH_WEIGHT_STEWARD,
} from "./constants";

export interface FamilySearchQuery {
  text: string;
  /** Maximum results. Defaults to 10. */
  limit?: number;
}

export interface FamilySearchResult {
  familyId: string;
  familyName: string;
  stewardName: string;
  /** Human hint at why this matched, e.g. "name", "steward Rosa", "description", "member match". */
  matchReason: string;
}

export interface FamilySearch {
  search(query: FamilySearchQuery): Promise<FamilySearchResult[]>;
}

/** Lowercased word tokens (letters/digits), deduped. */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

/** Count of query tokens that appear in `field`'s tokens. */
function overlap(queryTokens: Set<string>, field: string | null): number {
  if (!field) return 0;
  const fieldTokens = tokenize(field);
  let n = 0;
  for (const q of queryTokens) if (fieldTokens.has(q)) n++;
  return n;
}

// Weights by signal — a name hit ranks above a steward hit, above description, above a member hit.

/**
 * Build a deterministic keyword-based family search bound to `db`. Searches discoverable families
 * only; ranks by weighted token overlap (name > steward > description > member); ties broken by
 * family name then id for stable, reproducible ordering.
 */
export function createKeywordFamilySearch(db: Database): FamilySearch {
  return {
    async search(query: FamilySearchQuery): Promise<FamilySearchResult[]> {
      const limit = query.limit ?? FAMILY_SEARCH_DEFAULT_LIMIT;
      const queryTokens = tokenize(query.text);
      if (queryTokens.size === 0 || limit <= 0) return [];

      // Discoverable families + their steward display name.
      const familyRows = await db
        .select({
          familyId: families.id,
          familyName: families.name,
          description: families.description,
          stewardName: persons.displayName,
        })
        .from(families)
        .innerJoin(persons, eq(persons.id, families.stewardPersonId))
        .where(eq(families.discoverable, true));
      if (familyRows.length === 0) return [];

      // Active member display names per discoverable family — a matching SIGNAL only; never returned.
      const memberRows = await db
        .select({
          familyId: memberships.familyId,
          displayName: persons.displayName,
        })
        .from(memberships)
        .innerJoin(persons, eq(persons.id, memberships.personId))
        .innerJoin(families, eq(families.id, memberships.familyId))
        .where(
          and(
            eq(memberships.status, "active"),
            eq(families.discoverable, true),
          ),
        );
      const memberNamesByFamily = new Map<string, string[]>();
      for (const m of memberRows) {
        const list = memberNamesByFamily.get(m.familyId) ?? [];
        // Members are named self/invitee persons; displayName is nullable only for placeholder
        // mentions (ADR-0016), which are never members. `?? ""` is a compiler guard.
        list.push(m.displayName ?? "");
        memberNamesByFamily.set(m.familyId, list);
      }

      const scored: Array<{
        result: FamilySearchResult;
        score: number;
      }> = [];

      for (const f of familyRows) {
        const nameHits = overlap(queryTokens, f.familyName);
        const stewardHits = overlap(queryTokens, f.stewardName);
        const descHits = overlap(queryTokens, f.description);
        const memberNames = memberNamesByFamily.get(f.familyId) ?? [];
        // Steward is also a member; only count member hits beyond what name/steward/desc explain.
        let memberHits = 0;
        for (const name of memberNames) memberHits += overlap(queryTokens, name);

        const score =
          nameHits * FAMILY_SEARCH_WEIGHT_NAME +
          stewardHits * FAMILY_SEARCH_WEIGHT_STEWARD +
          descHits * FAMILY_SEARCH_WEIGHT_DESCRIPTION +
          (memberHits > 0 ? FAMILY_SEARCH_WEIGHT_MEMBER : 0);
        if (score === 0) continue;

        // Reason = the highest-weight signal that fired.
        let matchReason: string;
        const stewardName = f.stewardName ?? "";
        if (nameHits > 0) matchReason = "name";
        else if (stewardHits > 0)
          matchReason = `steward ${stewardName.split(/\s+/)[0] ?? stewardName}`;
        else if (descHits > 0) matchReason = "description";
        else matchReason = "member match";

        scored.push({
          score,
          result: {
            familyId: f.familyId,
            familyName: f.familyName,
            stewardName,
            matchReason,
          },
        });
      }

      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const nameCmp = a.result.familyName.localeCompare(b.result.familyName);
        if (nameCmp !== 0) return nameCmp;
        return a.result.familyId.localeCompare(b.result.familyId);
      });

      return scored.slice(0, limit).map((s) => s.result);
    },
  };
}

/** A discoverable family reduced to the only fields discovery may surface: name + steward. */
export interface DiscoverableFamily {
  familyId: string;
  familyName: string;
  stewardName: string;
}

/**
 * List every discoverable family (name + steward only — the SAME minimal exposure as the search
 * seam; members and stories are never surfaced). Ordered by family name for a stable browse list.
 *
 * This backs the "find your family" default browse list. The find surface hands the full list to
 * the client and filters it live on name/steward — so the leak-safe contract still holds: nothing
 * beyond family name + steward name ever crosses to the browser.
 */
export async function listDiscoverableFamilies(
  db: Database,
  opts: { limit?: number } = {},
): Promise<DiscoverableFamily[]> {
  const limit = opts.limit ?? DISCOVERABLE_FAMILIES_DEFAULT_LIMIT;
  if (limit <= 0) return [];
  const rows = await db
    .select({
      familyId: families.id,
      familyName: families.name,
      stewardName: persons.displayName,
    })
    .from(families)
    .innerJoin(persons, eq(persons.id, families.stewardPersonId))
    .where(eq(families.discoverable, true))
    .orderBy(families.name)
    .limit(limit);
  // Steward is a named self-person; displayName is nullable only for placeholder mentions
  // (ADR-0016), never a steward. `?? ""` is a compiler guard.
  return rows.map((r) => ({ ...r, stewardName: r.stewardName ?? "" }));
}
