/**
 * Tests for `captureApproval` — the capture-side approval helper that mirrors `ingestRecording`'s
 * storage-first ordering for the elder's spoken approval clip.
 */
import {
  getStoryForViewer,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  InMemoryMediaStorage,
  type MediaStorage,
  type PutObjectInput,
} from "@chronicle/storage";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureApproval,
  createElderSession,
  InvalidAudienceTierError,
  InvalidSessionError,
  StoryNotApprovableError,
} from "../src/index";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function rowCount(d: Database, table: string): Promise<number> {
  const result = await d.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function setup() {
  const [elder] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor" })
    .returning();
  const [inviter] = await db
    .insert(persons)
    .values({ displayName: "Sofia", spokenName: "Sofia" })
    .returning();
  const [fam] = await db
    .insert(families)
    .values({
      name: "Boudreaux",
      creatorPersonId: inviter!.id,
      stewardPersonId: inviter!.id,
    })
    .returning();
  // Both the elder (narrator) and the inviter must be active members — createElderSession gates on it.
  await db.insert(memberships).values([
    { personId: elder!.id, familyId: fam!.id, role: "narrator", status: "active" },
    { personId: inviter!.id, familyId: fam!.id, role: "member", status: "active" },
  ]);
  const { token } = await createElderSession(db, {
    personId: elder!.id,
    familyId: fam!.id,
    invitedByPersonId: inviter!.id,
  });
  // Get a story to pending_approval (mirrors post-pipeline state).
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: elder!.id,
    storageKey: "r2://story/x.webm",
    contentType: "audio/webm",
    durationSeconds: 90,
    checksum: "sha256:s",
  });
  await updateDerivedFields(db, story.id, {
    transcript: "transcript",
    prose: "prose",
    title: "title",
    summary: "summary",
    tags: [],
  });
  await transitionStoryState(db, story.id, "pending_approval");
  return { elder: elder!, inviter: inviter!, family: fam!, token, storyId: story.id };
}

