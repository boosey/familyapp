/**
 * Live Story date derivation in the CONTROLLED LOOP (issue #243, ADR-0026). These tests prove:
 *   - the session context carries the narrator's birthdate + life events via the anchors inflow;
 *   - a telling that self-dates (stated / age+holiday / anchor-relative) is PERSISTED as dated,
 *     with its provenance note, through the storyDateSink seam — no question is asked;
 *   - an unresolvable telling persists nothing and provokes nothing (the temporal follow-up is a
 *     later ticket);
 *   - persistence is monotonic in precision (date > period > circa): later takes may refine,
 *     never downgrade.
 *
 * The resolver itself is pure and exhaustively tested in @chronicle/core; here we assert loop
 * behavior at the session seam with in-memory anchors and an in-memory sink — no DB, no vendor.
 */
import { describe, expect, it } from "vitest";
import type { BiographicalProfile } from "@chronicle/db";
import type { LifeEventAnchor } from "@chronicle/core";
import {
  createInterviewSession,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryMemorySource,
  InMemoryStoryDateSink,
  ScriptedVoice,
  type BiographicalAnchors,
  type InterviewerDeps,
} from "../src/index";
import { ScriptedLanguageModel } from "@chronicle/pipeline";

const NARRATOR = "narrator-1";
const STORY = "story-1";
/** Born June 15, 1935 — mirrors the resolver's own test anchor (turns 8 in 1943). */
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

describe("live Story date derivation in the interview loop", () => {
  it("persists a stated exact date with its provenance — no question asked", async () => {
    const { deps, languageModel, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1943, my first Christmas away from home, and the whole house was quiet that morning.",
    );

    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]).toEqual({
      storyId: STORY,
      occurrence: {
        kind: "date",
        date: "1943-12-25",
        endDate: null,
        provenance: 'stated date "December 25, 1943"',
      },
    });
    // Derivation is pure — it spent NO LLM call (only the phraser's one) and asked nothing.
    expect(languageModel.calls).toHaveLength(1);
  });

  it("resolves an age+holiday reference against the anchors' birthDate", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "When I was 8, for Christmas, I got a red bicycle and rode it around the block all afternoon.",
    );

    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence).toEqual({
      kind: "date",
      date: "1943-12-25",
      endDate: null,
      provenance: "age 8 at Christmas, from birthdate",
    });
  });

  it("resolves an anchor-relative reference against the anchors' life events", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We bought the farm about ten years after we married, and that first spring we planted the whole north field.",
    );

    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence).toEqual({
      kind: "circa",
      date: "1965-04-02",
      endDate: null,
      provenance: '"about ten years after we married", from the wedding life event',
    });
  });

  it("an unresolvable telling persists nothing and provokes no question", async () => {
    const { deps, languageModel, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We had a dog named Biscuit who rode in the truck with us everywhere and slept at the foot of my bed.",
    );

    expect(storyDateSink.persisted).toHaveLength(0);
    // No derivation LLM call, no follow-up machinery: the loop serves its normal next turn.
    expect(languageModel.calls).toHaveLength(1);
    const turn = await session.nextTurn();
    expect(turn.intent).toBeDefined();
  });

  it("persists nothing without a sink (derivation lands dark), and the session is unaffected", async () => {
    const { deps } = makeDeps();
    delete deps.storyDateSink;
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1943, my first Christmas away from home, and the whole house was quiet that morning.",
    );
    const turn = await session.nextTurn();
    expect(turn.intent).toBeDefined();
  });

  it("persists nothing without an activeStoryId, even when a sink is configured", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps); // no activeStoryId

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1943, my first Christmas away from home, and the whole house was quiet that morning.",
    );
    expect(storyDateSink.persisted).toHaveLength(0);
  });

  it("a later take may REFINE the date (period → date) over the story text so far", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "When I was in high school I worked at the five and dime after classes every day.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence.kind).toBe("period");
    expect(storyDateSink.persisted[0]!.occurrence.date).toBe("1949-09-01");
    expect(storyDateSink.persisted[0]!.occurrence.endDate).toBe("1953-06-30");

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1951, the Christmas rush, when the register drawer finally broke.",
    );
    expect(storyDateSink.persisted).toHaveLength(2);
    expect(storyDateSink.persisted[1]!.occurrence.kind).toBe("date");
    expect(storyDateSink.persisted[1]!.occurrence.date).toBe("1951-12-25");
  });

  it("never DOWNGRADES: a vaguer later take does not overwrite a persisted exact date", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "It was December 25, 1943, my first Christmas away from home, and the whole house was quiet that morning.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);

    await session.nextTurn();
    // Period language joins the text-so-far, but the stated date already in it still wins — the
    // re-resolution is the same rank, so nothing is persisted again.
    await session.recordResponse(
      "When I was in high school, that was the winter the pipe burst in the kitchen.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence.kind).toBe("date");
  });

  it("skips derivation on a structured intake answer (not free narrative)", async () => {
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
    const { deps, storyDateSink } = makeDeps(emptyAnchors);
    const session = await tellSession(deps, STORY);

    const t0 = await session.nextTurn();
    expect(t0.intent.kind).toBe("intake");
    // A self-dating answer to the intake question is NOT treated as the story's telling.
    await session.recordResponse(
      "I was born in Duluth and we left in December of 1943 when my father took the railroad job.",
    );
    expect(storyDateSink.persisted).toHaveLength(0);
  });
});
