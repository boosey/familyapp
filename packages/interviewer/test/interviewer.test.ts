import type { BiographicalProfile } from "@chronicle/db";
import { createTestDatabase } from "@chronicle/db";
import { sql } from "drizzle-orm";
import { createCoreAnchorSource } from "../src/core-adapters";
import { ScriptedLanguageModel } from "@chronicle/pipeline";
import { nextIntakeQuestion, INTAKE_QUESTIONS } from "../src/questions/intake";
import { extractIntakeAnswer } from "../src/intake-extraction";
import { describe, expect, it } from "vitest";
import {
  createInterviewSession,
  createSessionState,
  detectDistress,
  detectOffRamp,
  ingestNarratorUtterance,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryMemorySource,
  phraseIntent,
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

const NARRATOR = "narrator-1";

const EMPTY_PROFILE: BiographicalProfile = {
  hometown: null,
  siblingContext: null,
  currentLocation: null,
  occupationSummary: null,
  hasChildren: null,
  hasGrandchildren: null,
};

function makeAnchors(): BiographicalAnchors {
  return {
    personId: NARRATOR,
    spokenName: "Eleanor",
    birthYear: 1942,
    profile: { ...EMPTY_PROFILE, hometown: "Iowa" },
  };
}

function anchorsWith(profile: Partial<BiographicalProfile> = {}): BiographicalAnchors {
  return {
    personId: "p1",
    spokenName: "Eleanor",
    birthYear: 1943,
    profile: { ...EMPTY_PROFILE, ...profile },
  };
}
const PRIOR: PriorStoryMemory[] = [
  { storyId: "s1", title: "The farm", summary: "A farm", tags: [], promptQuestion: null, createdAt: new Date() },
];

// Anchors with a fully-populated profile, so the picker has no intake field left to collect and
// falls through to pending Asks / the base bank — used by ask-routing tests.
const COMPLETE_ANCHORS: BiographicalAnchors = {
  personId: NARRATOR,
  spokenName: "Eleanor",
  birthYear: 1942,
  profile: { hometown: "Iowa", siblingContext: "Oldest of three", currentLocation: "Des Moines", occupationSummary: "Schoolteacher", hasChildren: false, hasGrandchildren: null },
};

function makeDeps(opts: {
  asks?: PendingAsk[];
  stories?: PriorStoryMemory[];
  anchors?: BiographicalAnchors | null;
  llmRespond?: string;
}) {
  const askSource = new InMemoryAskSource();
  if (opts.asks) askSource.setAsks(NARRATOR, opts.asks);
  const memorySource = new InMemoryMemorySource();
  if (opts.stories) memorySource.setStories(NARRATOR, opts.stories);
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
    const s = createSessionState(NARRATOR);
    ingestNarratorUtterance(s, "let's skip that");
    expect(s.offRampRequested).toBe(true);
    expect(s.distressed).toBe(false);
    ingestNarratorUtterance(s, "I can't talk about it");
    expect(s.distressed).toBe(true);
  });
});

