/**
 * The temporal follow-up in the CONTROLLED LOOP (issue #244, ADR-0026). When a telling carries no
 * derivable Story date, the interviewer asks — ONCE — "about when was that", phrased to accept a
 * year or a rough period and never demanding an exact date. These tests prove:
 *   - an unresolvable telling queues exactly one temporal follow-up candidate, disposed through
 *     the UNCHANGED `decideFollowUp` gates (no parallel policy path);
 *   - the phrasing prompt for that turn explicitly welcomes a fuzzy answer and forbids pressing
 *     for an exact date;
 *   - a usable answer resolves through the #242 resolver and persists with its provenance;
 *   - skip / "I don't know" leaves the story undated and is TERMINAL — never re-asked, even across
 *     many further unresolvable responses;
 *   - the feature lands dark without the story-date seams, and never overrides an already-queued
 *     gap follow-up.
 *
 * All seams are in-memory/scripted — no DB, no vendor. The evaluator is only present in the test
 * that proves the proposal does not override an LLM-detected gap.
 */
import { describe, expect, it } from "vitest";
import type { BiographicalProfile, FollowUpCandidate } from "@chronicle/db";
import type { LifeEventAnchor } from "@chronicle/core";
import {
  createInterviewSession,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryMemorySource,
  InMemoryStoryDateSink,
  ScriptedFollowUpEvaluator,
  ScriptedVoice,
  type BiographicalAnchors,
  type InterviewerDeps,
  type PromptIntent,
} from "../src/index";
import { ScriptedLanguageModel } from "@chronicle/pipeline";

const NARRATOR = "narrator-1";
const STORY = "story-1";
/** Born June 15, 1935 — mirrors the resolver's own test anchor. */
const BIRTH_DATE = "1935-06-15";
const WEDDING_1955: LifeEventAnchor = { kind: "wedding", date: "1955-04-02" };

const COMPLETE_PROFILE: BiographicalProfile = {
  hometown: "Iowa",
  siblingContext: "Oldest of three",
  currentLocation: "Des Moines",
  occupationSummary: "Schoolteacher",
  hasChildren: false,
  hasGrandchildren: false,
};

// Fully-populated profile (no intake slot pre-empts the telling), carrying the date-derivation
// anchors: the full birth date plus a known wedding life event.
function datedAnchors(): BiographicalAnchors {
  return {
    personId: NARRATOR,
    spokenName: "Eleanor",
    birthYear: 1935,
    birthDate: BIRTH_DATE,
    lifeEvents: [WEDDING_1955],
    profile: { ...COMPLETE_PROFILE },
  };
}

/** A long, warm telling with NO derivable date (known-unresolvable against these anchors). */
const UNDATABLE_TELLING =
  "We had a dog named Biscuit who rode in the truck with us everywhere and slept at the foot of my bed.";
const ANOTHER_UNDATABLE_TELLING =
  "She made the best bread on the whole street and everybody knew the smell of it on a Saturday morning.";

function makeDeps(anchors: BiographicalAnchors = datedAnchors()) {
  const askSource = new InMemoryAskSource();
  const memorySource = new InMemoryMemorySource();
  const anchorSource = new InMemoryAnchorSource();
  anchorSource.set(anchors);
  const languageModel = new ScriptedLanguageModel({ respond: "Tell me more about that." });
  const voice = new ScriptedVoice();
  const storyDateSink = new InMemoryStoryDateSink();
  const deps: InterviewerDeps = { languageModel, voice, askSource, memorySource, anchorSource, storyDateSink };
  return { deps, languageModel, storyDateSink };
}

async function tellSession(deps: InterviewerDeps, activeStoryId?: string) {
  return createInterviewSession(deps, {
    narratorPersonId: NARRATOR,
    ...(activeStoryId !== undefined ? { activeStoryId } : {}),
  });
}

function isTemporalGapFollowUp(intent: PromptIntent): boolean {
  return intent.kind === "follow_up" && intent.origin === "gap" && intent.gapKind === "temporal";
}

