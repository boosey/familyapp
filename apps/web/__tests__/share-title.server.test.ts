/**
 * Server-side integration test for `shareAnswerAction`'s edited-title persist (Task 8, ADR-0007).
 *
 * In review the narrator can edit the AI-derived title. On Share, if the form carries a non-empty
 * `correctedTitle`, it is persisted to `stories.title` via the audited core surface
 * (`updateDerivedFields`) BEFORE the approve/share step. When the field is absent (or whitespace),
 * the title is left unchanged.
 *
 * The harness mirrors `compose-story-action.server.test.ts`: `@/lib/runtime` is mocked so importing
 * the actions module doesn't boot the real DEV runtime. The reviewable `pending_approval` story is
 * seeded directly via the core write surface (ADR-0014 Inc 3 retired the straight-through text render),
 * with prose + a derived title. The story is read back through the front door (`getStoryForViewer`),
 * which returns the full row (incl. title) to the owner in any state.
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
import {
  getStoryForViewer,
  createTextDraft,
  updateDerivedFields,
  transitionStoryState,
  type AuthContext,
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

// Render output for the render_story stage (responseFormat: "json"). The derived title is the value
// the narrator sees pre-filled in the review editor.
const RENDER_JSON = JSON.stringify({
  prose: "A polished memory, typed by the narrator.",
  title: "Auto Title",
  summary: "A memory the narrator wrote down.",
  tags: ["childhood"],
});

function scriptedLlm(): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : "unused"),
  });
}

function ownerCtx(personId: string): AuthContext {
  return { kind: "account", personId };
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

/**
 * Seed a `pending_approval` story with a derived title, directly via the core write surface. The
 * text compose path no longer renders straight through (ADR-0014 Inc 3: it appends the typed take and
 * leaves the draft `draft`), so this seeds the reviewable state `shareAnswerAction` operates on the
 * same way the render stage would: prose + title written, then `draft → pending_approval`.
 */
async function seedPendingStory(personId: string): Promise<string> {
  const { story } = await createTextDraft(runtimeDb, {
    ownerPersonId: personId,
    text: "The summer we drove to the coast and the car broke down.",
  });
  await updateDerivedFields(runtimeDb, story.id, {
    transcript: "The summer we drove to the coast and the car broke down.",
    prose: "A polished memory, typed by the narrator.",
    title: "Auto Title",
    summary: "A memory the narrator wrote down.",
    tags: ["childhood"],
  });
  await transitionStoryState(runtimeDb, story.id, "pending_approval");
  return story.id;
}

/**
 * Drive `shareAnswerAction` and swallow the terminal `redirect("/hub")` (which throws NEXT_REDIRECT
 * on the success path). Any non-redirect throw, or an `{ error }` return (redirect never reached),
 * fails the test loudly.
 */
async function share(fd: FormData): Promise<void> {
  try {
    const r = await shareAnswerAction(fd);
    throw new Error(`share did not redirect; returned ${JSON.stringify(r)}`);
  } catch (e) {
    const digest = (e as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return; // success
    throw e;
  }
}

describe("shareAnswerAction — edited title persist (Task 8)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    // The seed path writes the reviewable story directly via core (no dispatch), and shareAnswerAction
    // never dispatches — this stub fails loudly if some path unexpectedly reaches for the pipeline.
    runtimeDispatch = async () => {
      throw new Error("dispatchPipeline must NOT be called in the share-title path");
    };
    authCtx = { kind: "none" };
  });
  afterAll(() => {});

  it("(1) persists a non-empty correctedTitle to stories.title before sharing", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedPendingStory(personId);

    // Sanity: the derived title is what the render stage wrote.
    const before = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(before!.title).toBe("Auto Title");

    await share(form({ storyId, audienceTier: "family", correctedTitle: "My Title" }));

    const after = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(after!.title).toBe("My Title");
    // The share still went through.
    expect(after!.state === "approved" || after!.state === "shared").toBe(true);
  });

  it("(2) leaves the title unchanged when no correctedTitle field is present", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedPendingStory(personId);

    await share(form({ storyId, audienceTier: "family" }));

    const after = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(after!.title).toBe("Auto Title");
  });

  it("(3) treats a whitespace-only correctedTitle as absent (title unchanged)", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const storyId = await seedPendingStory(personId);

    await share(form({ storyId, audienceTier: "family", correctedTitle: "   \n  " }));

    const after = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(after!.title).toBe("Auto Title");
  });
});
