/**
 * Server-side integration test for `shareAnswerAction`'s share-step family targeting (Task 4).
 *
 * On Share, the action resolves the chosen families (only for the family/branch tiers) via
 * `resolveComposeFamilies` against the owner's OWN active memberships, then forwards them to
 * `approveAndShareStory` as explicit `familyIds` (replacing default targeting). This suite drives the
 * three cases the client picker fans out to:
 *   (1) single-family author, nothing posted → auto-resolves to their sole family and forwards it;
 *   (2) multi-family author, explicit `familyIds` posted → forwards EXACTLY those;
 *   (3) multi-family author, empty selection → the ambiguous throw surfaces as `shareFailed` and the
 *       story is left un-shared (still pending_approval, no story_families rows).
 *
 * Harness mirrors `share-title.server.test.ts`: `@/lib/runtime` is mocked so importing the actions
 * module doesn't boot the real DEV runtime; the reviewable `pending_approval` story is seeded via the
 * core write surface; targeting is verified against actual `story_families` DB rows.
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
    // Post-approval memory feed is best-effort (its own try/catch); a no-op sink keeps it inert.
    narratorMemory: { record: async () => {} },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons, families, memberships, storyFamilies } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
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
import { hub } from "@/app/_copy";

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

function form(entries: Array<[string, string]>): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

async function makeFamilyWithMember(db: Database, name: string, personId: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: personId, stewardPersonId: personId })
    .returning();
  await db.insert(memberships).values({ personId, familyId: f!.id, status: "active" });
  return f!.id;
}

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

async function targetRows(storyId: string): Promise<string[]> {
  const rows = await runtimeDb
    .select({ familyId: storyFamilies.familyId })
    .from(storyFamilies)
    .where(eq(storyFamilies.storyId, storyId));
  return rows.map((r) => r.familyId);
}

/** Drive `shareAnswerAction`, swallowing the terminal `redirect("/hub")` (throws NEXT_REDIRECT). */
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

describe("shareAnswerAction — share-step family targeting (Task 4)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    runtimeDispatch = async () => {
      throw new Error("dispatchPipeline must NOT be called in the share path");
    };
    authCtx = { kind: "none" };
  });
  afterAll(() => {});

  it("(1) single-family author with no explicit pick auto-resolves + forwards their sole family", async () => {
    const personId = await makePerson(runtimeDb, "Eleanor");
    authCtx = { kind: "account", personId };
    const famId = await makeFamilyWithMember(runtimeDb, "Boudreaux", personId);
    const storyId = await seedPendingStory(personId);

    await share(form([["storyId", storyId], ["audienceTier", "family"]]));

    expect(await targetRows(storyId)).toEqual([famId]);
    const after = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(after!.state === "approved" || after!.state === "shared").toBe(true);
  });

  it("(2) multi-family author forwards EXACTLY the posted familyIds (overriding the default)", async () => {
    const personId = await makePerson(runtimeDb, "Alex");
    authCtx = { kind: "account", personId };
    const famA = await makeFamilyWithMember(runtimeDb, "Boudreaux", personId);
    const famB = await makeFamilyWithMember(runtimeDb, "Carney", personId);
    const storyId = await seedPendingStory(personId);

    // Explicit pick of famB only — famA must NOT be targeted.
    await share(form([["storyId", storyId], ["audienceTier", "family"], ["familyIds", famB]]));

    expect(await targetRows(storyId)).toEqual([famB]);
    expect(await targetRows(storyId)).not.toContain(famA);
  });

  it("(3) multi-family author with an empty selection fails as shareFailed and does NOT share", async () => {
    const personId = await makePerson(runtimeDb, "Alex");
    authCtx = { kind: "account", personId };
    await makeFamilyWithMember(runtimeDb, "Boudreaux", personId);
    await makeFamilyWithMember(runtimeDb, "Carney", personId);
    const storyId = await seedPendingStory(personId);

    // No familyIds posted → resolveComposeFamilies throws (ambiguous) → outer catch → shareFailed.
    const result = await shareAnswerAction(form([["storyId", storyId], ["audienceTier", "family"]]));
    expect(result?.error).toBe(hub.actions.shareFailed);

    // The story was never approved/shared and no targeting rows were written.
    const after = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(after!.state).toBe("pending_approval");
    expect(await targetRows(storyId)).toEqual([]);
  });
});
