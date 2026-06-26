/**
 * Tests for the voice-only approval gate (Increment 5) — the atomic transition
 * pending_approval → approved → shared with a backing first ConsentRecord, and the
 * authorization function's behavior across the full visibility lifecycle.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTranscriptCorrection,
  approveAndShareStory,
  getStoryForViewer,
  InvariantViolation,
  listStoriesForViewer,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  revokeConsent,
} from "./helpers";
import { media } from "@chronicle/db/content";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/**
 * Helper: get a story to a realistic pre-approval state (post-pipeline): pending_approval with
 * a draft recording, transcript + prose populated. Mirrors what `runRenderStoryStage` leaves.
 */
async function makeApprovableStory(opts: {
  ownerPersonId: string;
}): Promise<string> {
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: opts.ownerPersonId,
    storageKey: `r2://chronicle/rec-${Math.random()}.webm`,
    contentType: "audio/webm",
    durationSeconds: 90,
    checksum: "sha256:abc",
  });
  await updateDerivedFields(db, story.id, {
    transcript: "I was born in 1947 in a small town outside Lisbon.",
    prose: "I was born in 1947 in a small town outside Lisbon.",
    title: "Lisbon",
    summary: "Birth and place.",
    tags: ["birth", "lisbon"],
  });
  await transitionStoryState(db, story.id, "pending_approval");
  return story.id;
}

describe("approveAndShareStory — atomic voice approval", () => {
  it("transitions pending_approval → shared, stamps tier+approvedAt, and writes the first consent row", async () => {
    const elder = await makePerson(db, "Eleanor");
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });

    const now = new Date("2026-06-26T12:00:00Z");
    const { story, approvalAudio, consentRecord } = await approveAndShareStory(
      db,
      {
        storyId,
        elderPersonId: elder.id,
        audienceTier: "family",
        approvalAudio: {
          storageKey: `approval-audio/${elder.id}/abc.webm`,
          contentType: "audio/webm",
          checksum: "sha256:approval",
          durationSeconds: 3,
        },
        now,
      },
    );

    expect(story.state).toBe("shared");
    expect(story.audienceTier).toBe("family");
    expect(story.approvedAt?.getTime()).toBe(now.getTime());
    expect(approvalAudio.kind).toBe("approval_audio");
    expect(approvalAudio.ownerPersonId).toBe(elder.id);
    expect(consentRecord.action).toBe("approved_for_sharing");
    expect(consentRecord.storyId).toBe(storyId);
    expect(consentRecord.approvalAudioMediaId).toBe(approvalAudio.id);
    expect(consentRecord.personId).toBe(elder.id);
    expect(consentRecord.actorPersonId).toBe(elder.id);
  });

  it("refuses approval if the actor is not the story owner (defense in depth at the write layer)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const impostor = await makePerson(db, "Impostor");
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });
    await expect(
      approveAndShareStory(db, {
        storyId,
        elderPersonId: impostor.id,
        audienceTier: "family",
        approvalAudio: {
          storageKey: "k",
          contentType: "audio/webm",
          checksum: "sha256:x",
        },
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("refuses approval if the story is not in pending_approval (state machine guard)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: elder.id,
      storageKey: "r2://x",
      contentType: "audio/webm",
      checksum: "sha256:y",
    });
    // story is `draft` — pipeline hasn't run yet
    await expect(
      approveAndShareStory(db, {
        storyId: story.id,
        elderPersonId: elder.id,
        audienceTier: "family",
        approvalAudio: {
          storageKey: "k",
          contentType: "audio/webm",
          checksum: "sha256:x",
        },
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });

  it("is atomic: if the consent insert fails, the media row + state transition both roll back", async () => {
    const elder = await makePerson(db, "Eleanor");
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });

    // Force the consent insert to fail by dropping the consent_records table inside the tx
    // window. We do this BEFORE the call so the insert raises mid-tx; the media insert and
    // story update must roll back so we end up with no orphan approval-audio media and the
    // story still in pending_approval.
    await db.execute(sql`DROP TABLE consent_records CASCADE`);

    await expect(
      approveAndShareStory(db, {
        storyId,
        elderPersonId: elder.id,
        audienceTier: "family",
        approvalAudio: {
          storageKey: "k",
          contentType: "audio/webm",
          checksum: "sha256:x",
        },
      }),
    ).rejects.toThrow();

    // Story state unchanged.
    const stillPending = await db.execute(
      sql`select state, audience_tier from stories where id = ${storyId}`,
    );
    const row = (stillPending as unknown as { rows: Array<{ state: string; audience_tier: string }> })
      .rows[0]!;
    expect(row.state).toBe("pending_approval");
    expect(row.audience_tier).toBe("private");

    // No approval-audio media row exists for the elder.
    const approvalRows = await db
      .select()
      .from(media)
      .where(sql`kind = 'approval_audio' and owner_person_id = ${elder.id}`);
    expect(approvalRows.length).toBe(0);
  });
});

