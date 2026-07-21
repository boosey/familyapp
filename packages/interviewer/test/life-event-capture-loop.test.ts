/**
 * Life-event capture in the CONTROLLED LOOP (issue #245, ADR-0026). These tests prove:
 *   - a telling that STATES an anchor fact ("we married in 1958") produces TWO artifacts: the
 *     story's own date through the storyDateSink AND the reusable life event through the
 *     lifeEventSink — recorded on the narrator, never mirrored onto spouse or kin;
 *   - capture is conservative: an anchor used as a REFERENCE ("ten years after we married")
 *     records nothing;
 *   - the reuse loop closes at the loop seam: an event captured in one session anchors a LATER
 *     story's anchor-relative reference ("about ten years after we married" → circa);
 *   - the feature lands dark: no lifeEventSink, or no activeStoryId, captures nothing.
 *
 * The extractor itself is pure and exhaustively tested in @chronicle/core; idempotency is a
 * property of the core write side (tested over PGlite there). Here we assert loop behavior at
 * the session seam with in-memory anchors and in-memory sinks — no DB, no vendor.
 */
import { describe, expect, it } from "vitest";
import type { BiographicalProfile } from "@chronicle/db";
import type { LifeEventAnchor } from "@chronicle/core";
import {
  createInterviewSession,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryLifeEventSink,
  InMemoryMemorySource,
  InMemoryStoryDateSink,
  ScriptedVoice,
  type BiographicalAnchors,
  type InterviewerDeps,
} from "../src/index";
import { ScriptedLanguageModel } from "@chronicle/pipeline";

const NARRATOR = "narrator-1";
const STORY = "story-1";
const LATER_STORY = "story-2";
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

function makeDeps(anchors: BiographicalAnchors = datedAnchors()) {
  const askSource = new InMemoryAskSource();
  const memorySource = new InMemoryMemorySource();
  const anchorSource = new InMemoryAnchorSource();
  anchorSource.set(anchors);
  const languageModel = new ScriptedLanguageModel({ respond: "Tell me more about that." });
  const voice = new ScriptedVoice();
  const storyDateSink = new InMemoryStoryDateSink();
  const lifeEventSink = new InMemoryLifeEventSink();
  const deps: InterviewerDeps = {
    languageModel,
    voice,
    askSource,
    memorySource,
    anchorSource,
    storyDateSink,
    lifeEventSink,
  };
  return { deps, languageModel, storyDateSink, lifeEventSink, anchorSource };
}

async function tellSession(deps: InterviewerDeps, activeStoryId?: string) {
  return createInterviewSession(deps, {
    narratorPersonId: NARRATOR,
    ...(activeStoryId !== undefined ? { activeStoryId } : {}),
  });
}

