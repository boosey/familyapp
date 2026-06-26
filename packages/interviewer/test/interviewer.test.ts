import { ScriptedLanguageModel } from "@chronicle/pipeline";
import { describe, expect, it } from "vitest";
import {
  createInterviewSession,
  createSessionState,
  detectDistress,
  detectOffRamp,
  ingestElderUtterance,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryMemorySource,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  QUESTION_BANK,
  RAPPORT_THRESHOLD_TURNS,
  recordTurnCompleted,
  REMINISCENCE_BUMP_PHASES,
  ScriptedVoice,
  type BiographicalAnchors,
  type PendingAsk,
  type PriorStoryMemory,
  type PromptIntent,
} from "../src/index";

const ELDER = "elder-1";

function makeAnchors(): BiographicalAnchors {
  return {
    personId: ELDER,
    spokenName: "Eleanor",
    birthYear: 1942,
    anchors: { birthplace: "Iowa" },
  };
}

function makeDeps(opts: {
  asks?: PendingAsk[];
  stories?: PriorStoryMemory[];
  anchors?: BiographicalAnchors | null;
  llmRespond?: string;
}) {
  const askSource = new InMemoryAskSource();
  if (opts.asks) askSource.setAsks(ELDER, opts.asks);
  const memorySource = new InMemoryMemorySource();
  if (opts.stories) memorySource.setStories(ELDER, opts.stories);
  const anchorSource = new InMemoryAnchorSource();
  if (opts.anchors !== null) anchorSource.set(opts.anchors ?? makeAnchors());
  const languageModel = new ScriptedLanguageModel({
    respond: opts.llmRespond ?? "Tell me about your childhood home.",
  });
  const voice = new ScriptedVoice();
  return { askSource, memorySource, anchorSource, languageModel, voice };
}

describe("behavior — distress / off-ramp detection", () => {
  it("detects an off-ramp from common spoken phrases", () => {
    expect(detectOffRamp("let's skip that, please")).toBe(true);
    expect(detectOffRamp("Change the subject")).toBe(true);
    expect(detectOffRamp("I'm tired now")).toBe(true);
    expect(detectOffRamp("Tell me more")).toBe(false);
  });

  it("detects distress from common spoken phrases", () => {
    expect(detectDistress("I can't talk about that")).toBe(true);
    expect(detectDistress("This is too painful")).toBe(true);
    expect(detectDistress("That was a long time ago")).toBe(false);
  });

  it("ingesting an utterance flips state flags", () => {
    const s = createSessionState(ELDER);
    ingestElderUtterance(s, "let's skip that");
    expect(s.offRampRequested).toBe(true);
    expect(s.distressed).toBe(false);
    ingestElderUtterance(s, "I can't talk about it");
    expect(s.distressed).toBe(true);
  });
});

describe("behavior — picker priority order (spec)", () => {
  it("returns wind_down(distress, surfaceHumanSupport=true) when the elder signals distress", () => {
    const state = createSessionState(ELDER);
    state.distressed = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).reason).toBe("distress");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).surfaceHumanSupport).toBe(
      true,
    );
  });

  it("wind_down (off-ramp) does NOT surface human support — that is reserved for distress", () => {
    const state = createSessionState(ELDER);
    state.offRampRequested = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).surfaceHumanSupport).toBe(
      false,
    );
  });

  it("opens with a warm callback on turn 0 IF prior stories exist", () => {
    const state = createSessionState(ELDER);
    const priorStories: PriorStoryMemory[] = [
      {
        storyId: "s1",
        title: "The Iowa farm",
        summary: "Eleanor's childhood on a farm.",
        tags: [],
        promptQuestion: null,
        createdAt: new Date("2024-01-01"),
      },
    ];
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories });
    expect(intent.kind).toBe("callback");
    expect((intent as Extract<PromptIntent, { kind: "callback" }>).priorStoryId).toBe("s1");
  });

  it("does NOT open with a callback if there are no prior stories", () => {
    const state = createSessionState(ELDER);
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("base");
  });

  it("prioritizes pending Asks over the base bank (after turn 0)", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 1; // not a callback turn
    const asks: PendingAsk[] = [
      { askId: "a1", askerName: "Sofia", questionText: "What was your wedding day like?" },
    ];
    const intent = pickNextIntent({ state, pendingAsks: asks, priorStories: [] });
    expect(intent.kind).toBe("ask");
    expect((intent as Extract<PromptIntent, { kind: "ask" }>).askerName).toBe("Sofia");
  });

  it("Asks are sorted by priority, descending — high-priority asker first", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 1;
    const asks: PendingAsk[] = [
      { askId: "low", askerName: "X", questionText: "q-low", priority: 1 },
      { askId: "high", askerName: "Y", questionText: "q-high", priority: 100 },
      { askId: "mid", askerName: "Z", questionText: "q-mid", priority: 50 },
    ];
    const intent = pickNextIntent({ state, pendingAsks: asks, priorStories: [] });
    expect((intent as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("high");
  });

  it("emits a follow_up when the elder's last utterance is substantial", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 2;
    state.lastElderUtterance =
      "Well, my father worked at the railway for forty years, and every evening he'd come home and tell us a story about the men he'd met.";
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("follow_up");
  });

  it("a follow_up is consumed — does not re-fire on the SAME utterance the next turn", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 2;
    state.lastElderUtterance =
      "Well, my father worked at the railway for forty years, and every evening he'd come home and tell us stories.";
    const i1 = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(i1.kind).toBe("follow_up");
    recordTurnCompleted(state, i1);
    // No new utterance — the picker must NOT re-emit follow_up. It falls back to the base bank.
    const i2 = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(i2.kind).toBe("base");
  });

  it("does NOT follow_up on a tiny utterance ('yes', 'maybe')", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 2;
    state.lastElderUtterance = "Yes, that's right.";
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("base");
  });
});

