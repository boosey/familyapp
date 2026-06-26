/**
 * Tests for the asked-question relay (Increment 7).
 *
 * The full loop tested here:
 *   - Ask created (queued)
 *   - story persisted with askId
 *   - story progressed to pending_approval (mirrors post-pipeline state)
 *   - elder approves -> in ONE tx the consent ledger row lands AND the Ask flips to `answered`
 *     pointing at the story.
 *
 * Plus the small lifecycle helpers (`markAskRouted`, `markAskAnswered`) and the asker's view.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  createAsk,
  InvariantViolation,
  listAsksByAsker,
  markAskAnswered,
  markAskRouted,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";
import { asks } from "@chronicle/db/schema";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function relaySetup() {
  const elder = await makePerson(db, "Eleanor");
  const cousin = await makePerson(db, "Sofia");
  const fam = await makeFamily(db, "B", elder.id);
  await addMembership(db, elder.id, fam.id);
  await addMembership(db, cousin.id, fam.id);
  return { elder, cousin, fam };
}

async function pendingApprovableStoryForAsk(opts: {
  ownerPersonId: string;
  askId: string;
}): Promise<string> {
  const { story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: opts.ownerPersonId,
      storageKey: `r2://chronicle/${Math.random()}.webm`,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum: "sha256:r",
    },
    { askId: opts.askId },
  );
  await updateDerivedFields(db, story.id, {
    transcript: "answer",
    prose: "answer.",
    title: "title",
    summary: "s",
    tags: [],
  });
  await transitionStoryState(db, story.id, "pending_approval");
  return story.id;
}

describe("approval atomically closes the relay (story.askId → ask answered)", () => {
  it("approval flips a queued Ask to `answered` with storyId + answeredAt, in the SAME transaction", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Tell me about your wedding." },
    );
    const storyId = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });

    const now = new Date("2026-06-26T12:00:00Z");
    const result = await approveAndShareStory(db, {
      storyId,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
      now,
    });

    expect(result.answeredAsk).not.toBeNull();
    expect(result.answeredAsk!.status).toBe("answered");
    expect(result.answeredAsk!.storyId).toBe(storyId);
    expect(result.answeredAsk!.answeredAt?.getTime()).toBe(now.getTime());

    // And the consent + state changes also landed.
    expect(result.story.state).toBe("shared");
    expect(result.consentRecord.action).toBe("approved_for_sharing");
  });

  it("approval also closes the relay when the interviewer ALREADY marked the Ask `routed`", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Q" },
    );
    await markAskRouted(db, ask.id);
    const storyId = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });

    const result = await approveAndShareStory(db, {
      storyId,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });
    expect(result.answeredAsk?.status).toBe("answered");
    expect(result.answeredAsk?.storyId).toBe(storyId);
  });

  it("approval of a story with NO linked Ask leaves answeredAsk null (does not break the non-relay path)", async () => {
    const { elder } = await relaySetup();
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: elder.id,
      storageKey: "r2://r1.webm",
      contentType: "audio/webm",
      checksum: "sha256:r",
    });
    await updateDerivedFields(db, story.id, {
      transcript: "t",
      prose: "p",
      title: "T",
      summary: "s",
      tags: [],
    });
    await transitionStoryState(db, story.id, "pending_approval");
    const result = await approveAndShareStory(db, {
      storyId: story.id,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });
    expect(result.answeredAsk).toBeNull();
  });

  it("rolls back the ASK flip when the surrounding tx fails (atomic with the consent write)", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Q" },
    );
    const storyId = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });
    // Force the consent insert (later in the tx than the ask flip) to fail.
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
    // Ask is still queued — the tx rolled back the answered flip.
    const [stillQueued] = await db.select().from(asks).where(sql`id = ${ask.id}`);
    expect(stillQueued?.status).toBe("queued");
    expect(stillQueued?.storyId).toBeNull();
  });

  it("rejects approval if the linked Ask was already answered by a DIFFERENT story (one ask → one story)", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Q" },
    );
    // First story answers the ask.
    const firstStory = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });
    await approveAndShareStory(db, {
      storyId: firstStory,
      elderPersonId: elder.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k1",
        contentType: "audio/webm",
        checksum: "sha256:1",
      },
    });
    // Second story ALSO points at the same ask (impossible in normal flow, but defense in depth).
    const secondStory = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });
    await expect(
      approveAndShareStory(db, {
        storyId: secondStory,
        elderPersonId: elder.id,
        audienceTier: "family",
        approvalAudio: {
          storageKey: "k2",
          contentType: "audio/webm",
          checksum: "sha256:2",
        },
      }),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("markAskRouted / markAskAnswered (lifecycle helpers)", () => {
  it("markAskRouted: queued → routed; idempotent on re-mark; rejects from answered", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Q" },
    );
    const routed = await markAskRouted(db, ask.id);
    expect(routed.status).toBe("routed");
    expect(routed.routedAt).not.toBeNull();
    // Idempotent: re-marking returns the same row, no error.
    const again = await markAskRouted(db, ask.id);
    expect(again.status).toBe("routed");
  });

  it("markAskAnswered: rejects when same ask is answered by a different story", async () => {
    const { elder, cousin } = await relaySetup();
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "Q" },
    );
    const storyA = await pendingApprovableStoryForAsk({
      ownerPersonId: elder.id,
      askId: ask.id,
    });
    await markAskAnswered(db, ask.id, storyA);
    await expect(
      markAskAnswered(db, ask.id, "00000000-0000-0000-0000-000000000099"),
    ).rejects.toBeInstanceOf(InvariantViolation);
  });
});

describe("listAsksByAsker (hub notification view)", () => {
  it("returns the asker's own asks with target name, most-recent first", async () => {
    const { elder, cousin } = await relaySetup();
    const a1 = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "first" },
    );
    await new Promise((r) => setTimeout(r, 5));
    const a2 = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "second" },
    );
    const seen = await listAsksByAsker(db, { kind: "account", personId: cousin.id });
    expect(seen.map((s) => s.ask.id)).toEqual([a2.id, a1.id]);
    expect(seen[0]!.targetSpokenName).toBe("Eleanor");
  });

  it("does NOT leak other people's asks", async () => {
    const { elder, cousin } = await relaySetup();
    const stranger = await makePerson(db, "Stranger");
    await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: elder.id, questionText: "private to cousin" },
    );
    const seen = await listAsksByAsker(db, { kind: "account", personId: stranger.id });
    expect(seen).toEqual([]);
  });

  it("returns nothing for anonymous viewers", async () => {
    const seen = await listAsksByAsker(db, { kind: "anonymous" });
    expect(seen).toEqual([]);
  });
});
