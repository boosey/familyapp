/**
 * Turn loop — the runnable wrapper that pulls all the seams together. Each call to `nextTurn`
 * composes ONE turn from the four inputs the spec names (base bank, pending Asks, session
 * memory, biographical anchors), asks the picker for the Intent, asks the LLM to phrase it,
 * and asks the Voice seam to synthesize speech. The caller (the narrator surface, or a test)
 * then plays the audio, captures the narrator's response, and feeds it back via `recordResponse`
 * before the next `nextTurn` call.
 *
 * The loop is INTENTIONALLY a function-per-turn, not a long-running goroutine. The narrator
 * surface (Phase 1: a thin web page) drives pacing; this module is the brain it consults.
 *
 * Follow-ups ride the shared cascade `proposeAndDisposeFollowUp` (ADR-0013 amendment): system
 * probes → gap detection → deepen. The ONE temporal dating follow-up is NOT an inline special
 * case any more — it is the deterministic `createTemporalFollowUpProbe`, wired only with the
 * session's live dating state (`dateUnresolved` / `alreadyAsked`). Story-date RESOLUTION is a
 * separate fact channel (`deriveAndPersistStoryDate`); it feeds the probe, it does not ask.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { BiographicalProfile, FollowUpPolicy, OccurredKind } from "@chronicle/db";
import { extractStatedLifeEvents, resolveStoryDate } from "@chronicle/core";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  FollowUpEvaluator,
  LifeEventSink,
  MemorySource,
  PriorStoryMemory,
  StoryDateSink,
  Voice,
  VoiceSpeakResult,
} from "./contracts";
import {
  createSessionState,
  ingestNarratorUtterance,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  recordTurnCompleted,
  type PromptIntent,
  type SessionState,
} from "./behavior";
import {
  GAP_DETECTION_MIN_ANSWER_WORDS,
  MEMORY_LOOKBACK_COUNT,
  RAPPORT_THRESHOLD_TURNS,
} from "./constants";
import { phraseIntent } from "./phraser";
import { extractIntakeAnswer } from "./intake-extraction";
import { INTAKE_QUESTIONS } from "./questions/intake";
import { resolveFollowUpPolicy } from "./follow-up-policy";
import { proposeAndDisposeFollowUp } from "./follow-up-cascade";
import { createTemporalFollowUpProbe } from "./temporal-follow-up-probe";
import type {
  SystemFollowUpProbe,
  SystemFollowUpProbeContext,
} from "./system-follow-up-probe";

export interface InterviewerDeps {
  languageModel: LanguageModel;
  voice: Voice;
  askSource: AskSource;
  memorySource: MemorySource;
  anchorSource: AnchorSource;
  /**
   * Optional gap-detection follow-up evaluator (issue #80 — cascade stage 2). When present,
   * `recordResponse` runs the shared cascade (system probes → gap → deepen) over the answer and
   * queues a winner for the next `follow_up` slot. Prod injects `createGapFollowUpEvaluator`; omit
   * it to run probe → deepen only (feature lands dark by default when no stage is wired).
   */
  followUpEvaluator?: FollowUpEvaluator;
  /**
   * Optional free-form deepen evaluator (cascade stage 3). The interview session typically omits
   * this — reflection still comes from `pickNextIntent` on a long utterance — but it is accepted
   * so the same cascade shape as the answer surface is available.
   */
  deepenFollowUpEvaluator?: FollowUpEvaluator;
  /**
   * Optional extra system probes (deterministic, no LLM). The temporal dating probe is added
   * automatically when live date derivation is active (`storyDateSink` + `activeStoryId`); it
   * stays dark until the session actually has an unresolved date.
   */
  systemFollowUpProbes?: ReadonlyArray<SystemFollowUpProbe>;
  /** Optional policy override for gap follow-ups; defaults to `resolveFollowUpPolicy({enabled:true})`. */
  followUpPolicy?: Partial<FollowUpPolicy>;
  /**
   * Optional persistence seam for live Story date derivation (issue #243). When present AND the
   * session was opened with `activeStoryId`, every non-intake response is run through the pure
   * `resolveStoryDate` (over the story text so far, against the anchors' birthDate + lifeEvents)
   * and a resolved occurrence is persisted with its provenance note. Omit either to keep the
   * session derivation-free (the feature lands dark by default, like the gap evaluator).
   */
  storyDateSink?: StoryDateSink;
  /**
   * Optional persistence seam for life-event capture (issue #245). When present AND live Story
   * date derivation is active (storyDateSink + activeStoryId — capture is a by-product of
   * story-date capture and rides the same gate), every non-intake response is run through the
   * pure `extractStatedLifeEvents`; a stated anchor fact ("we married in '58") is recorded on
   * the narrator, idempotently (person + kind + date) at the core write side. Later sessions
   * load the stored events with the anchors inflow, so anchor-relative references ("ten years
   * after we married") resolve without the narrator repeating themselves. Omit to keep the
   * session capture-free (the feature lands dark by default).
   */
  lifeEventSink?: LifeEventSink;
  /** Optional fixed voice id, so the persona is the same every session (a dignity requirement). */
  voiceId?: string;
}

