/**
 * ADR-0011 anti-drift guard — the SQL visibility predicate MUST agree with the single-item oracle
 * row-for-row.
 *
 * `decideStoryRead` (the oracle) and `storyVisibilityPredicate` / `listStoriesForViewer` (the SQL
 * form) are two encodings of the SAME authorization decision: one evaluates a single story in JS,
 * the other pushes the whole allow/deny into a `WHERE` clause so Explore's feed/timeline/search can
 * page and sort at the database. Two encodings can drift. This property test makes drift a
 * CI failure: it generates random worlds (people, families, memberships across every status, stories
 * across every state × tier, layered consent ledgers, random family targeting) and asserts that for
 * EVERY viewer — including anonymous — the set of stories the predicate returns is exactly the set
 * the oracle allows. Any arm that one form handles differently from the other surfaces here.
 *
 * The generator is seeded (deterministic PRNG), so a failure reproduces from its seed rather than
 * being a heisenbug.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { stories as storiesTable } from "@chronicle/db/content";
import type { AudienceTier, MembershipStatus, StoryState } from "@chronicle/db";
import { describe, expect, it } from "vitest";
import {
  decideStoryRead,
  listStoriesForViewer,
  type AuthContext,
} from "../src/authorization";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
  revokeConsent,
  targetStoryToFamily,
} from "./helpers";
import { consentRecords } from "@chronicle/db/schema";

/** mulberry32 — a tiny deterministic PRNG so property failures reproduce from their seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEMBERSHIP_STATUSES: MembershipStatus[] = ["active", "paused", "ended"];
const STORY_STATES: StoryState[] = [
  "draft",
  "pending_approval",
  "approved",
  "shared",
  "archived",
];
const TIERS: AudienceTier[] = ["private", "branch", "family", "public"];

/**
 * Build one random world and return the ids needed to enumerate viewers. Every knob that the
 * authorization decision reads is randomized: membership status (only `active` counts), story state
 * (only approved/shared can ever be shared), tier (private/branch/family/public), the consent ledger
 * (approvals, revocations, and NON-sharing events that must be ignored in "latest wins"), and the
 * story→family target set (empty ⇒ owner-only).
 */
async function buildWorld(db: Database, rand: () => number): Promise<string[]> {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const chance = (p: number) => rand() < p;

  const personCount = 2 + Math.floor(rand() * 4); // 2..5
  const persons = [];
  for (let i = 0; i < personCount; i++) {
    persons.push(await makePerson(db, `P${i}`));
  }

  const familyCount = 1 + Math.floor(rand() * 3); // 1..3
  const families = [];
  for (let i = 0; i < familyCount; i++) {
    families.push(await makeFamily(db, `F${i}`, pick(persons).id));
  }

  // Memberships: each person may belong to each family with a random status.
  for (const person of persons) {
    for (const family of families) {
      if (chance(0.55)) {
        await addMembership(db, person.id, family.id, pick(MEMBERSHIP_STATUSES));
      }
    }
  }

  // Stories: random owner/state/tier, a randomized consent ledger, and a random target set.
  const storyCount = 3 + Math.floor(rand() * 6); // 3..8
  for (let i = 0; i < storyCount; i++) {
    const owner = pick(persons);
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: pick(STORY_STATES),
      audienceTier: pick(TIERS),
    });

    // A randomized consent ledger: a sequence of appends among approvals, revocations, and
    // non-sharing events (which must NOT affect the "latest sharing event wins" computation).
    const ledgerLen = Math.floor(rand() * 4); // 0..3 events
    for (let e = 0; e < ledgerLen; e++) {
      const r = rand();
      if (r < 0.5) {
        await db.insert(consentRecords).values({
          personId: owner.id,
          actorPersonId: owner.id,
          storyId: story.id,
          action: "approved_for_sharing",
          resultingState: "shared",
        });
      } else if (r < 0.8) {
        await revokeConsent(db, story.id, owner.id);
      } else {
        // A non-sharing event interleaved in the ledger — both forms must ignore it.
        await db.insert(consentRecords).values({
          personId: owner.id,
          actorPersonId: owner.id,
          storyId: story.id,
          action: "set_audience_tier",
          resultingState: "family",
        });
      }
    }

    // Target the story into a random subset of families (may be empty ⇒ owner-only).
    for (const family of families) {
      if (chance(0.4)) await targetStoryToFamily(db, story.id, family.id);
    }
  }

  return persons.map((p) => p.id);
}

describe("ADR-0011: SQL visibility predicate agrees with the oracle row-for-row", () => {
  const TRIALS = 30;

  for (let trial = 0; trial < TRIALS; trial++) {
    const seed = 0x9e3779b1 ^ (trial * 0x85ebca77);
    it(`random world #${trial} (seed ${seed >>> 0}) — predicate ≡ oracle for every viewer`, async () => {
      const db = await createTestDatabase();
      const rand = mulberry32(seed);
      const personIds = await buildWorld(db, rand);

      // The full population of stories, read directly (test-only) to drive the oracle.
      const allStories = await db.select().from(storiesTable);

      // Every viewer we test: each person (as an authenticated account) plus the anonymous surface.
      const viewers: AuthContext[] = [
        ...personIds.map((id) => ({ kind: "account" as const, personId: id })),
        { kind: "anonymous" as const },
      ];

      for (const ctx of viewers) {
        // Oracle: the single-item decision applied to every story.
        const oracleIds = new Set<string>();
        for (const story of allStories) {
          if ((await decideStoryRead(db, ctx, story)).allowed) {
            oracleIds.add(story.id);
          }
        }

        // SQL form: the set the predicate returns in one query.
        const predicateIds = new Set(
          (await listStoriesForViewer(db, ctx)).map((s) => s.id),
        );

        const who =
          ctx.kind === "anonymous" ? "anonymous" : `account ${ctx.personId}`;
        expect(
          [...predicateIds].sort(),
          `predicate/oracle disagreement for ${who} (seed ${seed >>> 0})`,
        ).toEqual([...oracleIds].sort());
      }
    });
  }
});
