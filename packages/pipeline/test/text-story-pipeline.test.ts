/**
 * ADR-0007 Task 6 — text stories route straight to `render_story`, skipping `transcribe`.
 *
 * A text story has no audio: its typed words ARE the transcript. The orchestrator must NOT call
 * the transcriber for it, and the story must still reach `pending_approval` with rendered prose.
 *
 * The subtle prerequisite (guarded here too): `getStoryAndRecordingForPipeline` must LEFT-join the
 * media table so a text draft (recording_media_id = NULL) still returns a non-null view row with
 * `kind:'text'` and `recording:null`. An INNER join would drop the story and the pipeline would
 * silently treat a valid draft as "gone".
 */
import { createHash } from "node:crypto";
import {
  createTextDraft,
  getStoryForViewer,
  persistRecordingAndCreateDraft,
} from "@chronicle/core";
import { getStoryAndRecordingForPipeline } from "@chronicle/core/pipeline";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { createPipeline, ScriptedLanguageModel, ScriptedTranscriber } from "../src/index";

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

async function seedVoiceDraft(narratorId: string): Promise<string> {
  const bytes = new Uint8Array([1, 2, 3]);
  const storageKey = `story-audio/${narratorId}/voice.webm`;
  await storage.put({ key: storageKey, bytes, contentType: "audio/webm" });
  const persisted = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narratorId,
    storageKey,
    contentType: "audio/webm",
    durationSeconds: 60,
    checksum: sha(bytes),
  });
  return persisted.story.id;
}

describe("getStoryAndRecordingForPipeline — tolerates a text story (LEFT join)", () => {
  it("returns a NON-null view for a text draft with kind:'text' and recording:null", async () => {
    const owner = await makeNarrator();
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner,
      text: "We drove to the coast.",
    });

    const view = await getStoryAndRecordingForPipeline(db, story.id);
    expect(view).not.toBeNull();
    expect(view!.kind).toBe("text");
    expect(view!.recording).toBeNull();
    // The typed words are canonical — they live in the transcript field already.
    expect(view!.transcript).toBe("We drove to the coast.");
  });

  it("still returns a populated recording for a voice story (no regression from LEFT join)", async () => {
    const owner = await makeNarrator();
    const storyId = await seedVoiceDraft(owner);

    const view = await getStoryAndRecordingForPipeline(db, storyId);
    expect(view).not.toBeNull();
    expect(view!.kind).toBe("voice");
    expect(view!.recording).not.toBeNull();
    expect(view!.recording!.storageKey).toBe(`story-audio/${owner}/voice.webm`);
    expect(view!.recording!.contentType).toBe("audio/webm");
  });
});

describe("pipeline — text stories skip transcribe (ADR-0007)", () => {
  it("skips transcribe, renders from typed text, reaches pending_approval — transcriber never called", async () => {
    const owner = await makeNarrator();
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner,
      text: "We drove to the coast.",
    });

    const transcriber = new ScriptedTranscriber({ text: "SHOULD NEVER BE USED" });
    const languageModel = new ScriptedLanguageModel({
      respond: () =>
        JSON.stringify({
          prose: "We drove to the coast.",
          title: "A drive to the coast",
          summary: "A day trip to the coast.",
          tags: ["travel"],
        }),
    });

    const pipeline = createPipeline({ db, storage, transcriber, languageModel });
    await pipeline.start(story.id);
    await pipeline.runToCompletion();

    // The transcriber must NEVER have been called for a text story.
    expect(transcriber.calls.length).toBe(0);
    // The language model DID render the typed text into prose.
    expect(languageModel.calls.length).toBe(1);

    const owned = await getStoryForViewer(
      db,
      { kind: "link_session", personId: owner },
      story.id,
    );
    expect(owned).not.toBeNull();
    expect(owned!.state).toBe("pending_approval");
    expect(owned!.prose).toBe("We drove to the coast.");
    expect(owned!.title).toBe("A drive to the coast");
    // Still private — no consent yet.
    expect(owned!.audienceTier).toBe("private");
  });
});