describe("behavior — picker priority order (spec)", () => {
  it("returns wind_down(distress, surfaceHumanSupport=true) when the narrator signals distress", () => {
    const state = createSessionState(NARRATOR);
    state.distressed = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).reason).toBe("distress");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).surfaceHumanSupport).toBe(
      true,
    );
  });

  it("wind_down (off-ramp) does NOT surface human support — that is reserved for distress", () => {
    const state = createSessionState(NARRATOR);
    state.offRampRequested = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).surfaceHumanSupport).toBe(
      false,
    );
  });

  it("opens with a warm callback on turn 0 IF prior stories exist", () => {
    const state = createSessionState(NARRATOR);
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
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories, anchors: null });
    expect(intent.kind).toBe("callback");
    expect((intent as Extract<PromptIntent, { kind: "callback" }>).priorStoryId).toBe("s1");
  });

  it("does NOT open with a callback if there are no prior stories", () => {
    const state = createSessionState(NARRATOR);
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("base");
  });

  it("prioritizes pending Asks over the base bank (after turn 0)", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 1; // not a callback turn
    const asks: PendingAsk[] = [
      { askId: "a1", askerName: "Sofia", questionText: "What was your wedding day like?" },
    ];
    const intent = pickNextIntent({ state, pendingAsks: asks, priorStories: [], anchors: null });
    expect(intent.kind).toBe("ask");
    expect((intent as Extract<PromptIntent, { kind: "ask" }>).askerName).toBe("Sofia");
  });

  it("Asks are sorted by priority, descending — high-priority asker first", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 1;
    const asks: PendingAsk[] = [
      { askId: "low", askerName: "X", questionText: "q-low", priority: 1 },
      { askId: "high", askerName: "Y", questionText: "q-high", priority: 100 },
      { askId: "mid", askerName: "Z", questionText: "q-mid", priority: 50 },
    ];
    const intent = pickNextIntent({ state, pendingAsks: asks, priorStories: [], anchors: null });
    expect((intent as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("high");
  });

  it("emits a follow_up when the narrator's last utterance is substantial", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 2;
    state.lastNarratorUtterance =
      "Well, my father worked at the railway for forty years, and every evening he'd come home and tell us a story about the men he'd met.";
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("follow_up");
  });

  it("a follow_up is consumed — does not re-fire on the SAME utterance the next turn", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 2;
    state.lastNarratorUtterance =
      "Well, my father worked at the railway for forty years, and every evening he'd come home and tell us stories.";
    const i1 = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(i1.kind).toBe("follow_up");
    recordTurnCompleted(state, i1);
    // No new utterance — the picker must NOT re-emit follow_up. It falls back to the base bank.
    const i2 = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(i2.kind).toBe("base");
  });

  it("does NOT follow_up on a tiny utterance ('yes', 'maybe')", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 2;
    state.lastNarratorUtterance = "Yes, that's right.";
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("base");
  });
});

describe("behavior — gentle sequencing: high-sensitivity is rapport-gated", () => {
  it(`refuses to pick high-sensitivity questions before ${RAPPORT_THRESHOLD_TURNS} turns`, () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = RAPPORT_THRESHOLD_TURNS - 1;
    // Pre-exhaust every non-high question by category, forcing the picker to consider only high.
    for (const q of QUESTION_BANK) {
      if (q.sensitivity !== "high") {
        state.coveredCategories.add(q.category);
      }
    }
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    // No eligible question survives → wind_down(fatigue), NOT a high-sensitivity pick.
    expect(intent.kind).toBe("wind_down");
    expect((intent as Extract<PromptIntent, { kind: "wind_down" }>).reason).toBe("fatigue");
  });

  it("allows high-sensitivity after rapport, but never if distress was detected", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = RAPPORT_THRESHOLD_TURNS + 2;
    state.distressed = true;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    // Distress is checked FIRST → wind_down, never high-sensitivity.
    expect(intent.kind).toBe("wind_down");
  });
});

describe("behavior — reminiscence-bump weighting", () => {
  it("prefers childhood / young_adult phases when picking from the base bank", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 1;
    const intent = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent.kind).toBe("base");
    const q = (intent as Extract<PromptIntent, { kind: "base" }>).question;
    expect(REMINISCENCE_BUMP_PHASES.has(q.lifePhase)).toBe(true);
  });
});

