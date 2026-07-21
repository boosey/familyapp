/**
 * Live Story date derivation in the CONTROLLED LOOP (issue #243, ADR-0026, tiered-hybrid). These
 * tests prove:
 *   - the session context carries the narrator's birthdate + life events via the anchors inflow;
 *   - a telling that states the CALENDAR (full date / month+year / year / explicit decade) is
 *     PERSISTED live via Tier A, with its provenance note, through the storyDateSink seam — no
 *     question is asked;
 *   - SOFT temporal language (bare age, age+holiday, anchor-relative, life-stage) is deliberately
 *     NOT auto-persisted on the live path — it stays Undated here and flows to the single temporal
 *     ask / the finish-time backstop (which owns the LLM recognizer). This is the ADR-0026 fix:
 *     no confidently-wrong guess lands silently on the Timeline;
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

  it("persists a stated month+year as a month-long period", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "That was December 1943, right before the cold snap, and the whole house smelled of woodsmoke.",
    );

    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence).toEqual({
      kind: "period",
      date: "1943-12-01",
      endDate: "1943-12-31",
      provenance: 'stated "December 1943"',
    });
  });

  it("does NOT auto-persist a soft age+holiday reference on the live path (Tier A only)", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "When I was 8, for Christmas, I got a red bicycle and rode it around the block all afternoon.",
    );

    // Soft language stays Undated live — the guessy age+holiday math is gone from Tier A. It is the
    // temporal ask / finish-time backstop that gets to interpret this, not a silent regex.
    expect(storyDateSink.persisted).toHaveLength(0);
  });

  it("does NOT auto-persist a soft anchor-relative reference on the live path (Tier A only)", async () => {
    const { deps, storyDateSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We bought the farm about ten years after we married, and that first spring we planted the whole north field.",
    );

    expect(storyDateSink.persisted).toHaveLength(0);
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
      "We opened the shop in 1951 and I worked at the counter after classes every day.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence.kind).toBe("period");
    expect(storyDateSink.persisted[0]!.occurrence.date).toBe("1951-01-01");
    expect(storyDateSink.persisted[0]!.occurrence.endDate).toBe("1951-12-31");

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
    // A vaguer STATED year joins the text-so-far, but the stated full date already in it still wins
    // — the re-resolution is the same (date) rank, so nothing is persisted again.
    await session.recordResponse(
      "The next year, 1944, was the winter the pipe burst in the kitchen.",
    );
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence.kind).toBe("date");
    expect(storyDateSink.persisted[0]!.occurrence.date).toBe("1943-12-25");
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
