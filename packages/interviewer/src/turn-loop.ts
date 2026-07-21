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
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type {
  BiographicalProfile,
  FollowUpCandidate,
  FollowUpPolicy,
  FollowUpType,
  OccurredKind,
} from "@chronicle/db";
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
  decideFollowUp,
  ingestNarratorUtterance,
  pickNextIntent,
  primeCoveredCategoriesFromPrior,
  recordTurnCompleted,
  type PromptIntent,
  type SessionState,
} from "./behavior";
import {
  GAP_DETECTION_MIN_ANSWER_WORDS,
  GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
  MEMORY_LOOKBACK_COUNT,
  RAPPORT_THRESHOLD_TURNS,
} from "./constants";
import { phraseIntent } from "./phraser";
import { extractIntakeAnswer } from "./intake-extraction";
import { INTAKE_QUESTIONS } from "./questions/intake";
import { resolveFollowUpPolicy } from "./follow-up-policy";
import type { GapKind } from "./gap-detection";

export interface InterviewerDeps {
  languageModel: LanguageModel;
  voice: Voice;
  askSource: AskSource;
  memorySource: MemorySource;
  anchorSource: AnchorSource;
  /**
   * Optional gap-driven follow-up evaluator (issue #80). When present, `recordResponse` runs a thin
   * gap-detection pass over the narrator's answer, disposes the candidates through `decideFollowUp`
   * (so every behavior gate applies), and queues the winner for the next `follow_up` slot. Prod
   * injects `createGapFollowUpEvaluator(languageModel)`; omit it to keep the loop's original
   * reflection-only follow-up behavior (feature lands dark by default).
   */
  followUpEvaluator?: FollowUpEvaluator;
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
 * Best-effort reverse map FollowUpType → GapKind, used ONLY to give the phraser a phrasing angle for
 * a queued gap follow-up. The forward map (gap-detection.ts) is many-to-one — spatial/causal/identity
 * all become `factual` — so this reverse is lossy by construction. That is acceptable: `gapKind` is a
 * hint the phraser uses to shade an OPEN question, never a fact it asserts, and the threadSeed carries
 * the real content. `factual` reverses to `identity` (the most neutral "what/which" angle).
 */
const FOLLOW_UP_TYPE_TO_GAP_KIND: Record<FollowUpType, GapKind> = {
  temporal: "temporal",
  relational: "relational",
  factual: "identity",
  sensory: "identity",
  emotional: "identity",
};

/**
 * Precision rank of a Story date form (ADR-0026 precedence: date > period > circa). Live
 * derivation persists monotonically: a later take may REFINE the date (period → date) but never
 * downgrade it — the resolver never invents precision, so a less precise later resolution adds
 * nothing and is not persisted.
 */
const OCCURRENCE_PRECISION_RANK: Record<OccurredKind, number> = { circa: 1, period: 2, date: 3 };

/**
 * The thread seed of the ONE temporal follow-up the loop may ask for a story whose telling carries
 * no derivable date (issue #244, ADR-0026). Constant on purpose: once asked, the seed lands in
 * `askedGapSeeds`, so the existing anti-repeat gate vetoes any re-proposal as a duplicate — the
 * at-most-once guarantee rides the SAME dispose gates as every other follow-up, with the loop's
 * own latch (`temporalFollowUpAsked`) as the primary, explicit enforcement.
 */
const STORY_DATE_FOLLOW_UP_SEED = "about when this happened";

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
  // The temporal follow-up latch (issue #244): true once a temporal gap follow-up has been ASKED
  // this session. The session is bound to one activeStoryId, so this is the "at most one per
  // story" guarantee — a skip or "I don't know" is terminal, the question is never re-asked.
  let temporalFollowUpAsked = false;

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
    // Latch the temporal follow-up the moment it is ASKED (issue #244). Any temporal gap follow-up
    // counts — including one the LLM gap detector (#80) proposed — because asking "when" twice for
    // the same story is exactly the badgering the at-most-one rule exists to prevent.
    if (intent.kind === "follow_up" && intent.origin === "gap" && intent.gapKind === "temporal") {
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

    // Drop any gap follow-up left queued from a prior turn before we (maybe) queue a fresh one. If a
    // higher-priority intent (intake/ask) preempted the follow_up slot last turn, `recordTurnCompleted`
    // never cleared the queue — left alone it would resurface later, stale and out of context, on a
    // subsequent thin answer that skips detection. Clearing here bounds a queued gap to the very next
    // prompt (issue #80).
    state.pendingGapFollowUp = null;

    // Gap-driven follow-up detection (issue #80). Runs BEFORE intake extraction so a gap follow-up
    // can be queued for the next turn. Deliberately after `ingestNarratorUtterance` so distress /
    // off-ramp flags are already set and can short-circuit detection. Best-effort: any failure
    // leaves the loop in its reflection-only behavior — a broken detector never blocks the session.
    // Skipped for structured intake answers: the field-extraction questions (hometown, occupation…)
    // are not free narrative, and any gap they'd surface is preempted by the remaining intake queue —
    // so we don't spend an LLM call on them.
    const key = pendingIntakeKey;
    if (key === null) {
      await detectAndQueueGapFollowUp(utterance);
      await deriveAndPersistStoryDate(utterance);
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
   * The gap-detection → dispose → queue step. Thin and heavily gated:
   *   - no evaluator configured                         → skip (reflection-only mode).
   *   - distress / off-ramp on this utterance           → skip (a gap NEVER pushes into pain; the
   *                                                        picker would wind_down anyway, but we
   *                                                        also refuse to SPEND an LLM call).
   *   - answer below GAP_DETECTION_MIN_ANSWER_WORDS      → skip (too thin to have real gaps).
   * Then `decideFollowUp` applies the remaining gates (rapport, anti-repeat, confidence, caps,
   * per-candidate vetoes). A selected candidate is queued as `pendingGapFollowUp`; nothing selected
   * leaves the queue empty and the loop reflects/asks as before.
   */
  async function detectAndQueueGapFollowUp(utterance: string): Promise<void> {
    const evaluator = deps.followUpEvaluator;
    if (!evaluator) return;
    if (state.distressed || state.offRampRequested) return;
    const answerWordCount = utterance.trim().split(/\s+/).filter(Boolean).length;
    if (answerWordCount < GAP_DETECTION_MIN_ANSWER_WORDS) return;

    const policy = resolveFollowUpPolicy({ enabled: true, ...deps.followUpPolicy });
    try {
      const evaluation = await evaluator.evaluate({
        answerTranscript: utterance,
        // What the narrator was answering. Empty string is fine — the detector reads the answer.
        promptText: lastSpokenText ?? "",
        alreadyAskedSeeds: state.askedGapSeeds,
        coveredCategories: [...state.coveredCategories],
        followUpsAskedInThread: state.gapFollowUpsAskedInSession,
        rapportEstablished: state.turnCount >= RAPPORT_THRESHOLD_TURNS,
      });
      const decision = decideFollowUp({
        evaluation,
        policy,
        answerWordCount,
        // Phase 1 has no persisted per-thread concept for the interviewer loop's gap follow-ups, so
        // both cap args are fed the SAME session counter. Effect: whichever of maxFollowUpsPerThread
        // / maxFollowUpsPerSession is smaller binds (with defaults 2/4, the thread cap binds). This
        // collapse is deliberate — mirrors the answer-surface's inert-session-cap note in actions.ts.
        followUpsAskedInThread: state.gapFollowUpsAskedInSession,
        followUpsAskedInSession: state.gapFollowUpsAskedInSession,
        distressed: state.distressed,
        offRampRequested: state.offRampRequested,
        rapportEstablished: state.turnCount >= RAPPORT_THRESHOLD_TURNS,
        alreadyAskedSeeds: state.askedGapSeeds,
      });
      if (decision.selected) {
        state.pendingGapFollowUp = {
          candidate: decision.selected,
          gapKind: FOLLOW_UP_TYPE_TO_GAP_KIND[decision.selected.type],
        };
      }
    } catch (e) {
      // Gap detection is best-effort — a failure or timeout must never break the session.
      // eslint-disable-next-line no-console
      console.warn("gap-detection follow-up failed (narrator=%s):", state.narratorPersonId, e);
    }
  }

  /**
   * Live Story date derivation (issue #243, ADR-0026). Thin:
   *   - no sink configured, or no activeStoryId bound      → skip (derivation lands dark).
   *   - resolver returns unresolvable                       → persist nothing; instead propose the
   *                                                           ONE temporal follow-up (issue #244).
   *   - resolution no more precise than what's persisted    → skip (never downgrade).
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
      if (resolution.status !== "resolved") {
        proposeTemporalFollowUp(utterance);
        return;
      }
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

  /**
   * The temporal follow-up (issue #244, ADR-0026): when nothing in the telling so far yields a
   * Story date, the loop may ask — ONCE — "about when was that", phrased to accept a year or a
   * rough period and never demanding an exact date. The proposal is deterministic (the resolver's
   * `unresolvable` IS the temporal gap — no LLM call is spent detecting it), but the candidate
   * rides the ADR-0013 propose-then-dispose gates UNCHANGED: `decideFollowUp` applies the thin-
   * answer, distress/off-ramp, anti-repeat, confidence, and cap gates like any other candidate.
   *   - already asked (latched)         → never proposed again; skip / "I don't know" is terminal.
   *   - a gap follow-up already queued  → the earlier winner keeps the slot; we re-propose on the
   *     (by this response)                next unresolvable response instead of overriding it.
   * A usable answer resolves through the normal derivation pass on the next `recordResponse` (the
   * answer joins the story text so far) and persists with its provenance; an unusable one leaves
   * the story undated for the pipeline backstop (#246).
   */
  function proposeTemporalFollowUp(utterance: string): void {
    if (temporalFollowUpAsked) return;
    if (state.pendingGapFollowUp) return;
    const candidate: FollowUpCandidate = {
      threadSeed: STORY_DATE_FOLLOW_UP_SEED,
      type: "temporal",
      // Low sensitivity so the rapport gate cannot suppress the story's one dating chance; the
      // confidence is the shared gap-candidate constant (a deterministic gap carries no numeric
      // self-assessment, exactly like an LLM-detected one).
      sensitivity: "low",
      confidence: GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE,
      narratorOpened: false,
    };
    const policy = resolveFollowUpPolicy({ enabled: true, ...deps.followUpPolicy });
    const decision = decideFollowUp({
      evaluation: { candidates: [candidate], modelId: "story-date-derivation" },
      policy,
      answerWordCount: utterance.trim().split(/\s+/).filter(Boolean).length,
      // Same deliberate thread/session cap collapse as the gap-detection path above.
      followUpsAskedInThread: state.gapFollowUpsAskedInSession,
      followUpsAskedInSession: state.gapFollowUpsAskedInSession,
      distressed: state.distressed,
      offRampRequested: state.offRampRequested,
      rapportEstablished: state.turnCount >= RAPPORT_THRESHOLD_TURNS,
      alreadyAskedSeeds: state.askedGapSeeds,
    });
    if (decision.selected) {
      state.pendingGapFollowUp = { candidate: decision.selected, gapKind: "temporal" };
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
