/**
 * Finish-time Story date backstop at the pipeline seam (ADR-0026, issue #246). The render stage
 * is the finish line for a pipeline-driven story, so a story that is still Undated there gets
 * one silent derivation pass over the assembled transcript — ScriptedLanguageModel serves the
 * render call (the derive-metadata test tradition); the backstop itself is deterministic and
 * spends no LLM call.
 *
 * Acceptance criteria pinned here:
 *   - only Undated stories at finish time are processed (a dated story is never overwritten);
 *   - usable output persists (the four occurred_* fields, provenance identifying the backstop);
 *   - unusable output leaves the story Undated.
 */
import { createHash } from "node:crypto";
import {
  applyResolvedStoryDate,
  getStoryForViewer,
  persistRecordingAndCreateDraft,
} from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKSTOP_PROVENANCE_SUFFIX } from "../src/derive-story-date";
import { createPipeline, ScriptedLanguageModel, ScriptedTranscriber } from "../src/index";

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function makeNarrator(birthDate: string | null): Promise<string> {
  const [narrator] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1935, birthDate })
    .returning();
  return narrator!.id;
}

async function seedVoiceDraft(narratorId: string): Promise<string> {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const storageKey = `story-audio/${narratorId}/test.webm`;
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

async function runPipeline(storyId: string, transcriptText: string): Promise<ScriptedLanguageModel> {
  const transcriber = new ScriptedTranscriber({ text: transcriptText });
  const languageModel = new ScriptedLanguageModel();
  const pipeline = createPipeline({ db, storage, transcriber, languageModel });
  await pipeline.start(storyId);
  await pipeline.runToCompletion();
  return languageModel;
}

function ownerCtx(personId: string) {
  return { kind: "account" as const, personId };
}

describe("render stage — finish-time Story date backstop (ADR-0026 #246)", () => {
  it("dates an Undated story the transcript supports, with the backstop provenance marker", async () => {
    const narratorId = await makeNarrator("1935-06-15");
    const storyId = await seedVoiceDraft(narratorId);

    const llm = await runPipeline(storyId, "When I was 8, we moved to Cherry Street.");

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.state).toBe("pending_approval"); // the render itself is unaffected
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1943-06-15");
    expect(story!.occurredEndDate).toBe("1944-06-14");
    expect(story!.occurredProvenance).toBe(
      `age 8, from birthdate ${BACKSTOP_PROVENANCE_SUFFIX}`,
    );
    // The backstop spends no LLM call of its own: the only call is the render's.
    expect(llm.calls).toHaveLength(1);
  });

  it("leaves the story Undated when the transcript supports no date", async () => {
    const narratorId = await makeNarrator("1935-06-15");
    const storyId = await seedVoiceDraft(narratorId);

    await runPipeline(storyId, "We had a dog named Biscuit who slept on the porch.");

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.occurredKind).toBeNull();
    expect(story!.occurredDate).toBeNull();
    expect(story!.occurredEndDate).toBeNull();
    expect(story!.occurredProvenance).toBeNull();
  });

  it("NEVER overwrites a story date persisted during the interview", async () => {
    const narratorId = await makeNarrator("1935-06-15");
    const storyId = await seedVoiceDraft(narratorId);
    // Simulate the live path (#243): a date derived mid-interview, persisted before finish.
    await applyResolvedStoryDate(db, storyId, {
      kind: "date",
      date: "1943-12-25",
      endDate: null,
      provenance: "age 8 at Christmas, from birthdate",
    });

    // The transcript WOULD resolve differently ("in 1962") — the backstop must not touch it.
    await runPipeline(storyId, "We drove to the coast in 1962 and it broke down.");

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.occurredKind).toBe("date");
    expect(story!.occurredDate).toBe("1943-12-25");
    expect(story!.occurredProvenance).toBe("age 8 at Christmas, from birthdate");
  });
});
