import {
  getStoryForViewer,
  listProseRevisions,
  listStoryRecordings,
  persistRecordingAndCreateDraft,
  persistTakeRecording,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ScriptedLanguageModel,
  stitchAndRenderStory,
  transcribeTakeToRecording,
  type Transcriber,
} from "../src/index";

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function makeNarrator(): Promise<string> {
  const [narrator] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
    .returning();
  return narrator!.id;
}

/**
 * A `Transcriber` keyed on the FIRST byte of the working copy: take 0 (bytes start with 0) →
 * "take zero words", take 1 (bytes start with 1) → "take one words". Lets one transcriber return
 * distinct per-take text without per-storageKey plumbing (the transcriber only sees bytes).
 */
const byteKeyedTranscriber: Transcriber = {
  async transcribe(input) {
    const first = input.bytes[0];
    return {
      text: first === 0 ? "take zero words" : "take one words",
      words: [],
      modelId: "mock-whisper",
    };
  },
};

/** Seed a draft story (take 0) + one follow-up take (take 1), each with its own storage bytes. */
async function seedTwoTakeStory(narratorId: string): Promise<{
  storyId: string;
  take0Id: string;
  take1Id: string;
}> {
  const take0Bytes = new Uint8Array([0, 0, 0]);
  const take0Key = `story-audio/${narratorId}/take0.webm`;
  await storage.put({ key: take0Key, bytes: take0Bytes, contentType: "audio/webm" });
  const persisted = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: narratorId,
      storageKey: take0Key,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum: sha(take0Bytes),
    },
    { promptQuestion: "Tell me about your childhood" },
  );
  const storyId = persisted.story.id;

  const take1Bytes = new Uint8Array([1, 1, 1]);
  const take1Key = `story-audio/${narratorId}/take1.webm`;
  await storage.put({ key: take1Key, bytes: take1Bytes, contentType: "audio/webm" });
  await persistTakeRecording(
    db,
    {
      ownerPersonId: narratorId,
      storageKey: take1Key,
      contentType: "audio/webm",
      durationSeconds: 30,
      checksum: sha(take1Bytes),
    },
    storyId,
  );

  const takes = await listStoryRecordings(db, storyId);
  return { storyId, take0Id: takes[0]!.id, take1Id: takes[1]!.id };
}

describe("multi-take pipeline — per-take transcribe + stitch-then-polish-once (ADR-0012)", () => {
  it("transcribes each take independently, then stitches + polishes ONCE at thread completion", async () => {
    const narratorId = await makeNarrator();
    const { storyId, take0Id, take1Id } = await seedTwoTakeStory(narratorId);

    // Per-take transcribe fills each take's own transcript (the evaluator's input).
    const r0 = await transcribeTakeToRecording(
      { db, storage, transcriber: byteKeyedTranscriber },
      take0Id,
    );
    const r1 = await transcribeTakeToRecording(
      { db, storage, transcriber: byteKeyedTranscriber },
      take1Id,
    );
    expect(r0.transcript).toBe("take zero words");
    expect(r1.transcript).toBe("take one words");

    // Both per-take transcripts are persisted in position order.
    const takes = await listStoryRecordings(db, storyId);
    expect(takes.map((t) => t.transcript)).toEqual(["take zero words", "take one words"]);

    // Stitch + polish ONCE. The scripted LLM records every call so we can assert exactly one.
    const languageModel = new ScriptedLanguageModel({
      respond: () =>
        JSON.stringify({
          prose: "A stitched, polished childhood memory.",
          title: "Childhood",
          summary: "A childhood recollection.",
          tags: ["childhood"],
        }),
    });
    await stitchAndRenderStory({ db, languageModel }, storyId);

    // The polish runs exactly once — NOT per take.
    expect(languageModel.calls).toHaveLength(1);

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narratorId },
      storyId,
    );
    expect(story).not.toBeNull();
    // Story transcript is the stitched per-take transcripts joined in order.
    expect(story!.transcript).toBe("take zero words\n\ntake one words");
    expect(story!.prose).toBe("A stitched, polished childhood memory.");
    expect(story!.prose!.length).toBeGreaterThan(0);
    expect(story!.title).toBe("Childhood");
    expect(story!.tags).toEqual(["childhood"]);
    expect(story!.state).toBe("pending_approval");
    // Still private — the polish stage never touches consent/audience.
    expect(story!.audienceTier).toBe("private");

    // Provenance: L1 (stitched transcript) then L2 (polished) — the single audited lineage.
    const rows = await listProseRevisions(db, storyId);
    expect(rows.map((r) => r.level)).toEqual(["ai_transcribed", "ai_polished"]);
    expect(rows[0]!.text).toBe("take zero words\n\ntake one words");
    expect(rows[1]!.modelId).toBe("mock-claude");
    expect(rows[1]!.promptText!.length).toBeGreaterThan(0);
  });
});
