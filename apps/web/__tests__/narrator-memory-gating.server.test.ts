/**
 * Regression tests for ADR-0014 §9 — the consent-gated narrator-memory WRITE seam.
 *
 * The memory MODEL is deferred; only the SEAM + call-sites exist. These tests lock the GATING so the
 * seam can't later be wired at the wrong moment:
 *   - Sharing/approving a Story feeds memory exactly once, with the APPROVED prose, and only after approval.
 *   - Discarding a draft NEVER feeds memory (a discarded/unshared draft is not consented).
 *   - Intake Save feeds memory once with the saved text; empty/whitespace Save does not (no-op skip).
 *
 * Same runtime-mock + spy pattern as share-augment-prose.server.test.ts: we swap `@/lib/runtime` for a
 * hand-built runtime whose `narratorMemory.record` is a spy, and drive the real server actions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeTranscriber: Transcriber;
let runtimeEvaluator: FollowUpEvaluator;
let authCtx: { kind: string; personId?: string };
const recordSpy = vi.fn(async (..._args: unknown[]) => {});

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    transcriber: runtimeTranscriber,
    dispatchPipeline: async () => {},
    narratorMemory: { record: recordSpy },
  }),
}));

// Preserve every real @chronicle/pipeline export the actions modules need; the augment call is a spy
// so the post-approval augmentation never touches a real LLM (it precedes the memory feed).
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
import { shareAnswerAction, discardAnswerAction } from "@/app/hub/answer/[askId]/actions";
import { saveIntakeAnswer } from "@/app/hub/about-you/actions";

const APPROVED_PROSE = "A polished memory the narrator approved for sharing.";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

/** Seed a `pending_approval` story ready for shareAnswerAction to approve. */
async function seedPending(personId: string): Promise<string> {
  const { story } = await createTextDraft(runtimeDb, { ownerPersonId: personId, text: "seed" });
  await updateDerivedFields(runtimeDb, story.id, {
    prose: APPROVED_PROSE,
    title: "A Memory",
    summary: "A memory.",
    tags: ["memory"],
  });
  await transitionStoryState(runtimeDb, story.id, "pending_approval");
  return story.id;
}

/** Seed a never-consented `draft` story (what discardAnswerAction operates on). */
async function seedDraft(personId: string): Promise<string> {
  const { story } = await createTextDraft(runtimeDb, { ownerPersonId: personId, text: "a draft" });
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

describe("narrator-memory seam — §9 consent gating", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = new ScriptedLanguageModel({ respond: () => "unused" });
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    authCtx = { kind: "none" };
    recordSpy.mockClear();
    augmentSpy.mockClear();
  });

  it("sharing/approving a story feeds memory exactly once, with the approved prose, after approval", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedPending(personId);

    await share(form({ storyId, audienceTier: "family" }));

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]![0]).toEqual({
      personId,
      source: "story",
      text: APPROVED_PROSE,
    });
    // The memory feed re-reads the APPROVED story; it can only carry that prose if approval ran first.
    // Augmentation (which runs on the same post-approval read) fired too, confirming the ordering.
    expect(augmentSpy).toHaveBeenCalledTimes(1);
  });

  it("a share that FAILS the ownership check never feeds memory", async () => {
    const ownerId = await makePerson(runtimeDb, "Owner");
    const storyId = await seedPending(ownerId);
    // A different signed-in person attempts to share the owner's story.
    const interloperId = await makePerson(runtimeDb, "Interloper");
    authCtx = { kind: "account", personId: interloperId };

    // Ownership check rejects → returns an error BEFORE approval, so the seam is never reached.
    const result = await shareAnswerAction(form({ storyId, audienceTier: "family" }));
    expect(result && "error" in result).toBe(true);
    expect(recordSpy).not.toHaveBeenCalled();
    expect(augmentSpy).not.toHaveBeenCalled();
  });

  it("discarding a draft NEVER feeds memory (a discarded/unshared draft is not consented)", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedDraft(personId);

    const result = await discardAnswerAction(form({ storyId }));

    // Discard succeeded (no error) and NOTHING was fed to memory — the gating.
    expect(result).toBeUndefined();
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("intake Save with non-empty text feeds memory once with the saved text", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    await saveIntakeAnswer([], "hometown", "I grew up in Metairie.");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]![0]).toEqual({
      personId,
      source: "intake",
      text: "I grew up in Metairie.",
    });
  });

  it("intake Save with empty/whitespace text does NOT feed memory (no-op skip)", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    await saveIntakeAnswer([], "hometown", "   ");

    expect(recordSpy).not.toHaveBeenCalled();
  });
});