describe("behavior — de-duplication", () => {
  it("does not re-ask a question once asked", () => {
    const state = createSessionState(NARRATOR);
    state.turnCount = 1;
    const intent1 = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    expect(intent1.kind).toBe("base");
    const q1 = (intent1 as Extract<PromptIntent, { kind: "base" }>).question;
    recordTurnCompleted(state, intent1);
    const intent2 = pickNextIntent({ state, pendingAsks: [], priorStories: [], anchors: null });
    const q2 = (intent2 as Extract<PromptIntent, { kind: "base" }>).question;
    expect(q2.id).not.toBe(q1.id);
    expect(q2.category).not.toBe(q1.category);
  });

  it("seeds covered categories from prior stories' tags (cross-session dedup)", () => {
    const state = createSessionState(NARRATOR);
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
    const state = createSessionState(NARRATOR);
    state.turnCount = 1;
    const asks: PendingAsk[] = [
      { askId: "a1", askerName: "Sofia", questionText: "...", priority: 10 },
      { askId: "a2", askerName: "Tom", questionText: "...", priority: 5 },
    ];
    const i1 = pickNextIntent({ state, pendingAsks: asks, priorStories: [], anchors: null });
    expect((i1 as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("a1");
    recordTurnCompleted(state, i1);
    const i2 = pickNextIntent({ state, pendingAsks: asks, priorStories: [], anchors: null });
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
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("callback");
    // LLM was asked once; Voice TTS was asked once with the LLM's spoken text.
    expect(deps.languageModel.calls.length).toBe(1);
    expect(deps.voice.calls.length).toBe(1);
    expect(deps.voice.calls[0]!.text).toBe(turn.spokenText);
    // Phraser context block included the narrator's name and the prior summary in the LLM prompt.
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
    const deps = makeDeps({ asks, anchors: COMPLETE_ANCHORS, llmRespond: "Sofia was wondering what Grandpa was like…" });
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    // No prior stories and a complete profile (no intake left) ⇒ goes straight to ask.
    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("ask");
    const llmUserMsg = deps.languageModel.calls[0]!.messages.find((m) => m.role === "user")!
      .content;
    expect(llmUserMsg).toContain("Sofia");
    expect(llmUserMsg).toContain("What was Grandpa like when he was young?");
  });

  it("recording an off-ramp response makes the NEXT turn a wind_down", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    await session.nextTurn(); // base question
    await session.recordResponse("let's skip that, please");
    const next = await session.nextTurn();
    expect(next.intent.kind).toBe("wind_down");
  });

  it("the LLM system prompt encodes the spec's absolute behavior rules", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
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
      { narratorPersonId: NARRATOR },
    );
    await session.nextTurn();
    await session.nextTurn();
    expect(deps.voice.calls.length).toBe(2);
    expect(deps.voice.calls[0]!.voiceId).toBe("warm-voice-7");
    expect(deps.voice.calls[1]!.voiceId).toBe("warm-voice-7");
  });

  it("after an `ask` turn, the turn loop calls AskSource.markRouted to close the relay's first half", async () => {
    const asks: PendingAsk[] = [
      {
        askId: "a-routed",
        askerName: "Sofia",
        questionText: "Tell me about your wedding.",
      },
    ];
    const deps = makeDeps({ asks, anchors: COMPLETE_ANCHORS });
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    const t = await session.nextTurn();
    expect(t.intent.kind).toBe("ask");
    // The in-memory AskSource records which askIds have been routed.
    expect(deps.askSource.routed).toEqual(["a-routed"]);
  });

  it("does NOT call markRouted on non-`ask` turns (base/follow_up/callback/wind_down)", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    await session.nextTurn(); // base
    expect(deps.askSource.routed).toEqual([]);
  });

  it("the biographical anchors block flags hints as 'do not state as fact'", async () => {
    const deps = makeDeps({});
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });
    await session.nextTurn();
    const llmUserMsg = deps.languageModel.calls[0]!.messages.find((m) => m.role === "user")!
      .content;
    expect(llmUserMsg).toMatch(/hints only/i);
    expect(llmUserMsg).toContain("Eleanor");
    expect(llmUserMsg).toContain("1942");
    expect(llmUserMsg).toContain("Iowa"); // from biographicalAnchors jsonb
  });
});

describe("BiographicalAnchors — typed profile", () => {
  it("InMemoryAnchorSource returns typed profile fields", async () => {
    const source = new InMemoryAnchorSource();
    source.set({
      personId: "p1",
      spokenName: "Eleanor",
      birthYear: 1943,
      profile: { ...EMPTY_PROFILE, hometown: "New Orleans", hasChildren: true },
    });
    const anchors = await source.loadForNarrator("p1");
    expect(anchors?.profile.hometown).toBe("New Orleans");
    expect(anchors?.profile.hasChildren).toBe(true);
    expect(anchors?.profile.siblingContext).toBeNull();
  });

  it("writeProfileField updates one field without overwriting others", async () => {
    const source = new InMemoryAnchorSource();
    source.set({
      personId: "p1",
      spokenName: "Eleanor",
      birthYear: 1943,
      profile: { ...EMPTY_PROFILE, hometown: "New Orleans" },
    });
    await source.writeProfileField("p1", "siblingContext", "Youngest of three");
    const updated = await source.loadForNarrator("p1");
    expect(updated?.profile.siblingContext).toBe("Youngest of three");
    expect(updated?.profile.hometown).toBe("New Orleans");
  });

  it("writeProfileField on unknown personId is a safe no-op", async () => {
    const source = new InMemoryAnchorSource();
    await expect(source.writeProfileField("nobody", "hometown", "Paris")).resolves.toBeUndefined();
  });
});

