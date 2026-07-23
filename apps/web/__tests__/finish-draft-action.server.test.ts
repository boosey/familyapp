/**
 * Server-side integration test for `finishDraftAction` (ADR-0014 Inc 3, Slice 8).
 *
 * Slice 8 adds the explicit Finish + a speculative Finish-check: on `intent="probe"` the action runs
 * `polishProse` on the CLIENT'S current editor text; if the polished result materially differs it
 * returns a `finish_offer` (persisting NOTHING) so the client can offer it; otherwise it finishes the
 * draft as-is (`draft → pending_approval`). `intent="accept"` re-uses the already-computed polished
 * text (0 extra polish calls): `logPolish` → `deriveMetadata` → `finishDraft`. `intent="decline"`
 * finishes the posted text as-is with no polish. priorProse discipline: Finish operates on the POSTED
 * prose, never a fresh `stories.prose` read.
 *
 * The harness mirrors `polish-action.server.test.ts`: `@/lib/runtime` is mocked so importing the
 * actions module doesn't boot the real DEV runtime; getRuntime() reads settable module-level bindings.
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

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { ScriptedFollowUpEvaluator, type FollowUpEvaluator } from "@chronicle/interviewer";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  BACKSTOP_PROVENANCE_SUFFIX,
  type LanguageModel,
  type LanguageModelRequest,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { applyResolvedStoryDate, getStoryForViewer, type AuthContext } from "@chronicle/core";
import { sql } from "drizzle-orm";
import { hub } from "@/app/_copy";
import { composeStoryAction, finishDraftAction } from "@/app/hub/answer/[askId]/actions";

// The polished text the LLM returns for a `polishProse` call (responseFormat: "text"). Materially
// different from any seed prose used below.
const POLISHED = "A tidier, polished version of the memory the narrator can read back.";
// Valid metadata for the deriveMetadata call (responseFormat: "json").
const META_JSON = JSON.stringify({
  title: "A Drive to the Coast",
  summary: "A memory of a summer road trip.",
  tags: ["travel", "summer"],
});

/** A LanguageModel that polishes (text) and derives metadata (json) off one instance. */
function scriptedLlm(polishedText: string = POLISHED): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? META_JSON : polishedText),
  });
}

/** Count the LLM calls of a given responseFormat — used to prove 0 extra polish calls on accept. */
function countCalls(llm: ScriptedLanguageModel, format: LanguageModelRequest["responseFormat"]): number {
  return llm.calls.filter((c) => c.responseFormat === format).length;
}

function form(entries: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v instanceof Blob) fd.append(k, v, "recording.webm");
    else fd.append(k, v);
  }
  return fd;
}