describe("captureApproval (voice-only approval gate)", () => {
  it("uploads the approval audio, then atomically shares the story and writes the first consent row", async () => {
    const { elder, storyId, token } = await setup();

    const result = await captureApproval(db, storage, {
      sessionToken: token,
      storyId,
      audienceTier: "family",
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: "audio/webm",
        durationSeconds: 2,
      },
    });

    // Approval audio is durable in storage at the returned key, with the elder's bytes.
    expect(await storage.exists(result.approvalAudioStorageKey)).toBe(true);
    expect(Array.from((await storage.getBytes(result.approvalAudioStorageKey))!)).toEqual([
      1, 2, 3, 4,
    ]);

    // Story is now shared at the chosen tier.
    expect(result.story.state).toBe("shared");
    expect(result.story.audienceTier).toBe("family");
    // The consent row points at the approval-audio media.
    expect(result.consentRecord.action).toBe("approved_for_sharing");
    expect(result.consentRecord.approvalAudioMediaId).toBe(result.approvalAudio.id);
    // Owner sees the shared story via the front door.
    const seen = await getStoryForViewer(
      db,
      { kind: "elder_session", personId: elder.id },
      storyId,
    );
    expect(seen?.state).toBe("shared");
  });

  it("rejects an invalid session and writes NOTHING (no orphan approval audio anywhere)", async () => {
    const { storyId } = await setup();
    await expect(
      captureApproval(db, storage, {
        sessionToken: "bogus",
        storyId,
        audienceTier: "family",
        audio: { bytes: new Uint8Array([9]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(storage.size).toBe(0);
    expect(await rowCount(db, "consent_records")).toBe(0);
  });

  it("rejects an approval against a story this session does not own", async () => {
    const { storyId } = await setup();
    // A second elder + session
    const [otherElder] = await db
      .insert(persons)
      .values({ displayName: "Maria", spokenName: "Maria" })
      .returning();
    const [other] = await db
      .insert(persons)
      .values({ displayName: "OtherInviter", spokenName: "OtherInviter" })
      .returning();
    const [otherFam] = await db
      .insert(families)
      .values({
        name: "Other",
        creatorPersonId: other!.id,
        stewardPersonId: other!.id,
      })
      .returning();
    await db.insert(memberships).values([
      { personId: otherElder!.id, familyId: otherFam!.id, role: "narrator", status: "active" },
      { personId: other!.id, familyId: otherFam!.id, role: "member", status: "active" },
    ]);
    const { token: otherToken } = await createElderSession(db, {
      personId: otherElder!.id,
      familyId: otherFam!.id,
      invitedByPersonId: other!.id,
    });

    await expect(
      captureApproval(db, storage, {
        sessionToken: otherToken,
        storyId,
        audienceTier: "family",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(StoryNotApprovableError);
    // Front-door denied before the storage write — no audio leak.
    expect(storage.size).toBe(0);
  });

  it("if the DB-side atomic write fails, the approval audio is preserved in storage (authenticity beats polish)", async () => {
    const { storyId, token } = await setup();
    // Drop consent_records to force the tx to fail on the consent insert.
    await db.execute(sql`DROP TABLE consent_records CASCADE`);

    await expect(
      captureApproval(db, storage, {
        sessionToken: token,
        storyId,
        audienceTier: "family",
        audio: { bytes: new Uint8Array([7, 7, 7]), contentType: "audio/webm" },
      }),
    ).rejects.toThrow();

    // The spoken approval IS preserved in storage, even though the DB write rolled back.
    expect(storage.size).toBe(1);
    // The story is still pending_approval (the tx rolled back).
    const result = await db.execute(
      sql`select state from stories where id = ${storyId}`,
    );
    const row = (result as unknown as { rows: Array<{ state: string }> }).rows[0]!;
    expect(row.state).toBe("pending_approval");
  });

  it("if the storage upload fails, neither an orphan blob nor a DB write occurs", async () => {
    const { storyId, token } = await setup();
    const failing: MediaStorage = {
      put: async (_input: PutObjectInput) => {
        throw new Error("simulated R2 outage");
      },
      getBytes: async () => null,
      exists: async () => false,
      getUrl: async (k: string) => `nowhere://${k}`,
    };
    await expect(
      captureApproval(db, failing, {
        sessionToken: token,
        storyId,
        audienceTier: "family",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toThrow(/simulated R2 outage/);

    expect(await rowCount(db, "consent_records")).toBe(0);
    const r = await db.execute(sql`select state from stories where id = ${storyId}`);
    const row = (r as unknown as { rows: Array<{ state: string }> }).rows[0]!;
    expect(row.state).toBe("pending_approval");
  });

  it("rejects an invalid audience tier (e.g. private) before any storage or DB write — the rule lives in the domain, not the route", async () => {
    const { storyId, token } = await setup();
    await expect(
      captureApproval(db, storage, {
        sessionToken: token,
        storyId,
        // @ts-expect-error — deliberately exercising the runtime guard against a tier the
        // transport layer must never let through (the type already forbids "private").
        audienceTier: "private",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidAudienceTierError);
    // Fail-fast: nothing was uploaded and no consent row was written.
    expect(storage.size).toBe(0);
    expect(await rowCount(db, "consent_records")).toBe(0);
  });

  it("rejects a garbage audience tier string the same way (no storage/DB write)", async () => {
    const { storyId, token } = await setup();
    await expect(
      captureApproval(db, storage, {
        sessionToken: token,
        storyId,
        // @ts-expect-error — a malformed tier value arriving from an untrusted client.
        audienceTier: "everyone",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidAudienceTierError);
    expect(storage.size).toBe(0);
    expect(await rowCount(db, "consent_records")).toBe(0);
  });

  it("refuses when the story is not in pending_approval (e.g. already shared, or still draft)", async () => {
    const { storyId, token, elder } = await setup();
    // Approve once to reach `shared`...
    await captureApproval(db, storage, {
      sessionToken: token,
      storyId,
      audienceTier: "family",
      audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
    });
    // ...a second attempt must fail (state has moved past pending_approval).
    await expect(
      captureApproval(db, storage, {
        sessionToken: token,
        storyId,
        audienceTier: "family",
        audio: { bytes: new Uint8Array([2]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(StoryNotApprovableError);
    // The owner still sees the shared story exactly once.
    const seen = await getStoryForViewer(
      db,
      { kind: "elder_session", personId: elder.id },
      storyId,
    );
    expect(seen?.state).toBe("shared");
  });
});
