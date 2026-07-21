import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import {
  persons,
  memberships,
  families,
  consentRecords,
} from "@chronicle/db/schema";
import {
  storyLikes,
} from "@chronicle/db/content";
import {
  persistRecordingAndCreateDraft,
  updateDerivedFields,
  editStoryDetails,
  editStoryDate,
  retargetStoryFamilies,
  editStoryProse,
  setStoryFavorite,
  setStoryLike,
  getLikeState,
  approveAndShareStory,
  listProseRevisions,
  eraseStory,
  finishDraft,
} from "../src/index";
import { InvariantViolation } from "../src/errors";
import { eq, and } from "drizzle-orm";

let db: Database;

beforeEach(async () => {
  db = await createTestDatabase();
});

async function createPerson(name: string): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

async function createActiveFamily(personId: string, name: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, stewardPersonId: personId, creatorPersonId: personId })
    .returning();
  await db
    .insert(memberships)
    .values({ personId, familyId: f!.id, status: "active" })
    .returning();
  return f!.id;
}

describe("Story Management Core", () => {
  // ---------------------------------------------------------------------------
  // Unit 03: Edit Title & Tags
  // ---------------------------------------------------------------------------
  describe("editStoryDetails", () => {
    it("allows owner to edit details of a shared story and normalization works", async () => {
      const ownerId = await createPerson("Alice");
      const familyId = await createActiveFamily(ownerId, "Smiths");

      // 1. Create a draft
      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      // 2. Transition to approved/shared
      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });

      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [familyId],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      // 3. Edit title & tags
      const updated = await editStoryDetails(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        title: "  New Title  ",
        tags: ["  Family ", "Family", "", "trip"],
      });

      expect(updated.title).toBe("New Title");
      expect(updated.tags).toEqual(["Family", "trip"]);

      // 4. Verify audit row appended
      const revisions = await listProseRevisions(db, story.id);
      const auditRow = revisions.find((r) => r.level === "human_metadata_edit");
      expect(auditRow).toBeDefined();
      expect(auditRow!.actorPersonId).toBe(ownerId);
    });

    it("rejects edit details from non-owner", async () => {
      const ownerId = await createPerson("Alice");
      const otherId = await createPerson("Bob");

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      await expect(
        editStoryDetails(db, {
          storyId: story.id,
          actorPersonId: otherId,
          title: "New Title",
          tags: ["trip"],
        }),
      ).rejects.toThrow(InvariantViolation);
    });
  });

  // ---------------------------------------------------------------------------
  // Story date edit (ADR-0026 #241)
  // ---------------------------------------------------------------------------
  describe("editStoryDate", () => {
    it("lets the owner set, change, and clear the Story date in all three forms on a shared story", async () => {
      const ownerId = await createPerson("Alice");
      const familyId = await createActiveFamily(ownerId, "Smiths");

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });
      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });
      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [familyId],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      // Born Undated.
      expect(story.occurredKind).toBeNull();

      // date — an exact point.
      const asDate = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: { kind: "date", date: "1943-12-25" },
      });
      expect(asDate.occurredKind).toBe("date");
      expect(asDate.occurredDate).toBe("1943-12-25");
      expect(asDate.occurredEndDate).toBeNull();
      expect(asDate.occurredProvenance).toBeNull();

      // period — a true span with start and end.
      const asPeriod = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: { kind: "period", date: "1951-09-01", endDate: "1955-06-30" },
      });
      expect(asPeriod.occurredKind).toBe("period");
      expect(asPeriod.occurredDate).toBe("1951-09-01");
      expect(asPeriod.occurredEndDate).toBe("1955-06-30");

      // circa — an approximate point; a stray endDate is discarded (point forms have no end).
      const asCirca = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: { kind: "circa", date: "1965-01-01", endDate: "1965-12-31" },
      });
      expect(asCirca.occurredKind).toBe("circa");
      expect(asCirca.occurredDate).toBe("1965-01-01");
      expect(asCirca.occurredEndDate).toBeNull();

      // clear — mark the story Undated again (all four fields cleared).
      const cleared = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: null,
      });
      expect(cleared.occurredKind).toBeNull();
      expect(cleared.occurredDate).toBeNull();
      expect(cleared.occurredEndDate).toBeNull();
      expect(cleared.occurredProvenance).toBeNull();

      // Each real change appended the same metadata-edit audit row editStoryDetails writes.
      const revisions = await listProseRevisions(db, story.id);
      const auditRows = revisions.filter((r) => r.level === "human_metadata_edit");
      expect(auditRows).toHaveLength(4);
      expect(auditRows.every((r) => r.actorPersonId === ownerId)).toBe(true);
    });

    it("clears the provenance note when the value changes; a no-op save keeps it and writes nothing", async () => {
      const ownerId = await createPerson("Alice");
      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });
      await updateDerivedFields(db, story.id, {
        occurredKind: "date",
        occurredDate: "1943-12-25",
        occurredProvenance: "age 8 at Christmas, from birthdate",
      });

      // No-op save (same value): the derivation note is kept and NO audit row is appended.
      const untouched = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: { kind: "date", date: "1943-12-25" },
      });
      expect(untouched.occurredProvenance).toBe("age 8 at Christmas, from birthdate");
      let revisions = await listProseRevisions(db, story.id);
      expect(revisions.filter((r) => r.level === "human_metadata_edit")).toHaveLength(0);

      // A CHANGED value: the note records how the PREVIOUS value was derived, so it is cleared —
      // keeping it would attribute that derivation to a value it did not produce.
      const changed = await editStoryDate(db, {
        storyId: story.id,
        actorPersonId: ownerId,
        occurred: { kind: "date", date: "1944-12-25" },
      });
      expect(changed.occurredDate).toBe("1944-12-25");
      expect(changed.occurredProvenance).toBeNull();
      revisions = await listProseRevisions(db, story.id);
      expect(revisions.filter((r) => r.level === "human_metadata_edit")).toHaveLength(1);
    });

    it("rejects edits from a non-owner and for a missing story", async () => {
      const ownerId = await createPerson("Alice");
      const otherId = await createPerson("Bob");
      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      await expect(
        editStoryDate(db, {
          storyId: story.id,
          actorPersonId: otherId,
          occurred: { kind: "date", date: "1943-12-25" },
        }),
      ).rejects.toThrow(InvariantViolation);

      await expect(
        editStoryDate(db, {
          storyId: "00000000-0000-0000-0000-000000000000",
          actorPersonId: ownerId,
          occurred: { kind: "date", date: "1943-12-25" },
        }),
      ).rejects.toThrow(InvariantViolation);
    });

    it("rejects malformed dates, missing period ends, and inverted periods", async () => {
      const ownerId = await createPerson("Alice");
      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });
      const attempt = (occurred: Parameters<typeof editStoryDate>[1]["occurred"]) =>
        editStoryDate(db, { storyId: story.id, actorPersonId: ownerId, occurred });

      // Not ISO shape, impossible month, impossible day-of-month.
      await expect(attempt({ kind: "date", date: "25 December 1943" })).rejects.toThrow(
        InvariantViolation,
      );
      await expect(attempt({ kind: "date", date: "1943-13-01" })).rejects.toThrow(
        InvariantViolation,
      );
      await expect(attempt({ kind: "date", date: "1943-02-30" })).rejects.toThrow(
        InvariantViolation,
      );
      // A period requires its end, and the end must not precede the start.
      await expect(attempt({ kind: "period", date: "1951-09-01" })).rejects.toThrow(
        InvariantViolation,
      );
      await expect(
        attempt({ kind: "period", date: "1955-06-30", endDate: "1951-09-01" }),
      ).rejects.toThrow(InvariantViolation);

      // None of the rejected attempts wrote anything.
      const revisions = await listProseRevisions(db, story.id);
      expect(revisions.filter((r) => r.level === "human_metadata_edit")).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Unit 04: Manage Family Sharing
  // ---------------------------------------------------------------------------
  describe("retargetStoryFamilies", () => {
    it("allows owner to retarget families and logs a consent record", async () => {
      const ownerId = await createPerson("Alice");
      const f1 = await createActiveFamily(ownerId, "Smiths");
      const f2 = await createActiveFamily(ownerId, "Jones");

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      // Approve and share to f1
      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });

      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [f1],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      // Retarget to f2
      const ctx = { kind: "account" as const, personId: ownerId };
      const { targetedFamilyIds } = await retargetStoryFamilies(db, ctx, {
        storyId: story.id,
        familyIds: [f2],
      });

      expect(targetedFamilyIds).toEqual([f2]);

      // Verify consent record
      const consents = await db
        .select()
        .from(consentRecords)
        .where(
          and(
            eq(consentRecords.storyId, story.id),
            eq(consentRecords.action, "set_audience_tier"),
          ),
        );
      expect(consents.length).toBe(1);
      expect(consents[0]!.resultingState).toBe(f2);
    });
  });

  // ---------------------------------------------------------------------------
  // Unit 05: Edit Prose (Post-Share)
  // ---------------------------------------------------------------------------
  describe("editStoryProse", () => {
    it("allows owner to edit prose post-sharing and appends audit row", async () => {
      const ownerId = await createPerson("Alice");
      const f1 = await createActiveFamily(ownerId, "Smiths");

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      // Approve and share
      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });

      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [f1],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      const updated = await editStoryProse(db, {
        storyId: story.id,
        prose: "Updated prose body text.",
        actorPersonId: ownerId,
      });

      expect(updated.prose).toBe("Updated prose body text.");

      // Check audit row
      const revisions = await listProseRevisions(db, story.id);
      expect(revisions.some((r) => r.level === "human_corrected" && r.text === "Updated prose body text.")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Unit 06: Favorite (Private Bookmark)
  // ---------------------------------------------------------------------------
  describe("setStoryFavorite / getFavoriteState", () => {
    it("allows authorized viewer to favorite a story and returns aggregate count", async () => {
      const ownerId = await createPerson("Alice");
      const viewerId = await createPerson("Bob");
      const f1 = await createActiveFamily(ownerId, "Smiths");

      // Make Bob active in the Smiths family too
      await db
        .insert(memberships)
        .values({ personId: viewerId, familyId: f1, status: "active" })
        .returning();

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });

      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [f1],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      const viewerCtx = { kind: "account" as const, personId: viewerId };

      // Favorite it
      const favState = await setStoryFavorite(db, viewerCtx, {
        storyId: story.id,
        favorited: true,
      });

      expect(favState.favoritedByViewer).toBe(true);
      expect(favState.count).toBe(1);

      // Un-favorite it
      const unfavState = await setStoryFavorite(db, viewerCtx, {
        storyId: story.id,
        favorited: false,
      });
      expect(unfavState.favoritedByViewer).toBe(false);
      expect(unfavState.count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Unit 07: Like (Visible Reaction)
  // ---------------------------------------------------------------------------
  describe("setStoryLike / getLikeState", () => {
    it("returns leak-safe active family intersection likers list", async () => {
      const ownerId = await createPerson("Alice");
      const f1 = await createActiveFamily(ownerId, "Smiths");

      // Bob shares active family Smiths with Alice (owner)
      const bobId = await createPerson("Bob");
      await db
        .insert(memberships)
        .values({ personId: bobId, familyId: f1, status: "active" })
        .returning();

      // Charlie does NOT share active family with Bob
      const charlieId = await createPerson("Charlie");
      const f2 = await createActiveFamily(charlieId, "Jones");

      // Alice shares family Jones with Charlie too
      await db
        .insert(memberships)
        .values({ personId: ownerId, familyId: f2, status: "active" })
        .returning();

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      // Alice shares to both families
      await finishDraft(db, {
        storyId: story.id,
        ownerPersonId: ownerId,
        finalText: "Alice's story prose text.",
        metadata: { title: "Alice's Story", summary: "", tags: [] },
      });

      await approveAndShareStory(db, {
        storyId: story.id,
        narratorPersonId: ownerId,
        audienceTier: "family",
        familyIds: [f1, f2],
        approvalAudio: {
          storageKey: "approval.webm",
          contentType: "audio/webm",
          checksum: "fake-checksum",
        },
      });

      // Charlie likes it
      await setStoryLike(db, { kind: "account", personId: charlieId }, {
        storyId: story.id,
        liked: true,
      });

      // Bob likes it too
      await setStoryLike(db, { kind: "account", personId: bobId }, {
        storyId: story.id,
        liked: true,
      });

      // Bob views the like state
      const bobLikeState = await getLikeState(db, { kind: "account", personId: bobId }, story.id);
      expect(bobLikeState.count).toBe(2);
      
      // Bob should see Bob (self) and Alice (if she likes) but NOT Charlie because Bob and Charlie share no active families
      expect(bobLikeState.likers.some((l) => l.personId === bobId)).toBe(true);
      expect(bobLikeState.likers.some((l) => l.personId === charlieId)).toBe(false);
    });

    it("cascades deletion of likes when a story is erased", async () => {
      const ownerId = await createPerson("Alice");
      await createActiveFamily(ownerId, "Smiths");

      const { story } = await persistRecordingAndCreateDraft(db, {
        ownerPersonId: ownerId,
        storageKey: "take0.webm",
        contentType: "audio/webm",
        checksum: "fake-checksum",
      });

      // Like it
      await setStoryLike(db, { kind: "account", personId: ownerId }, {
        storyId: story.id,
        liked: true,
      });

      // Erase story
      await eraseStory(db, { kind: "account", personId: ownerId }, { storyId: story.id });

      // Verify no likes remain in DB for that story
      const likes = await db
        .select()
        .from(storyLikes)
        .where(eq(storyLikes.storyId, story.id));
      expect(likes.length).toBe(0);
    });
  });
});