function ownerCtx(personId: string): AuthContext {
  return { kind: "account", personId };
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

// Seed a real `draft` story carrying working prose by driving the text compose path (ADR-0014 Inc 3:
// the typed take is appended synchronously and the draft stays `draft` with the typed words as prose).
async function seedDraftWithProse(personId: string, text: string): Promise<string> {
  authCtx = { kind: "account", personId };
  // Follow-ups run for every story now (default on). This helper only needs a `draft` with working
  // prose to finish — dark the incidental follow-up via the emergency kill switch so the seed compose
  // is deterministically `appended` regardless of the (often undated) seed text.
  const prevFlag = process.env.FOLLOW_UPS_ENABLED;
  process.env.FOLLOW_UPS_ENABLED = "0";
  let result;
  try {
    result = await composeStoryAction(form({ text }));
  } finally {
    if (prevFlag === undefined) delete process.env.FOLLOW_UPS_ENABLED;
    else process.env.FOLLOW_UPS_ENABLED = prevFlag;
  }
  if (!("kind" in result) || result.kind !== "appended") {
    throw new Error(`expected an appended step seeding the story, got ${JSON.stringify(result)}`);
  }
  return result.storyId;
}

async function aiPolishedRows(
  db: Database,
  storyId: string,
): Promise<Array<{ text: string; model_id: string }>> {
  const res = await db.execute(
    sql`select text, model_id from prose_revisions where story_id = ${storyId} and level = 'ai_polished'`,
  );
  return (res as unknown as { rows: Array<{ text: string; model_id: string }> }).rows;
}

describe("finishDraftAction — Finish + Finish-check (ADR-0014 Inc 3 slice 8)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    authCtx = { kind: "none" };
  });
  afterAll(() => {});

  it("probe: a materially-different polish returns finish_offer and persists NOTHING", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "the summer we drove to the coast");
    authCtx = { kind: "account", personId };

    const result = await finishDraftAction(
      form({ intent: "probe", storyId, prose: "the summer we drove to the coast and it broke down" }),
    );

    if (!("kind" in result) || result.kind !== "finish_offer") {
      throw new Error(`expected a finish_offer step, got ${JSON.stringify(result)}`);
    }
    expect(result.storyId).toBe(storyId);
    expect(result.polished).toBe(POLISHED);
    expect(result.polishModelId).toBe("mock-claude");
    expect(result.polishPromptText.length).toBeGreaterThan(0);

    // NOTHING persisted: story still `draft`, no ai_polished row, no metadata derived.
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("draft");
    expect(story!.title).toBeFalsy();
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
  });

  it("probe: a whitespace-only polish difference makes NO offer and finishes as-is", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };
    // The LLM 'polish' returns the SAME words with only whitespace changes → not a material change.
    runtimeLlm = scriptedLlm("Hello   world\n");

    const result = await finishDraftAction(
      form({ intent: "probe", storyId, prose: "Hello world" }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    // Finished with the POSTED text, not the polished-whitespace variant.
    expect(story!.prose).toBe("Hello world");
    // No polish was recorded (whitespace-only difference is not offered nor accepted).
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
  });

  it("probe: a polishProse no-op (modelId==='') makes NO offer and finishes as-is", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };
    // A model that returns an empty modelId → polishProse reports modelId==='' (no real model ran),
    // even for non-empty prose. The guard must treat this as "finish as-is".
    const emptyModelIdCalls: LanguageModelRequest[] = [];
    runtimeLlm = {
      async complete(req: LanguageModelRequest) {
        emptyModelIdCalls.push(req);
        return req.responseFormat === "json"
          ? { text: META_JSON, modelId: "mock-claude" }
          : { text: "totally different polished words here", modelId: "" };
      },
    } as LanguageModel;

    const result = await finishDraftAction(
      form({ intent: "probe", storyId, prose: "The real words the narrator wrote." }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.prose).toBe("The real words the narrator wrote.");
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
  });

  it("accept: records exactly ONE ai_polished row, finishes, and runs the polish LLM exactly once total", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "the summer we drove to the coast");
    authCtx = { kind: "account", personId };
    const llm = scriptedLlm();
    runtimeLlm = llm;

    // 1) Probe → offer (one polish call).
    const offer = await finishDraftAction(
      form({ intent: "probe", storyId, prose: "the summer we drove to the coast, um, and it broke down" }),
    );
    if (!("kind" in offer) || offer.kind !== "finish_offer") {
      throw new Error(`expected a finish_offer, got ${JSON.stringify(offer)}`);
    }
    expect(countCalls(llm, "text")).toBe(1);

    // 2) Accept → echoes the polished text + its modelId/promptText back (NO new polish call).
    const accepted = await finishDraftAction(
      form({
        intent: "accept",
        storyId,
        prose: "the summer we drove to the coast, um, and it broke down",
        polished: offer.polished,
        polishModelId: offer.polishModelId,
        polishPromptText: offer.polishPromptText,
      }),
    );
    expect(accepted).toEqual({ kind: "finished", storyId });

    // Exactly ONE ai_polished row (the polished text). The polish LLM (text) ran exactly once total
    // across the whole round-trip → 0 extra polish calls on accept. Two json calls now: deriveMetadata
    // plus the ADR-0026 finish-time Tier B backstop recognizer (the polished text states no calendar
    // date, so Tier A misses and the recognizer is consulted — it returns nothing usable here).
    const rows = await aiPolishedRows(runtimeDb, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(POLISHED);
    expect(countCalls(llm, "text")).toBe(1);
    expect(countCalls(llm, "json")).toBe(2);

    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.prose).toBe(POLISHED);
    expect(story!.title).toBe("A Drive to the Coast");
  });

  it("decline: finishes as-is with NO ai_polished row and derives metadata once", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "the summer we drove to the coast");
    authCtx = { kind: "account", personId };
    const llm = scriptedLlm();
    runtimeLlm = llm;

    const result = await finishDraftAction(
      form({ intent: "decline", storyId, prose: "The final words, exactly as I want them." }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
    // No polish (text) call. Two json calls: deriveMetadata plus the ADR-0026 finish-time Tier B
    // backstop recognizer (the final text states no calendar date, so Tier A misses and the
    // recognizer is consulted — returning nothing usable here, so the story stays Undated).
    expect(countCalls(llm, "text")).toBe(0);
    expect(countCalls(llm, "json")).toBe(2);

    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.prose).toBe("The final words, exactly as I want them.");
  });

  it("finishes from the POSTED prose, not a fresh stories.prose read (priorProse discipline)", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "the ORIGINAL db prose");
    authCtx = { kind: "account", personId };

    // The client's editor holds something different from what is currently in the DB.
    const posted = "the CLIENT edited prose, never seen by the db yet";
    const result = await finishDraftAction(form({ intent: "decline", storyId, prose: posted }));

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    // The finished prose is the POSTED text, not the stale DB prose.
    expect(story!.prose).toBe(posted);
  });

  it("rejects a non-account caller and persists nothing", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "none" };

    const result = await finishDraftAction(form({ intent: "decline", storyId, prose: "hi there" }));
    expect(result).toEqual({ error: hub.actions.notSignedIn });

    authCtx = { kind: "account", personId };
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("rejects a caller who does not own the story (IDOR) and persists nothing", async () => {
    const personId = await makePerson(runtimeDb, "Eleanor");
    const storyId = await seedDraftWithProse(personId, "seed text");
    const mallory = await makePerson(runtimeDb, "Mallory");
    authCtx = { kind: "account", personId: mallory };

    const result = await finishDraftAction(form({ intent: "decline", storyId, prose: "hi there" }));
    expect(result).toEqual({ error: hub.actions.storyNotFound });

    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("rejects finishing a non-draft story and persists nothing", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };
    // Move the story out of `draft` directly (raw SQL — the `stories` table is intentionally not
    // exported from the schema barrel) so the state guard fires.
    await runtimeDb.execute(
      sql`update stories set state = 'pending_approval' where id = ${storyId}`,
    );

    const result = await finishDraftAction(form({ intent: "decline", storyId, prose: "hi there" }));
    expect(result).toEqual({ error: hub.actions.storyNotFound });
    expect(await aiPolishedRows(runtimeDb, storyId)).toHaveLength(0);
  });

  it("rejects invalid input (missing prose / bad intent / missing storyId)", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };

    expect(await finishDraftAction(form({ intent: "decline", storyId }))).toEqual({
      error: hub.actions.invalidInput,
    });
    expect(await finishDraftAction(form({ intent: "bogus", storyId, prose: "x" }))).toEqual({
      error: hub.actions.invalidInput,
    });
    expect(await finishDraftAction(form({ intent: "decline", prose: "x" }))).toEqual({
      error: hub.actions.invalidInput,
    });
    // accept without a `polished` field is invalid.
    expect(await finishDraftAction(form({ intent: "accept", storyId, prose: "x" }))).toEqual({
      error: hub.actions.invalidInput,
    });
  });
});