describe("behavior — gentle sequencing: high-sensitivity is rapport-gated", () => {
  it(`refuses to pick high-sensitivity questions before ${RAPPORT_THRESHOLD_TURNS} turns`, () => {
    const state = createSessionState(ELDER);
    state.turnCount = RAPPORT_THRESHOLD_TURNS - 1;
    // Pre-exhaust every non-high question by category, forcing the picker to consider only high.
    for (const q of QUESTION_BANK) {
      if (q.sensitivity !== "high") {
        state.coveredCategories.add(q.category);
      }
    }
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    // No eligible question survives → wind_down(fatigue), NOT a high-sensitivity pick.
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).reason).toBe("fatigue");
  });

  it("allows high-sensitivity after rapport, but never if distress was detected", () => {
    const state = createSessionState(ELDER);
    state.turnCount = RAPPORT_THRESHOLD_TURNS + 2;
    state.distressed = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    // Distress is checked FIRST → wind_down, never high-sensitivity.
    expect(intent.kind).toBe("wind_down");
  });
});

describe("behavior — reminiscence-bump weighting", () => {
  it("prefers childhood / young_adult phases when picking from the base bank", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 1;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent.kind).toBe("base");
    const q = (intent as Extract<PromptIntent, { kind: "base" }>).question;
    expect(REMINISCENCE_BUMP_PHASES.has(q.lifePhase)).toBe(true);
  });
});

