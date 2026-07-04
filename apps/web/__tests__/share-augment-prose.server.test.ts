/**
 * Regression test for ADR-0014 Inc 3 slice 8, DECISION (c): `shareAnswerAction`'s post-approval
 * biographical augmentation must read `stories.prose`, NOT `stories.transcript`.
 *
 * New-model (append-built) stories leave `stories.transcript` NULL — only `prose` is populated — so the
 * old `if (approved?.transcript)` guard silently no-oped and augmentation never ran. Reading `prose`
 * makes it live once Finish creates a `pending_approval` story from appended takes.
 *
 * We partially mock `@chronicle/pipeline` (preserving every real export the actions module needs) and
 * replace only `augmentProfileFromStory` with a spy, so we can assert WHAT text it was handed.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeTranscriber: Transcriber;
let runtimeEvaluator: FollowUpEvaluator;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    transcriber: runtimeTranscriber,
    dispatchPipeline: async () => {},
  }),
}));

const augmentSpy = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@chronicle/pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chronicle/pipeline")>();
  return { ...actual, augmentProfileFromStory: (...args: unknown[]) => augmentSpy(...args) };
});

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import {
  createTextDraft,
  updateDerivedFields,
  transitionStoryState,
} from "@chronicle/core";
import { ScriptedFollowUpEvaluator, type FollowUpEvaluator } from "@chronicle/interviewer";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { shareAnswerAction } from "@/app/hub/answer/[askId]/actions";

const NEW_MODEL_PROSE = "A polished memory built from appended takes — no transcript was ever set.";

function scriptedLlm(): ScriptedLanguageModel {
  return new ScriptedLanguageModel({ respond: () => "unused" });
}

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

/**
 * Seed a NEW-MODEL `pending_approval` story: prose set, transcript LEFT NULL (append-built stories
 * never populate transcript). This is exactly the shape the old transcript-reading guard no-oped on.
 */
async function seedNewModelPending(personId: string): Promise<string> {
  const { story } = await createTextDraft(runtimeDb, {
    ownerPersonId: personId,
    text: "seed",
  });
  await updateDerivedFields(runtimeDb, story.id, {
    prose: NEW_MODEL_PROSE,
    title: "A Memory",
    summary: "A memory.",
    tags: ["memory"],
  });
  await transitionStoryState(runtimeDb, story.id, "pending_approval");
  return story.id;
}

async function share(fd: FormData): Promise<void> {
  try {
    const r = await shareAnswerAction(fd);
    throw new Error(`share did not redirect; returned ${JSON.stringify(r)}`);
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return;
    throw e;
  }
}

describe("shareAnswerAction — augment reads prose, not transcript (ADR-0014 Inc 3 slice 8, decision c)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    authCtx = { kind: "none" };
    augmentSpy.mockClear();
  });
  afterAll(() => {});

  it("augments from stories.prose on a new-model story (transcript NULL) — old transcript path would have no-oped", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedNewModelPending(personId);

    await share(form({ storyId, audienceTier: "family" }));

    // Augmentation ran, and was handed the PROSE text (not a null transcript).
    expect(augmentSpy).toHaveBeenCalledTimes(1);
    expect(augmentSpy.mock.calls[0]![0]).toBe(NEW_MODEL_PROSE);
    // The first arg is the person's own words, and personId is the second arg (the augment contract).
    expect(augmentSpy.mock.calls[0]![1]).toBe(personId);
  });
});
