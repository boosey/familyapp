/**
 * Finish-time Story date backstop at the pipeline seam (ADR-0026, issue #246), tiered-hybrid
 * edition. The render stage is the finish line for a pipeline-driven story, so a story still
 * Undated there gets one silent second chance: Tier A over the transcript, then — only if Tier A
 * misses — a Tier B recognizer call whose structured ref feeds the pure calculator. The single
 * ScriptedLanguageModel here serves BOTH the render call and the recognizer call, told apart by
 * the recognizer's system prompt.
 *
 * Acceptance criteria pinned here:
 *   - only Undated stories at finish time are processed (a dated story is never overwritten, and
 *     its recognizer call is never even made);
 *   - a confident, calculable recognition persists (the four occurred_* fields + backstop
 *     provenance);
 *   - an unusable recognition leaves the story Undated.
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

/**
 * A model that serves the render call with a render-shaped JSON and the Tier B recognizer call
 * (identified by its "date analyst" system prompt) with `temporalRef` — or an unresolvable verdict
 * when `temporalRef` is null.
 */
function pipelineModel(temporalRef: unknown | null): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => {
      const system = req.messages.find((m) => m.role === "system")?.content ?? "";
      if (system.includes("date analyst")) {
        return JSON.stringify(temporalRef ?? { dateStatus: "unresolvable", confidence: "low" });
      }
      const user = req.messages.find((m) => m.role === "user")?.content ?? "";
      const firstSentence = user.split(/[.!?]/)[0]?.trim() ?? "Untitled";
      return JSON.stringify({
        prose: user,
        title: firstSentence.slice(0, 60) || "Untitled",
        summary: firstSentence.slice(0, 140) || "",
        tags: [] as string[],
      });
    },
  });
}

async function runPipeline(
  storyId: string,
  transcriptText: string,
  temporalRef: unknown | null = null,
): Promise<ScriptedLanguageModel> {
  const transcriber = new ScriptedTranscriber({ text: transcriptText });
  const languageModel = pipelineModel(temporalRef);
  const pipeline = createPipeline({ db, storage, transcriber, languageModel });
  await pipeline.start(storyId);
  await pipeline.runToCompletion();
  return languageModel;
}

function ownerCtx(personId: string) {
  return { kind: "account" as const, personId };
}

describe("render stage — finish-time Story date backstop (ADR-0026 #246)", () => {
  it("Tier A: dates an Undated story from a stated year, with no recognizer call", async () => {
    const narratorId = await makeNarrator("1935-06-15");
    const storyId = await seedVoiceDraft(narratorId);

    const llm = await runPipeline(storyId, "We moved to Cherry Street in 1943.");

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.state).toBe("pending_approval"); // the render itself is unaffected
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1943-01-01");
    expect(story!.occurredEndDate).toBe("1943-12-31");
    expect(story!.occurredProvenance).toBe(`stated year "1943" ${BACKSTOP_PROVENANCE_SUFFIX}`);
    // Tier A resolved, so no recognizer call: the only LLM call is the render's.
    expect(llm.calls).toHaveLength(1);
  });

  it("Tier B: recognizes soft language, then the calculator dates it from birthDate", async () => {
    const narratorId = await makeNarrator("1935-06-15");
    const storyId = await seedVoiceDraft(narratorId);

    const llm = await runPipeline(storyId, "When I was 8, we moved to Cherry Street.", {
      dateStatus: "resolved",
      confidence: "high",
      ref: { type: "age", age: 8 },
    });

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1943-06-15");
    expect(story!.occurredEndDate).toBe("1944-06-14");
    expect(story!.occurredProvenance).toBe(`age 8, from birthdate ${BACKSTOP_PROVENANCE_SUFFIX}`);
    // Two calls: the render, then the Tier B recognizer (Tier A missed on soft language).
    expect(llm.calls).toHaveLength(2);
  });

  it("leaves the story Undated when neither tier can date it", async () => {
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

  it("NEVER overwrites a story date persisted during the interview (recognizer never called)", async () => {
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
    const llm = await runPipeline(storyId, "We drove to the coast in 1962 and it broke down.", {
      dateStatus: "resolved",
      confidence: "high",
      ref: { type: "stated_year", year: 1962 },
    });

    const story = await getStoryForViewer(db, ownerCtx(narratorId), storyId);
    expect(story!.occurredKind).toBe("date");
    expect(story!.occurredDate).toBe("1943-12-25");
    expect(story!.occurredProvenance).toBe("age 8 at Christmas, from birthdate");
    // Story was already dated, so the backstop short-circuits before any recognizer call.
    expect(llm.calls).toHaveLength(1);
  });
});
