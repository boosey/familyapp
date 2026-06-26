import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import { getConsentHistory, isCurrentlyShared, recordConsent } from "../src/index";
import { makePerson, makeStory } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("consent ledger API", () => {
  it("appends events and reads them back in append order", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, { ownerPersonId: e.id });
    await recordConsent(db, {
      personId: e.id,
      actorPersonId: e.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    await recordConsent(db, {
      personId: e.id,
      actorPersonId: e.id,
      storyId: story.id,
      action: "revoked",
      resultingState: "private",
    });
    const history = await getConsentHistory(db, story.id);
    expect(history.map((h) => h.action)).toEqual([
      "approved_for_sharing",
      "revoked",
    ]);
  });

  it("derives current sharing state from the latest event (revoke supersedes)", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, { ownerPersonId: e.id });
    expect(await isCurrentlyShared(db, story.id)).toBe(false);
    await recordConsent(db, {
      personId: e.id,
      actorPersonId: e.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    expect(await isCurrentlyShared(db, story.id)).toBe(true);
    await recordConsent(db, {
      personId: e.id,
      actorPersonId: e.id,
      storyId: story.id,
      action: "revoked",
      resultingState: "private",
    });
    expect(await isCurrentlyShared(db, story.id)).toBe(false);
    // Re-approval supersedes the revocation.
    await recordConsent(db, {
      personId: e.id,
      actorPersonId: e.id,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
    expect(await isCurrentlyShared(db, story.id)).toBe(true);
  });
});