describe("Intake question bank", () => {
  it("returns first question when profile is empty", () => {
    expect(nextIntakeQuestion(EMPTY_PROFILE, new Set())?.key).toBe("hometown");
  });
  it("skips already-asked keys", () => {
    expect(nextIntakeQuestion(EMPTY_PROFILE, new Set(["hometown"]))?.key).toBe("siblingContext");
  });
  it("skips populated fields", () => {
    expect(nextIntakeQuestion({ ...EMPTY_PROFILE, hometown: "NOLA" }, new Set())?.key).toBe("siblingContext");
  });
  it("asks the children question when only children fields remain", () => {
    const p = { ...EMPTY_PROFILE, hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: null };
    expect(nextIntakeQuestion(p, new Set())?.key).toBe("hasChildren");
  });
  it("skips hasGrandchildren once children asked but inference was null", () => {
    const p = { ...EMPTY_PROFILE, hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: null };
    expect(nextIntakeQuestion(p, new Set(["hasChildren"]))).toBeNull();
  });
  it("asks hasGrandchildren when hasChildren is true", () => {
    const p = { ...EMPTY_PROFILE, hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: true };
    expect(nextIntakeQuestion(p, new Set())?.key).toBe("hasGrandchildren");
  });
  it("returns null when all applicable fields populated (no children)", () => {
    const p: BiographicalProfile = { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null };
    expect(nextIntakeQuestion(p, new Set())).toBeNull();
  });
  it("no INTAKE question uses yes/no framing", () => {
    for (const q of INTAKE_QUESTIONS) {
      expect(q.text.toLowerCase()).not.toMatch(/^(do|did|are|is|have|has|were|was) you/);
    }
  });
});

describe("Picker — intake priority", () => {
  it("returns intake when profile has nulls and no deeplink/callback", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [], anchors: anchorsWith() });
    expect(i.kind).toBe("intake");
    expect((i as Extract<PromptIntent, { kind: "intake" }>).questionKey).toBe("hometown");
  });
  it("callback beats intake on turn 0 with prior stories", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: PRIOR, anchors: anchorsWith() });
    expect(i.kind).toBe("callback");
  });
  it("intake resumes from next null field", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [],
      anchors: anchorsWith({ hometown: "NOLA", siblingContext: "Only child" }) });
    expect((i as Extract<PromptIntent, { kind: "intake" }>).questionKey).toBe("currentLocation");
  });
  it("askedIntakeKeys skips a key already asked this session", () => {
    const s = createSessionState("p1"); s.askedIntakeKeys.add("hometown");
    const i = pickNextIntent({ state: s, pendingAsks: [], priorStories: [], anchors: anchorsWith() });
    expect((i as Extract<PromptIntent, { kind: "intake" }>).questionKey).toBe("siblingContext");
  });
  it("falls to pending asks once intake complete", () => {
    const full = { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null };
    const i = pickNextIntent({ state: createSessionState("p1"),
      pendingAsks: [{ askId: "a1", askerName: "Sofia", questionText: "Music?" }], priorStories: [], anchors: anchorsWith(full) });
    expect(i.kind).toBe("ask");
  });
  it("with null anchors, intake is skipped (falls to base bank)", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [], anchors: null });
    expect(i.kind).toBe("base");
  });
});