describe("finishDraftAction — Story date backstop (ADR-0026 #246)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    authCtx = { kind: "none" };
  });

  it("decline: a finished-as-is story the prose supports a date for is dated by the backstop", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };

    const result = await finishDraftAction(
      form({ intent: "decline", storyId, prose: "We drove to the coast in 1962 and it broke down." }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1962-01-01");
    expect(story!.occurredEndDate).toBe("1962-12-31");
    expect(story!.occurredProvenance).toBe(`stated year "1962" ${BACKSTOP_PROVENANCE_SUFFIX}`);
  });

  it("accept: the backstop runs over the sealed POLISHED text", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "the summer we drove to the coast");
    authCtx = { kind: "account", personId };
    const llm = scriptedLlm();
    runtimeLlm = llm;

    const offer = await finishDraftAction(
      form({ intent: "probe", storyId, prose: "the summer we drove to the coast, um, and it broke down" }),
    );
    if (!("kind" in offer) || offer.kind !== "finish_offer") {
      throw new Error(`expected a finish_offer, got ${JSON.stringify(offer)}`);
    }
    // Probe persists NOTHING — still Undated.
    let story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.occurredKind).toBeNull();

    const accepted = await finishDraftAction(
      form({
        intent: "accept",
        storyId,
        prose: "the summer we drove to the coast, um, and it broke down",
        polished: "A tidier account of the drive to the coast in 1962.",
        polishModelId: offer.polishModelId,
        polishPromptText: offer.polishPromptText,
      }),
    );
    expect(accepted).toEqual({ kind: "finished", storyId });
    story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1962-01-01");
    expect(story!.occurredProvenance).toBe(`stated year "1962" ${BACKSTOP_PROVENANCE_SUFFIX}`);
  });

  it("leaves the story Undated when the final text supports no date", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };

    const result = await finishDraftAction(
      form({ intent: "decline", storyId, prose: "We had a dog named Biscuit who slept on the porch." }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.occurredKind).toBeNull();
    expect(story!.occurredDate).toBeNull();
    expect(story!.occurredProvenance).toBeNull();
  });

  it("NEVER overwrites a story date persisted during the interview", async () => {
    const personId = await makePerson(runtimeDb);
    const storyId = await seedDraftWithProse(personId, "seed text");
    authCtx = { kind: "account", personId };
    // Simulate the live path (#243): a date derived mid-interview, persisted before Finish.
    await applyResolvedStoryDate(runtimeDb, storyId, {
      kind: "date",
      date: "1943-12-25",
      endDate: null,
      provenance: "age 8 at Christmas, from birthdate",
    });

    // The posted prose WOULD resolve differently ("in 1962") — the backstop must not touch it.
    const result = await finishDraftAction(
      form({ intent: "decline", storyId, prose: "We drove to the coast in 1962 and it broke down." }),
    );

    expect(result).toEqual({ kind: "finished", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story!.occurredKind).toBe("date");
    expect(story!.occurredDate).toBe("1943-12-25");
    expect(story!.occurredProvenance).toBe("age 8 at Christmas, from birthdate");
  });
});
