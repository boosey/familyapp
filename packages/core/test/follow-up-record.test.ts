import { createTestDatabase, type Database } from "@chronicle/db";
import type { FollowUpPolicy } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
} from "../src/follow-up-record";
import { persistRecordingAndCreateDraft } from "../src/story-repository";
import { makePerson } from "./helpers";

// A literal resolved policy — the DEFAULT + resolver live in @chronicle/interviewer, but importing
// that here would make core depend (in test) on a package that already depends on core (a cycle).
// The ledger only snapshots the policy as jsonb, so a plain object is a faithful stand-in.
const POLICY: FollowUpPolicy = {
  enabled: true,
  maxFollowUpsPerThread: 2,
  maxFollowUpsPerSession: 4,
  thinAnswerWordFloor: 8,
  confidenceThreshold: 0.6,
};

let db: Database;
let storyId: string;

beforeEach(async () => {
  db = await createTestDatabase();
  const narrator = await makePerson(db, "Eleanor");
  const { story } = await persistRecordingAndCreateDraft(db, {
    ownerPersonId: narrator.id,
    storageKey: "r2://chronicle/eleanor/take-0.webm",
    contentType: "audio/webm",
    checksum: "sha256:take0",
  });
  storyId = story.id;
});

describe("follow-up ledger (append-only, ADR-0013)", () => {
  it("tracks the unresolved decision until an outcome is appended", async () => {
    const { decisionId } = await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 0,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: "the summer at the lake",
      phrasedLine: "What do you remember about that summer?",
      policy: POLICY,
    });

    expect((await latestUnresolvedDecision(db, storyId))?.id).toBe(decisionId);

    await appendFollowUpOutcome(db, {
      storyId,
      decisionId,
      threadPosition: 0,
      outcome: "answered",
    });

    expect(await latestUnresolvedDecision(db, storyId)).toBeNull();

    const all = await listFollowUpDecisionsForStory(db, storyId);
    expect(all.map((r) => r.recordKind)).toEqual(["decision", "outcome"]);
  });

  it("a second decision after the first is resolved becomes the new unresolved one", async () => {
    const first = await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 0,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: "seed-1",
      phrasedLine: "line 1?",
      policy: POLICY,
    });
    await appendFollowUpOutcome(db, {
      storyId,
      decisionId: first.decisionId,
      threadPosition: 0,
      outcome: "answered",
    });
    // First is resolved → nothing unresolved yet.
    expect(await latestUnresolvedDecision(db, storyId)).toBeNull();

    const second = await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 1,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: "seed-2",
      phrasedLine: "line 2?",
      policy: POLICY,
    });

    // The new, unresolved decision is now the latest — not the older resolved one.
    expect((await latestUnresolvedDecision(db, storyId))?.id).toBe(second.decisionId);

    const kinds = (await listFollowUpDecisionsForStory(db, storyId)).map((r) => r.recordKind);
    expect(kinds).toEqual(["decision", "outcome", "decision"]);
  });

  it("ignores a null-seed 'none' decision — it was never an asked follow-up, so it is never unresolved", async () => {
    // Under the append model (ADR-0014 Inc 3) runFollowUpStep writes a null-seed decision when it
    // proposes NOTHING and the story STAYS draft. That row must NOT count as an "unresolved"
    // follow-up: attaching an answered/skipped outcome to it would pollute the ledger with an
    // outcome for a follow-up that was never asked.
    await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 0,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: null,
      phrasedLine: null,
      policy: POLICY,
    });

    expect(await latestUnresolvedDecision(db, storyId)).toBeNull();
  });

  it("returns the latest asked (selected) decision, skipping over a later null-seed 'none' decision", async () => {
    // A real asked follow-up (position 0) followed by a none-decision (position 1). The asked one is
    // still unresolved (no outcome yet); the newer null-seed row must be skipped, not returned.
    const asked = await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 0,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: "the summer at the lake",
      phrasedLine: "What do you remember about that summer?",
      policy: POLICY,
    });
    await appendFollowUpDecision(db, {
      storyId,
      threadPosition: 1,
      evaluatorModelId: "eval-model-v1",
      candidates: [],
      dispositions: [],
      selectedSeed: null,
      phrasedLine: null,
      policy: POLICY,
    });

    // The asked (selected) decision is the unresolved one — the later null-seed row is not eligible.
    expect((await latestUnresolvedDecision(db, storyId))?.id).toBe(asked.decisionId);
  });
});