/**
 * Precision rank of a Story date form (ADR-0026 precedence: date > period > circa). Live
 * derivation persists monotonically: a later take may REFINE the date (period → date) but never
 * downgrade it — the resolver never invents precision, so a less precise later resolution adds
 * nothing and is not persisted.
 */
const OCCURRENCE_PRECISION_RANK: Record<OccurredKind, number> = { circa: 1, period: 2, date: 3 };

export interface InterviewSessionOptions {
  narratorPersonId: string;
  /** When set, the session was opened via a notification deeplink for this specific Ask. */
  targetAskId?: string;
  /**
   * The draft Story this session's tellings are contributing to (issue #243). Required for live
   * date derivation: a resolved Story date is persisted against this id through the
   * `storyDateSink` seam. Omit for sessions that are not telling into a draft.
   */
  activeStoryId?: string;
}

export interface Turn {
  intent: PromptIntent;
  spokenText: string;
  audio: VoiceSpeakResult;
  /** Snapshot of state AFTER this turn — useful for tests and observability. */
  state: SessionState;
}

export interface InterviewSession {
  /** Compose, phrase, and synthesize the next turn. Returns null if the session is winding down
   * and there is nothing more to say (the loop ends cleanly). */
  nextTurn(): Promise<Turn>;
  /** Feed the narrator's response into the session state so the next turn can react. */
  recordResponse(utterance: string): Promise<void>;
  /** Direct read of the running state (tests & observability). */
  getState(): SessionState;
  /** Direct read of the memory snapshot loaded at start (tests & observability). */
  getPriorStories(): ReadonlyArray<PriorStoryMemory>;
  /** Direct read of the loaded biographical anchors. */
  getAnchors(): BiographicalAnchors | null;
}

/**
 * Create an interview session bound to one narrator. Loads memory + anchors ONCE up front; the
 * loop then picks/phrases/speaks per turn. The single up-front load keeps the session a stable
 * snapshot — a story approved mid-session does not perturb the picker until the next session.
 * That's a deliberate choice: behavior policy is auditable as "what the loop saw at start".
 */