describe("Picker — deeplink ask", () => {
  it("serves deeplink ask first, before callback and intake", () => {
    const s = createSessionState("p1");
    const i = pickNextIntent({ state: s,
      pendingAsks: [{ askId: "dl", askerName: "Marcus", questionText: "How'd you meet Dad?" }],
      priorStories: PRIOR, anchors: anchorsWith(), targetAskId: "dl" });
    expect(i.kind).toBe("ask");
    expect((i as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("dl");
  });
  it("does not re-serve a consumed deeplink ask", () => {
    const s = createSessionState("p1"); s.consumedAskIds.add("dl");
    const i = pickNextIntent({ state: s,
      pendingAsks: [{ askId: "dl", askerName: "Marcus", questionText: "?" }],
      priorStories: [], anchors: anchorsWith(), targetAskId: "dl" });
    expect(i.kind).toBe("intake");
  });
  it("unknown deeplink id falls through to normal priority", () => {
    const i = pickNextIntent({ state: createSessionState("p1"), pendingAsks: [], priorStories: [],
      anchors: anchorsWith(), targetAskId: "missing" });
    expect(i.kind).toBe("intake");
  });
});

describe("Phraser — intake + opener", () => {
  const intakeIntent = { kind: "intake" as const, questionKey: "hometown" as const, questionText: "Tell me about where you grew up.", extractionHint: "h" };
  function userMsg(llm: ScriptedLanguageModel): string {
    return llm.calls[0]?.messages.find((m) => m.role === "user")?.content ?? "";
  }
  it("intake intent puts INTAKE QUESTION + field in the LLM prompt", async () => {
    const llm = new ScriptedLanguageModel({ respond: "Where did you grow up?" });
    await phraseIntent(llm, { intent: intakeIntent, anchors: anchorsWith(), priorStories: [], isFirstSession: false });
    expect(userMsg(llm)).toContain("INTAKE QUESTION");
    expect(userMsg(llm)).toContain("hometown");
  });
  it("first session prepends the welcome opener for an intake turn", async () => {
    const llm = new ScriptedLanguageModel({ respond: "Hi." });
    await phraseIntent(llm, { intent: intakeIntent, anchors: anchorsWith(), priorStories: [], isFirstSession: true });
    expect(userMsg(llm)).toContain("FIRST SESSION");
  });
  it("returning session (isFirstSession false) does NOT prepend the opener", async () => {
    const llm = new ScriptedLanguageModel({ respond: "Welcome back." });
    await phraseIntent(llm, { intent: intakeIntent, anchors: anchorsWith(), priorStories: [], isFirstSession: false });
    expect(userMsg(llm)).not.toContain("FIRST SESSION");
  });
  it("does NOT prepend the opener on a non-intake first turn", async () => {
    const llm = new ScriptedLanguageModel({ respond: "..." });
    const base = { kind: "base" as const, question: QUESTION_BANK[0]! };
    await phraseIntent(llm, { intent: base, anchors: anchorsWith(), priorStories: [], isFirstSession: true });
    expect(userMsg(llm)).not.toContain("FIRST SESSION");
  });
  it("renders named profile fields in the context block", async () => {
    const llm = new ScriptedLanguageModel({ respond: "ok" });
    await phraseIntent(llm, { intent: intakeIntent, anchors: anchorsWith({ hometown: "New Orleans", occupationSummary: "Teacher for 30 years" }), priorStories: [], isFirstSession: false });
    expect(userMsg(llm)).toContain("New Orleans");
    expect(userMsg(llm)).toContain("Teacher for 30 years");
  });
});

describe("recordTurnCompleted — intake", () => {
  it("adds questionKey to askedIntakeKeys and increments turnCount", () => {
    const s = createSessionState("p1");
    recordTurnCompleted(s, { kind: "intake", questionKey: "hometown", questionText: "?", extractionHint: "h" });
    expect(s.askedIntakeKeys.has("hometown")).toBe(true);
    expect(s.turnCount).toBe(1);
  });
});

describe("extractIntakeAnswer", () => {
  const hometownQ = INTAKE_QUESTIONS.find((q) => q.key === "hometown")!;
  const childrenQ = INTAKE_QUESTIONS.find((q) => q.key === "hasChildren")!;

  it("extracts a string field", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ value: "New Orleans" }) });
    const v = await extractIntakeAnswer(llm, hometownQ, "Oh, I grew up in New Orleans.");
    expect(v).toBe("New Orleans");
  });
  it("infers a boolean field", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ value: true }) });
    const v = await extractIntakeAnswer(llm, childrenQ, "Yes, three of them.");
    expect(v).toBe(true);
  });
  it("returns null when the model returns null", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ value: null }) });
    expect(await extractIntakeAnswer(llm, hometownQ, "I'd rather not say.")).toBeNull();
  });
  it("returns null on unparseable output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "not json" });
    expect(await extractIntakeAnswer(llm, hometownQ, "...")).toBeNull();
  });
});

