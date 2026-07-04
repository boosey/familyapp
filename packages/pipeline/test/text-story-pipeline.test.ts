/**
 * `getStoryAndRecordingForPipeline` must tolerate a text draft (ADR-0014 Inc 3).
 *
 * The old monolithic text-render path (render a text story FROM `stories.transcript`) is RETIRED —
 * text drafts are now COMPOSED via `appendTypedTakeContribution`, not rendered-from-transcript. What
 * still matters is the LEFT join: a text draft (recording_media_id = NULL) must return a non-null
 * view row with `kind:'text'` and `recording:null`. An INNER join would drop the story and the
 * pipeline would silently treat a valid draft as "gone". The voice sibling test guards that the same
 * LEFT join still returns a populated recording (createPipeline stays live for the voice path).
 */
import { createHash } from "node:crypto";
import { createTextDraft, persistRecordingAndCreateDraft } from "@chronicle/core";
import { getStoryAndRecordingForPipeline } from "@chronicle/core/pipeline";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";

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
    // ADR-0014 Inc 3: createTextDraft no longer writes the typed words into `transcript` — the bare
    // draft's transcript is NULL (the words are composed via appendTypedTakeContribution). The LEFT
    // join tolerance (non-null view, kind:'text', recording:null) is what this test still guards.
    expect(view!.transcript).toBeNull();
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