export async function createInterviewSession(
  deps: InterviewerDeps,
  opts: InterviewSessionOptions,
): Promise<InterviewSession> {
  const state = createSessionState(opts.narratorPersonId);
  const [priorStories, anchors, pendingAsks] = await Promise.all([
    deps.memorySource.recentStoriesForNarrator(opts.narratorPersonId, MEMORY_LOOKBACK_COUNT),
    deps.anchorSource.loadForNarrator(opts.narratorPersonId),
    deps.askSource.pendingForNarrator(opts.narratorPersonId),
  ]);
  primeCoveredCategoriesFromPrior(state, priorStories);

  // Tracks the intake field the LAST served turn asked about, so the matching `recordResponse`
  // knows which extraction to run. Cleared after every response (intake or not).
  let pendingIntakeKey: keyof BiographicalProfile | null = null;

  // The question the last served turn actually spoke — the prompt context gap detection reads so it
  // knows what the narrator was answering. Null until the first turn is served.
  let lastSpokenText: string | null = null;

  // Live Story date derivation (issue #243): the story text so far, and the precision rank of the
  // best occurrence already persisted this session (0 = nothing persisted). Session-scoped like
  // `lastSpokenText` — the derivation snapshot resets with the session, same as the anchors.
  const tellingParts: string[] = [];
  let persistedDateRank = 0;
  // The temporal follow-up latch (issue #244): true once a temporal follow-up (from the system
  // probe OR a gap the LLM proposed) has been ASKED this session. The session is bound to one
  // activeStoryId, so this is the "at most one per story" guarantee — a skip or "I don't know" is
  // terminal, the question is never re-asked.
  let temporalFollowUpAsked = false;

  // Dating is active only when we can both persist (sink) and know which story (activeStoryId).
  const datingActive = !!(deps.storyDateSink && opts.activeStoryId);
  // The temporal dating probe is auto-added when dating is active; it stays N/A (returns null)
  // until the session actually reports an unresolved date via the probe context below.
  const systemProbes: SystemFollowUpProbe[] = [
    ...(deps.systemFollowUpProbes ?? []),
    ...(datingActive ? [createTemporalFollowUpProbe()] : []),
  ];

  async function nextTurn(): Promise<Turn> {
    const intent = pickNextIntent({ state, pendingAsks, priorStories, anchors, targetAskId: opts.targetAskId });
    if (intent.kind === "intake") pendingIntakeKey = intent.questionKey;
    const phrased = await phraseIntent(deps.languageModel, {
      intent,
      anchors,
      priorStories,
      isFirstSession: priorStories.length === 0,
    });
    const audio = await deps.voice.speak({
      text: phrased.spokenText,
      ...(deps.voiceId !== undefined ? { voiceId: deps.voiceId } : {}),
    });
    lastSpokenText = phrased.spokenText;
    recordTurnCompleted(state, intent);
    // Latch the temporal follow-up the moment it is ASKED (issue #244). Any temporal follow-up
    // counts — the deterministic system dating probe or one the LLM gap detector (#80) proposed —
    // because asking "when" twice for the same story is exactly the badgering the at-most-one rule
    // exists to prevent.
    if (
      intent.kind === "follow_up" &&
      (intent.origin === "gap" || intent.origin === "system") &&
      intent.gapKind === "temporal"
    ) {
      temporalFollowUpAsked = true;
    }
    // Close the relay's first half: notify the source that this Ask has been routed (queued
    // → routed). The DB adapter flips the row so the asker's hub view stops showing
    // `queued`; the in-memory mock no-ops. Best-effort — a failure here must NOT erase the
    // synthesized turn the narrator is about to hear, so we swallow and log to console.
    if (intent.kind === "ask") {
      try {
        await deps.askSource.markRouted(intent.askId);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("askSource.markRouted failed (ask=%s):", intent.askId, e);
      }
    }
    return { intent, spokenText: phrased.spokenText, audio, state };
  }

  async function recordResponse(utterance: string): Promise<void> {
    ingestNarratorUtterance(state, utterance);

    // Drop any follow-up left queued from a prior turn before we (maybe) queue a fresh one. If a
    // higher-priority intent (intake/ask) preempted the follow_up slot last turn, `recordTurnCompleted`
    // never cleared the queue — left alone it would resurface later, stale and out of context, on a
    // subsequent thin answer that skips detection. Clearing here bounds a queued follow-up to the
    // very next prompt (issue #80).
    state.pendingGapFollowUp = null;

    // Free-narrative path only (structured intake answers are not the story's telling): resolve the
    // story date FIRST so the cascade's temporal probe sees this turn's real dating state, then run
    // the propose cascade. Both are best-effort — a failure leaves reflection-only behavior.
    const key = pendingIntakeKey;
    if (key === null) {
      await deriveAndPersistStoryDate(utterance);
      await detectAndQueueGapFollowUp(utterance);
    }

    pendingIntakeKey = null;
    if (!key || state.distressed || state.offRampRequested) return;
    const question = INTAKE_QUESTIONS.find((q) => q.key === key);
    if (!question) return;
    try {
      const value = await extractIntakeAnswer(deps.languageModel, question, utterance);
      if (value !== null && value !== undefined) {
        await deps.anchorSource.writeProfileField(state.narratorPersonId, key, value as never);
      }
    } catch (e) {
      // Extraction is best-effort: a failure must not break the session. The field stays null and
      // the question is re-asked next session (askedIntakeKeys only guards within this session).
      // eslint-disable-next-line no-console
      console.warn("intake extraction failed (key=%s):", key, e);
    }
  }

  /**
   * The propose cascade step (ADR-0013 amendment): system probes → gap → deepen, disposed once
   * through `decideFollowUp`. Heavily gated:
   *   - nothing wired (no gap evaluator, no deepen evaluator, no system probes) → skip.
   *   - distress / off-ramp on this utterance                                   → skip (no spend).
   *   - answer below GAP_DETECTION_MIN_ANSWER_WORDS                             → skip (too thin).
   * The temporal dating probe fires only when the story is still unresolved and unasked; when a
   * date was just persisted this turn, `dateUnresolved` is false so the probe is N/A — and any
   * gap-proposed temporal candidate is dropped, closing the derive-vs-ask race (spec §4.5).
   * A selected winner is queued as `pendingGapFollowUp` with its origin + gapKind for the phraser.
   */
  async function detectAndQueueGapFollowUp(utterance: string): Promise<void> {
    const hasCascadeWork =
      !!deps.followUpEvaluator || !!deps.deepenFollowUpEvaluator || systemProbes.length > 0;
    if (!hasCascadeWork) return;
    if (state.distressed || state.offRampRequested) return;
    const answerWordCount = utterance.trim().split(/\s+/).filter(Boolean).length;
    if (answerWordCount < GAP_DETECTION_MIN_ANSWER_WORDS) return;

    const policy = resolveFollowUpPolicy({ enabled: true, ...deps.followUpPolicy });
    const rapportEstablished = state.turnCount >= RAPPORT_THRESHOLD_TURNS;
    const dateUnresolved = persistedDateRank === 0;
    const probeContext: SystemFollowUpProbeContext = {
      answerTranscript: utterance,
      ...(datingActive
        ? { dating: { dateUnresolved, alreadyAsked: temporalFollowUpAsked } }
        : {}),
    };

    try {
      const result = await proposeAndDisposeFollowUp({
        probes: systemProbes,
        probeContext,
        gapEvaluator: deps.followUpEvaluator,
        deepenEvaluator: deps.deepenFollowUpEvaluator,
        evaluationInput: {
          answerTranscript: utterance,
          promptText: lastSpokenText ?? "",
          alreadyAskedSeeds: state.askedGapSeeds,
          coveredCategories: [...state.coveredCategories],
          followUpsAskedInThread: state.gapFollowUpsAskedInSession,
          rapportEstablished,
        },
        decide: {
          policy,
          answerWordCount,
          // Phase 1 has no persisted per-thread concept for the interviewer loop's follow-ups, so
          // both cap args are fed the SAME session counter (the smaller of thread/session caps
          // binds). Deliberate — mirrors the answer-surface note in actions.ts.
          followUpsAskedInThread: state.gapFollowUpsAskedInSession,
          followUpsAskedInSession: state.gapFollowUpsAskedInSession,
          distressed: state.distressed,
          offRampRequested: state.offRampRequested,
          rapportEstablished,
          alreadyAskedSeeds: state.askedGapSeeds,
        },
      });
      if (!result.decision.selected) return;
      if (result.origin !== "system" && result.origin !== "gap") return;
      // Race fix (spec §4.5): if we already have a date, never ask "when" — drop a gap-proposed
      // temporal candidate for this turn (the system probe is already N/A via dateUnresolved).
      if (result.gapKind === "temporal" && !dateUnresolved) return;
      state.pendingGapFollowUp = {
        candidate: result.decision.selected,
        gapKind: result.gapKind ?? "identity",
        origin: result.origin,
      };
    } catch (e) {
      // Cascade is best-effort — a failure or timeout must never break the session.
      // eslint-disable-next-line no-console
      console.warn("follow-up cascade failed (narrator=%s):", state.narratorPersonId, e);
    }
  }

  /**
   * Live Story date derivation (issue #243, ADR-0026). Thin:
   *   - no sink configured, or no activeStoryId bound   → skip (derivation lands dark).
   *   - resolver returns unresolvable                    → persist nothing (the temporal probe in
   *                                                        the cascade will ask, at most once).
   *   - resolution no more precise than what's persisted → skip (never downgrade).
   * Otherwise the resolved occurrence is persisted with its provenance note through the sink.
   * The resolver is pure (no LLM, no clock, never throws), but the sink is I/O — so the whole
   * step is best-effort: a failure must never break the session.
   */
  async function deriveAndPersistStoryDate(utterance: string): Promise<void> {
    const sink = deps.storyDateSink;
    const storyId = opts.activeStoryId;
    if (!sink || !storyId) return;
    tellingParts.push(utterance);
    await captureStatedLifeEvents(utterance);
    try {
      const resolution = resolveStoryDate({
        text: tellingParts.join("\n"),
        birthDate: anchors?.birthDate ?? null,
        lifeEvents: anchors?.lifeEvents ?? [],
      });
      if (resolution.status !== "resolved") return;
      const rank = OCCURRENCE_PRECISION_RANK[resolution.occurrence.kind];
      if (rank <= persistedDateRank) return;
      await sink.persistResolvedStoryDate({ storyId, occurrence: resolution.occurrence });
      persistedDateRank = rank;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("story-date derivation failed (narrator=%s):", state.narratorPersonId, e);
    }
  }

  /**
   * Life-event capture (issue #245, ADR-0026): a telling that STATES an anchor fact ("we married
   * in '58") stores the reusable event on the narrator in addition to resolving the story's own
   * date. Runs per utterance, BEFORE the story-date resolution, on the same gate (capture is a
   * by-product of story-date capture) — but independently best-effort: a capture failure must
   * not cost the story's date. The extractor is pure; the events it returns are recorded
   * through the sink, which dedupes per person + kind + date at the core write side. The stored
   * event does NOT join THIS session's anchors (they are the stable snapshot loaded at start);
   * it anchors later stories' derivations from the next session on.
   */
  async function captureStatedLifeEvents(utterance: string): Promise<void> {
    const sink = deps.lifeEventSink;
    if (!sink) return;
    try {
      const events = extractStatedLifeEvents({
        text: utterance,
        birthDate: anchors?.birthDate ?? null,
      });
      for (const event of events) {
        await sink.recordStatedLifeEvent({ personId: state.narratorPersonId, event });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("life-event capture failed (narrator=%s):", state.narratorPersonId, e);
    }
  }

  return {
    nextTurn,
    recordResponse,
    getState: () => state,
    getPriorStories: () => priorStories,
    getAnchors: () => anchors,
  };
}