describe("Turn loop — deeplink + intake extraction", () => {
  function freshAnchors() {
    const a = new InMemoryAnchorSource();
    a.set({ personId: "p1", spokenName: "Eleanor", birthYear: 1943, profile: EMPTY_PROFILE });
    return a;
  }
  it("serves deeplink ask on turn 0 even with prior stories", async () => {
    const memory = new InMemoryMemorySource(); memory.setStories("p1", PRIOR);
    const asks = new InMemoryAskSource(); asks.setAsks("p1", [{ askId: "dl", askerName: "Marcus", questionText: "?", priority: 1 }]);
    const s = await createInterviewSession(
      { languageModel: new ScriptedLanguageModel({ respond: "Marcus asked..." }),
        voice: new ScriptedVoice(), askSource: asks, memorySource: memory, anchorSource: freshAnchors() },
      { narratorPersonId: "p1", targetAskId: "dl" });
    const t = await s.nextTurn();
    expect(t.intent.kind).toBe("ask");
    expect((t.intent as Extract<PromptIntent, { kind: "ask" }>).askId).toBe("dl");
  });

  it("after an intake turn, recordResponse extracts + writes the field", async () => {
    const anchors = freshAnchors();
    // respond is a FUNCTION: the extractor call's user message contains "EXTRACTION INSTRUCTION"
    // (return the JSON value); every other call is the phraser (return the question text).
    const llm = new ScriptedLanguageModel({ respond: (req) => {
      const user = req.messages.find((m) => m.role === "user")?.content ?? "";
      return user.includes("EXTRACTION INSTRUCTION")
        ? JSON.stringify({ value: "New Orleans" })
        : "Tell me about where you grew up.";
    }});
    const s = await createInterviewSession(
      { languageModel: llm, voice: new ScriptedVoice(), askSource: new InMemoryAskSource(),
        memorySource: new InMemoryMemorySource(), anchorSource: anchors },
      { narratorPersonId: "p1" });
    const t = await s.nextTurn();
    expect(t.intent.kind).toBe("intake");
    await s.recordResponse("Oh, I grew up in New Orleans.");
    const updated = await anchors.loadForNarrator("p1");
    expect(updated?.profile.hometown).toBe("New Orleans");
  });

  it("recordResponse after a non-intake turn does not invoke the extractor", async () => {
    const anchors = new InMemoryAnchorSource();
    anchors.set({ personId: "p1", spokenName: "Eleanor", birthYear: 1943,
      profile: { hometown: "a", siblingContext: "b", currentLocation: "c", occupationSummary: "d", hasChildren: false, hasGrandchildren: null } });
    const llm = new ScriptedLanguageModel({ respond: "Tell me about a childhood meal." });
    const s = await createInterviewSession(
      { languageModel: llm, voice: new ScriptedVoice(), askSource: new InMemoryAskSource(),
        memorySource: new InMemoryMemorySource(), anchorSource: anchors },
      { narratorPersonId: "p1" });
    await s.nextTurn();
    expect(llm.calls.length).toBe(1);          // only the phraser call
    await s.recordResponse("It was wonderful.");
    expect(llm.calls.length).toBe(1);          // extractor was NOT invoked
  });
});

describe("CoreAnchorSource — writeProfileField", () => {
  it("writes fields to biographical_anchors without overwriting others", async () => {
    const db = await createTestDatabase();
    const personId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO persons (id, display_name, spoken_name, birth_year)
      VALUES (${personId}, ${"Eleanor R."}, ${"Eleanor"}, ${1942})`);
    const source = createCoreAnchorSource(db);

    await source.writeProfileField(personId, "hometown", "New Orleans");
    await source.writeProfileField(personId, "hasChildren", true);

    const anchors = await source.loadForNarrator(personId);
    // both sequential single-field writes persist (the JSONB merge does not clobber)
    expect(anchors?.profile.hometown).toBe("New Orleans");
    expect(anchors?.profile.hasChildren).toBe(true);
    // unset fields map to null (JSONB → typed profile)
    expect(anchors?.profile.siblingContext).toBeNull();
    expect(anchors?.spokenName).toBe("Eleanor");
    expect(anchors?.birthYear).toBe(1942);
  });
});