describe("life-event capture in the interview loop", () => {
  it("a stated anchor fact produces TWO artifacts: the story's date AND the reusable event on the narrator", async () => {
    const { deps, storyDateSink, lifeEventSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We married in 1958, the happiest day of my life, and we danced until dawn at the VFW hall.",
    );

    // The reusable event, attached to the narrator who stated it (criterion: no mirroring).
    expect(lifeEventSink.recorded).toEqual([
      {
        personId: NARRATOR,
        event: {
          kind: "wedding",
          occurrence: {
            kind: "period",
            date: "1958-01-01",
            endDate: "1958-12-31",
            provenance: 'stated "married in 1958" in a telling',
          },
        },
      },
    ]);
    // And the story's own date resolves as before, through the unchanged derivation path.
    expect(storyDateSink.persisted).toEqual([
      {
        storyId: STORY,
        occurrence: {
          kind: "period",
          date: "1958-01-01",
          endDate: "1958-12-31",
          provenance: 'stated year "1958"',
        },
      },
    ]);
  });

  it("captures a 2-digit-year anchor fact even when the story's own date stays unresolvable", async () => {
    const { deps, storyDateSink, lifeEventSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    // The resolver's stated-year rule reads only 4-digit years, so the STORY stays undated —
    // but the reusable anchor is captured all the same (its whole point is later stories).
    await session.recordResponse("We married in '58, the year the old barn burned on the county road.");

    expect(lifeEventSink.recorded).toHaveLength(1);
    expect(lifeEventSink.recorded[0]!.event).toEqual({
      kind: "wedding",
      occurrence: {
        kind: "period",
        date: "1958-01-01",
        endDate: "1958-12-31",
        provenance: 'stated "married in \'58" in a telling',
      },
    });
    expect(storyDateSink.persisted).toHaveLength(0);
  });

  it("an anchor used as a REFERENCE records nothing — the stored event is what resolves", async () => {
    const { deps, storyDateSink, lifeEventSink } = makeDeps();
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We bought the farm about ten years after we married, and that first spring we planted the whole north field.",
    );

    expect(lifeEventSink.recorded).toHaveLength(0);
    // The story date resolves circa against the session's KNOWN wedding anchor (1955-04-02).
    expect(storyDateSink.persisted).toHaveLength(1);
    expect(storyDateSink.persisted[0]!.occurrence.kind).toBe("circa");
    expect(storyDateSink.persisted[0]!.occurrence.date).toBe("1965-04-02");
  });

  it("the reuse loop closes: an event captured in one session anchors a LATER story's relative reference", async () => {
    // Session A states the anchor fact → captured.
    const first = makeDeps();
    const sessionA = await tellSession(first.deps, STORY);
    await sessionA.nextTurn();
    await sessionA.recordResponse(
      "We married in 1958, the happiest day of my life, and we danced until dawn at the VFW hall.",
    );
    expect(first.lifeEventSink.recorded).toHaveLength(1);

    // Session B opens LATER: the anchors inflow now carries the stored event (mapped exactly as
    // listLifeEventsForPerson maps the row — kind + occurred date).
    const stored = first.lifeEventSink.recorded[0]!.event;
    const anchors = datedAnchors();
    anchors.lifeEvents = [{ kind: stored.kind, date: stored.occurrence.date }];
    const second = makeDeps(anchors);
    const sessionB = await tellSession(second.deps, LATER_STORY);

    await sessionB.nextTurn();
    await sessionB.recordResponse(
      "About ten years after we married, we bought the farm, and that first spring we planted the whole north field.",
    );

    // The relative reference resolves against the captured event — the narrator never repeated
    // the year — and NOTHING new is recorded (the reference states no new fact).
    expect(second.lifeEventSink.recorded).toHaveLength(0);
    expect(second.storyDateSink.persisted).toEqual([
      {
        storyId: LATER_STORY,
        occurrence: {
          kind: "circa",
          date: "1968-01-01",
          endDate: null,
          provenance: '"About ten years after we married", from the wedding life event',
        },
      },
    ]);
  });

  it("lands dark without a lifeEventSink: the story date still derives, nothing else happens", async () => {
    const { deps, storyDateSink } = makeDeps();
    delete deps.lifeEventSink;
    const session = await tellSession(deps, STORY);

    await session.nextTurn();
    await session.recordResponse(
      "We married in 1958, the happiest day of my life, and we danced until dawn at the VFW hall.",
    );

    expect(storyDateSink.persisted).toHaveLength(1);
    const turn = await session.nextTurn();
    expect(turn.intent).toBeDefined();
  });

  it("captures nothing without an activeStoryId, even when both sinks are configured", async () => {
    const { deps, storyDateSink, lifeEventSink } = makeDeps();
    const session = await tellSession(deps); // no activeStoryId

    await session.nextTurn();
    await session.recordResponse(
      "We married in 1958, the happiest day of my life, and we danced until dawn at the VFW hall.",
    );

    expect(lifeEventSink.recorded).toHaveLength(0);
    expect(storyDateSink.persisted).toHaveLength(0);
  });

  it("skips capture on a structured intake answer (not free narrative)", async () => {
    const emptyAnchors: BiographicalAnchors = {
      personId: NARRATOR,
      spokenName: "Eleanor",
      birthYear: 1935,
      birthDate: BIRTH_DATE,
      lifeEvents: [],
      profile: {
        hometown: null,
        siblingContext: null,
        currentLocation: null,
        occupationSummary: null,
        hasChildren: null,
        hasGrandchildren: null,
      },
    };
    const { deps, lifeEventSink } = makeDeps(emptyAnchors);
    const session = await tellSession(deps, STORY);

    const t0 = await session.nextTurn();
    expect(t0.intent.kind).toBe("intake");
    // A fact-stating answer to the intake question is NOT treated as the story's telling.
    await session.recordResponse("I was born in Duluth and we married in 1958 down at the courthouse.");
    expect(lifeEventSink.recorded).toHaveLength(0);
  });
});