describe("the temporal follow-up in the interview loop (issue #244)", () => {
  it("queues ONE temporal follow-up candidate when the telling carries no derivable date", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);

    // Nothing persisted (nothing derivable) — but the ONE temporal candidate is queued.
    expect(storyDateSink.persisted).toHaveLength(0);
    const queued = session.getState().pendingGapFollowUp;
    expect(queued?.candidate.type).toBe("temporal");
    expect(queued?.candidate.threadSeed).toBe("about when this happened");
    expect(queued?.gapKind).toBe("temporal");

    // …and it surfaces as the NEXT question, riding the normal follow_up slot.
    const turn = await session.nextTurn();
    expect(isTemporalGapFollowUp(turn.intent)).toBe(true);
    // Consumed: recorded against the anti-repeat seeds and the session cap, queue cleared.
    expect(session.getState().pendingGapFollowUp).toBeNull();
    expect(session.getState().askedGapSeeds).toContain("about when this happened");
    expect(session.getState().gapFollowUpsAskedInSession).toBe(1);
  });

  it("phrases the question to welcome a fuzzy answer — never pressuring for an exact date", async () => {
    const { deps, languageModel } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    await session.nextTurn(); // the temporal follow-up turn — calls[1] is its phrasing request

    const phrasing = languageModel.calls[1]!;
    const userPrompt = phrasing.messages.find((m) => m.role === "user")!.content;
    expect(userPrompt).toContain("about when this happened");
    // The ADR-0026 wording discipline is handed to the phraser explicitly.
    expect(userPrompt).toContain("A year, or even a rough period, is");
    expect(userPrompt).toContain("NEVER ask for, or imply you need, an exact date.");
  });

  it("a usable answer resolves through the resolver and persists with its provenance", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    await session.nextTurn(); // asks "about when was that"
    await session.recordResponse("Oh, I think it was 1952, the year after we got the television.");

    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]).toEqual({
      storyId: STORY,
      occurrence: {
        kind: "period",
        date: "1952-01-01",
        endDate: "1952-12-31",
        provenance: 'stated year "1952"',
      },
    });
  });

  it('"I don\'t know" is terminal: the story stays undated and the question is never re-asked', async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    const followUp = await session.nextTurn();
    expect(isTemporalGapFollowUp(followUp.intent)).toBe(true);

    // The narrator doesn't know — nothing resolves, nothing persists, nothing re-queues.
    await session.recordResponse("I don't know, I really couldn't tell you.");
    expect(storyDateSink.persisted).toHaveLength(0);
    expect(session.getState().pendingGapFollowUp).toBeNull();

    // The session continues normally, and even LONG unresolvable answers never re-ask it.
    const seen: PromptIntent[] = [];
    for (let i = 0; i < 3; i++) {
      const turn = await session.nextTurn();
      seen.push(turn.intent);
      await session.recordResponse(ANOTHER_UNDATABLE_TELLING);
    }
    expect(seen.filter(isTemporalGapFollowUp)).toHaveLength(0);
    expect(storyDateSink.persisted).toHaveLength(0);
  });

  it("asks at most one across the whole session, however many undatable tellings arrive", async () => {
    const { deps } = makeDeps();
    const session = await tellSession(deps, STORY);

    let temporalFollowUps = 0;
    for (let i = 0; i < 4; i++) {
      const turn = await session.nextTurn();
      if (isTemporalGapFollowUp(turn.intent)) temporalFollowUps += 1;
      await session.recordResponse(i % 2 === 0 ? UNDATABLE_TELLING : ANOTHER_UNDATABLE_TELLING);
    }
    expect(temporalFollowUps).toBe(1);
  });

  it("a skip off-ramp winds the session down with the story still undated", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    await session.nextTurn(); // asks "about when was that"
    await session.recordResponse("Let's skip that, I'd rather keep talking about the dog.");

    expect(storyDateSink.persisted).toHaveLength(0);
    expect(session.getState().offRampRequested).toBe(true);
    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("wind_down");
  });

  it("rides the dispose gates unchanged: a zero session cap vetoes the follow-up", async () => {
    const { deps } = makeDeps();
    deps.followUpPolicy = { maxFollowUpsPerSession: 0 };
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("does not override a gap follow-up the LLM evaluator already queued this response", async () => {
    const relational: FollowUpCandidate = {
      threadSeed: "who else rode in the truck",
      type: "relational",
      sensitivity: "low",
      confidence: 0.9,
      narratorOpened: false,
    };
    const { deps } = makeDeps();
    deps.followUpEvaluator = new ScriptedFollowUpEvaluator([[relational]]);
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);

    // The evaluator's candidate keeps the slot; the temporal proposal yields this response.
    expect(session.getState().pendingGapFollowUp?.candidate.type).toBe("relational");
  });

  it("a self-dating telling never provokes the follow-up", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1943, my first Christmas away from home, and the whole house was quiet that morning.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("lands dark without a sink: an undatable telling provokes no question", async () => {
    const { deps } = makeDeps();
    delete deps.storyDateSink;
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("lands dark without an activeStoryId, even when a sink is configured", async () => {
    const { deps } = makeDeps();
    const session = await tellSession(deps); // no activeStoryId

    await session.nextTurn();
    await session.recordResponse(UNDATABLE_TELLING);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("a structured intake answer never provokes the follow-up", async () => {
    const emptyAnchors: BiographicalAnchors = {
      personId: NARRATOR,
      spokenName: "Eleanor",
      birthYear: 1935,
      birthDate: BIRTH_DATE,
      lifeEvents: [WEDDING_1955],
      profile: {
        hometown: null,
        siblingContext: null,
        currentLocation: null,
        occupationSummary: null,
        hasChildren: null,
        hasGrandchildren: null,
      },
    };
    const { deps } = makeDeps(emptyAnchors);
    const session = await tellSession(deps, STORY);

    const t0 = await session.nextTurn();
    expect(t0.intent.kind).toBe("intake");
    await session.recordResponse(UNDATABLE_TELLING);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });
});