describe("authorization regression: full visibility lifecycle", () => {
  it("before approval: invisible to family. After approval: visible at the chosen tier. After revoke: invisible again.", async () => {
    const elder = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const family = await makeFamily(db, "Boudreaux", elder.id);
    await addMembership(db, elder.id, family.id);
    await addMembership(db, cousin.id, family.id);

    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });
    const cousinCtx = { kind: "account" as const, personId: cousin.id };

    // Stage A: pending_approval — family CANNOT see it.
    expect(await getStoryForViewer(db, cousinCtx, storyId)).toBeNull();
    expect(
      (await listStoriesForViewer(db, cousinCtx)).map((s) => s.id),
    ).not.toContain(storyId);

    // Stage B: elder approves at `family` — cousin CAN now see it.
    await approveAndShareStory(db, {
      storyId,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "approval-audio/eleanor/x.webm",
        contentType: "audio/webm",
        checksum: "sha256:a",
      },
    });
    const seen = await getStoryForViewer(db, cousinCtx, storyId);
    expect(seen?.id).toBe(storyId);
    expect(seen?.state).toBe("shared");
    expect(seen?.audienceTier).toBe("family");

    // Stage C: elder revokes (a NEW superseding consent row) — cousin can no longer see it.
    await revokeConsent(db, storyId, elder.id);
    expect(await getStoryForViewer(db, cousinCtx, storyId)).toBeNull();
    expect(
      (await listStoriesForViewer(db, cousinCtx)).map((s) => s.id),
    ).not.toContain(storyId);

    // The elder herself (the owner) sees the story in every stage.
    const elderCtx = { kind: "elder_session" as const, personId: elder.id };
    expect((await getStoryForViewer(db, elderCtx, storyId))?.id).toBe(storyId);
  });

  it("private tier does not become visible to family even with an approval consent row", async () => {
    // The capture-side helper refuses `private` at the type level; this exercises the lower-level
    // authorization invariant: private means author-only, regardless of consent.
    const elder = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const family = await makeFamily(db, "Boudreaux", elder.id);
    await addMembership(db, elder.id, family.id);
    await addMembership(db, cousin.id, family.id);

    // Build the story manually so we can hold tier=private despite state=shared.
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });
    await approveAndShareStory(db, {
      storyId,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });
    // Manually downgrade the tier to private at the SQL layer to simulate a wedge case.
    await db.execute(
      sql`update stories set audience_tier = 'private' where id = ${storyId}`,
    );
    const cousinCtx = { kind: "account" as const, personId: cousin.id };
    expect(await getStoryForViewer(db, cousinCtx, storyId)).toBeNull();
  });
});

describe("applyTranscriptCorrection — voice correction regenerates derived fields only", () => {
  it("rewrites the transcript and clears prose/title/summary/tags; audio pointer is untouched", async () => {
    const elder = await makePerson(db, "Eleanor");
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });

    // Snapshot the canonical recording pointer + checksum before the correction.
    const before = await getStoryForViewer(
      db,
      { kind: "elder_session", personId: elder.id },
      storyId,
    );
    const recordingIdBefore = before!.recordingMediaId;

    const updated = await applyTranscriptCorrection(
      db,
      storyId,
      "I was born in 1948, not 1947, in a small town outside Lisbon.",
    );

    expect(updated.transcript).toMatch(/1948, not 1947/);
    expect(updated.prose).toBeNull();
    expect(updated.title).toBeNull();
    expect(updated.summary).toBeNull();
    expect(updated.tags).toEqual([]);
    // The canonical audio pointer is unchanged — the correction touches derived fields only.
    expect(updated.recordingMediaId).toBe(recordingIdBefore);
    // State stays pending_approval; the elder's next voice action (approval) advances it.
    expect(updated.state).toBe("pending_approval");
  });

  it("refuses to apply a correction once the story has been shared (post-share edits need a new consent)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const storyId = await makeApprovableStory({ ownerPersonId: elder.id });
    await approveAndShareStory(db, {
      storyId,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });
    await expect(
      applyTranscriptCorrection(db, storyId, "anything"),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});
