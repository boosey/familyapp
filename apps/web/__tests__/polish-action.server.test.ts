/**
 * Server-side integration test for `polishAnswerProseAction` (ADR-0014 Inc 3, Slice 2).
 *
 * Slice 2 turns the ✨ Polish tap from a stateless text transform into a PERSISTED one: every real
 * polish appends an `ai_polished` prose_revisions row (carrying modelId + promptText) AND updates
 * `stories.prose`, via the core `logPolish`. The one exception is the no-op path — a tap on
 * empty/whitespace prose never runs a model (`polishProse` returns `modelId === ""`), so it must
 * write NOTHING (an empty `ai_polished` row would poison the lineage).
 *
 * The harness mirrors `compose-story-action.server.test.ts`: `@/lib/runtime` is mocked so importing
 * the actions module doesn't boot the real DEV runtime; getRuntime() reads settable module-level
 * bindings. The text compose path (ADR-0014 Inc 3) appends the typed take synchronously and leaves a
 * `draft` carrying the typed words as its prose — a real story to polish against (polish is allowed
 * on `draft` as well as `pending_approval`).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeTranscriber: Transcriber;
let runtimeEvaluator: FollowUpEvaluator;
let runtimeDispatch: (storyId: string) => Promise<void>;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    transcriber: runtimeTranscriber,
    dispatchPipeline: (storyId: string) => runtimeDispatch(storyId),
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { ScriptedFollowUpEvaluator, type FollowUpEvaluator } from "@chronicle/interviewer";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  createPipeline,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { sql } from "drizzle-orm";
import { composeStoryAction, polishAnswerProseAction } from "@/app/hub/answer/[askId]/actions";

// Valid render output for the render_story stage (responseFormat: "json"), plus the polished text
// the LLM returns for the polish call (responseFormat: "text").
const RENDER_JSON = JSON.stringify({
  prose: "A rendered memory, typed by the narrator.",
  title: "A Typed Memory",
  summary: "A memory the narrator wrote down.",
  tags: ["childhood"],
});
const POLISHED = "A tidier, polished memory the narrator can read back.";

function scriptedLlm(): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : POLISHED),
  });
}

function form(entries: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v instanceof Blob) fd.append(k, v, "recording.webm");
    else fd.append(k, v);
  }
  return fd;
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

// Seed a `draft` story carrying real working prose by driving the text compose path (ADR-0014 Inc 3:
// the typed take is appended synchronously and the draft stays `draft` with the typed words as its
// prose). `polishAnswerProseAction` is allowed on a `draft` (as well as `pending_approval`), so this
// is a real story to polish against.
async function seedStoryWithProse(personId: string): Promise<string> {
  authCtx = { kind: "account", personId };
  const result = await composeStoryAction(
    form({ text: "The summer we drove to the coast and the car broke down." }),
  );
  if (!("kind" in result) || result.kind !== "appended") {
    throw new Error(`expected an appended step seeding the story, got ${JSON.stringify(result)}`);
  }
  return result.storyId;
}

async function aiPolishedRows(
  db: Database,
  storyId: string,
): Promise<Array<{ text: string; story_recording_id: string | null; model_id: string }>> {
  const res = await db.execute(
    sql`select text, story_recording_id, model_id from prose_revisions
        where story_id = ${storyId} and level = 'ai_polished'`,
  );
  return (res as unknown as { rows: Array<{ text: string; story_recording_id: string | null; model_id: string }> }).rows;
}

async function storyProse(db: Database, storyId: string): Promise<string> {
  const res = await db.execute(sql`select prose from stories where id = ${storyId}`);
  return (res as unknown as { rows: Array<{ prose: string }> }).rows[0]!.prose;
}

describe("polishAnswerProseAction — persists the ✨ Polish tap (ADR-0014 Inc 3 slice 2)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    runtimeDispatch = async (storyId: string) => {
      const pipeline = createPipeline({
        db: runtimeDb,
        storage: runtimeStorage,
        transcriber: runtimeTranscriber,
        languageModel: runtimeLlm,
      });
      await pipeline.start(storyId);
      await pipeline.runToCompletion();
    };
    authCtx = { kind: "none" };
  });
  afterAll(() => {});

  it("(a) a real polish persists exactly one ai_polished row and updates stories.prose", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedStoryWithProse(personId);
    authCtx = { kind: "account", personId };

    const result = await polishAnswerProseAction(
      form({
        storyId,
        prose: "the summer we drove to the coast, um, and the car broke down",
        promptQuestion: "What was a memorable trip?",
      }),
    );

    // Returns the story's updated prose (the polished text, whitespace-trimmed by logPolish).
    expect(result).toEqual({ prose: POLISHED });

    // Exactly one ai_polished revision, un-attached to any recording, carrying a real modelId.
    const rows = await aiPolishedRows(runtimeDb, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(POLISHED);
    expect(rows[0]!.story_recording_id).toBeNull();
    expect(rows[0]!.model_id).toBe("mock-claude");

    // stories.prose now reflects the polish.
    expect(await storyProse(runtimeDb, storyId)).toBe(POLISHED);
  });

  it("(b) a tap on empty/whitespace prose writes NO ai_polished row and leaves stories.prose unchanged", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedStoryWithProse(personId);
    authCtx = { kind: "account", personId };

    const before = await storyProse(runtimeDb, storyId);

    const result = await polishAnswerProseAction(
      form({ storyId, prose: "   \n  ", promptQuestion: "" }),
    );

    // The no-op echoes the (empty) prose straight back — no model ran.
    expect(result).toEqual({ prose: "   \n  " });

    // No ai_polished row written, and stories.prose is untouched.
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
    expect(await storyProse(runtimeDb, storyId)).toBe(before);
  });

  it("rejects an unauthenticated caller", async () => {
    authCtx = { kind: "none" };
    const result = await polishAnswerProseAction(form({ storyId: "x", prose: "hi" }));
    expect("error" in result).toBe(true);
  });
});