describe("behavior — de-duplication", () => {
  it("does not re-ask a question once asked", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 1;
    const intent1 = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    expect(intent1.kind).toBe("base");
    const q1 = (intent1 as Extract<PromptIntent, { kind: "base" }>).question;
    recordTurnCompleted(state, intent1);
    const intent2 = pickNextIntent({ state, pendingAsks: [], priorStories: [] });
    const q2 = (intent2 as Extract<PromptIntent, { kind: "base" }>).question;
    expect(q2.id).not.toBe(q1.id);
    expect(q2.category).not.toBe(q1.category);
  });

  it("seeds covered categories from prior stories' tags (cross-session dedup)", () => {
    const state = createSessionState(ELDER);
    const priorStories: PriorStoryMemory[] = [
      {
        storyId: "s1",
        title: "School friends",
        summary: "",
        tags: ["education", "childhood"],
        promptQuestion: null,
        createdAt: new Date(),
      },
    ];
    primeCoveredCategoriesFromPrior(state, priorStories);
    expect(state.coveredCategories.has("education")).toBe(true);
    expect(state.coveredCategories.has("childhood")).toBe(true);
  });

  it("does not re-issue the same Ask twice in one session", () => {
    const state = createSessionState(ELDER);
    state.turnCount = 1;
    const asks: PendingAsk[] = [
      { askId: "a1", askerName: "Sofia", questionText: "...", priority: 10 },
      { askId: "a2", askerName: "Tom", questionText: "...", priority: 5 },
    ];
    const i1 = pickNextIntent({ state, pendingAsks: asks, priorStories: [] });
    expect((i1 as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("a1");
    recordTurnCompleted(state, i1);
    const i2 = pickNextIntent({ state, pendingAsks: asks, priorStories: [] });
    expect((i2 as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("a2");
  });
});

describe("turn loop — composes turn from all four inputs", () => {
  it("first turn opens with a warm callback when prior stories exist", async () => {
    const priorStories: PriorStoryMemory[] = [
      {
        storyId: "s1",
        title: "The Iowa farm",
        summary: "She grew up on a farm and milked cows at dawn.",
        tags: ["childhood", "farm"],
        promptQuestion: null,
        createdAt: new Date(),
      },
    ];
    const deps = makeDeps({
      stories: priorStories,
      llmRespond: "Last time you started telling me about the farm — shall we pick up there?",
    });
    const session = await createInterviewSession(deps, { elderPersonId: ELDER });
    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("callback");
    // LLM was asked once; Voice TTS was asked once with the LLM's spoken text.
    expect(deps.languageModel.calls.length).toBe(1);
    expect(deps.voice.calls.length).toBe(1);
    expect(deps.voice.calls[0]!.text).toBe(turn.spokenText);
    // Phraser context block included the elder's name and the prior summary in the LLM prompt.
    const llmUserMsg = deps.languageModel.calls[0]!.messages.find((m) => m.role === "user")!
      .content;
    expect(llmUserMsg).toContain("Eleanor");
    expect(llmUserMsg).toContain("The Iowa farm");
    expect(llmUserMsg).toContain("milked cows at dawn");
  });

  it("Asks are framed with the asker's name in the LLM prompt", async () => {
    const asks: PendingAsk[] = [
      {
        askId: "a1",
        askerName: "Sofia",
        questionText: "What was Grandpa like when he was young?",
        priority: 10,
      },
    ];
    const deps = makeDeps({ asks, llmRespond: "Sofia was wondering what Grandpa was like…" });
    const session = await createInterviewSession(deps, { elderPersonId: ELDER });
    // Burn turn 0 by forcing it past callback (no prior stories ⇒ goes straight to ask).
    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("ask");
    const llmUserMsg = deps.languageModel.calls[0]!.messages.find((m) => m.role === "user")!
      .content;
    expect(llmUserMsg).toContain("Sofia");
    expect(llmUserMsg).toContain("What was Grandpa like when he was young?");
  });

  it("recording an off-ramp response makes the NEXT turn a wind_down", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { elderPersonId: ELDER });
    await session.nextTurn(); // base question
    session.recordResponse("let's skip that, please");
    const next = await session.nextTurn();
    expect(next.intent.kind).toBe("wind_down");
  });

  it("the LLM system prompt encodes the spec's absolute behavior rules", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { elderPersonId: ELDER });
    await session.nextTurn();
    const systemMsg = deps.languageModel.calls[0]!.messages.find(
      (m) => m.role === "system",
    )!.content;
    expect(systemMsg).toMatch(/one thing at a time/i);
    expect(systemMsg).toMatch(/open-ended/i);
    expect(systemMsg).toMatch(/non-leading/i);
    expect(systemMsg).toMatch(/never invent facts/i);
    expect(systemMsg).toMatch(/never\s+push/i);
  });

  it("the SAME voice id is used every turn (persona consistency is a dignity requirement)", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(
      { ...deps, voiceId: "warm-voice-7" },
      { elderPersonId: ELDER },
    );
    await session.nextTurn();
    await session.nextTurn();
    expect(deps.voice.calls.length).toBe(2);
    expect(deps.voice.calls[0]!.voiceId).toBe("warm-voice-7");
    expect(deps.voice.calls[1]!.voiceId).toBe("warm-voice-7");
  });

  it("the biographical anchors block flags hints as 'do not state as fact'", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { elderPersonId: ELDER });
    await session.nextTurn();
    const llmUserMsg = deps.languageModel.calls[0]!.messages.find((m) => m.role === "user")!
      .content;
    expect(llmUserMsg).toMatch(/hints only/i);
    expect(llmUserMsg).toContain("Eleanor");
    expect(llmUserMsg).toContain("1942");
    expect(llmUserMsg).toContain("Iowa"); // from biographicalAnchors jsonb
  });
});
