"use server";

/**
 * Server actions for the in-hub answer flow. Each action re-reads getRuntime() and
 * getCurrentAuthContext() on the server — personId is NEVER trusted from the client. This is the
 * security boundary: the audio blob and storyId come in via FormData, but the actor identity is
 * always derived from the server-side session.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { asks } from "@chronicle/db/schema";
import {
  getStoryForViewer,
  approveAndShareStory,
  discardDraftStory,
  saveProseCorrection,
  logPolish,
  updateDerivedFields,
  listStoryRecordings,
  appendVoiceTakeContribution,
  appendTypedTakeContribution,
  dropStoryRecording,
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
} from "@chronicle/core";
import { ingestRecording, ingestFollowUpTake, ingestTextStory } from "@chronicle/capture";
import {
  augmentProfileFromStory,
  beginLogContext,
  plog,
  plogError,
  startTimer,
  transcribeTakeToRecording,
  cleanupTake,
  stitchAndRenderStory,
  polishProse,
} from "@chronicle/pipeline";
import {
  createCoreAnchorSource,
  decideFollowUp,
  phraseIntent,
  detectDistress,
  detectOffRamp,
} from "@chronicle/interviewer";
import { resolveFollowUpPolicyForRequest } from "@/lib/follow-up-config";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";
import { mapStoryStateToStatus, type AnswerStatusResult } from "@/lib/answer-status";

export type ActionResult = { error: string } | undefined;

/**
 * The single client-facing result the answer surface drives on (Task 7's `AnswerFlow.handleStep`
 * interprets it). A record action resolves to one of:
 *   - `follow_up`: the interviewer proposed a deepening question — show the follow-up screen.
 *   - `ready`: the thread is complete and stitched → poll processing status, then review + Share.
 *   - `discarded`: the whole draft was dropped (e.g. dropping take 0) → back to the hub.
 *   - `{ error }`: a validation/auth failure surfaced to the narrator.
 * When the follow-up policy flag is OFF, a record always resolves to `ready` (today's one-shot path).
 */
export type ThreadStep =
  | { kind: "follow_up"; storyId: string; prompt: string }
  | { kind: "ready"; storyId: string }
  | { kind: "appended"; storyId: string; prose: string; appendedSegment: string }
  | { kind: "discarded" }
  | { error: string };

/**
 * Latency budget for the follow-up tax (evaluate + phrase). Exceed → degrade to one-shot: the
 * narrator's take is already transcribed regardless, so this bounds only the EXTRA follow-up work.
 * A broken/slow evaluator can never block sharing (handoff watch #2).
 */
const FOLLOW_UP_BUDGET_MS = 8000;
/**
 * The Ask-answer surface has no live turn history → no rapport signal yet; stay conservative so
 * high-sensitivity threads never fire on this surface in v1 (the emotional-door veto is separate).
 */
const RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE = false;

/**
 * runFollowUpStep needs only these from the runtime: `db`, and the two AI seams (`languageModel`
 * for phrasing / stitch-render, `followUpEvaluator` for the propose side). Typing it this narrowly
 * (rather than the full `getRuntime()` object) lets the server test drive it with a hand-built
 * object instead of the getRuntime singleton. The real callers pass the full runtime (a superset).
 */
type FollowUpStepRuntime = Pick<
  Awaited<ReturnType<typeof getRuntime>>,
  "db" | "languageModel" | "followUpEvaluator"
>;

export type AnswerStatusActionResult = AnswerStatusResult | { error: string };

/**
 * Ask-answerability guard, shared by the voice (`recordAnswerAction`) and generalized
 * (`composeStoryAction`) paths. Confirms the ask exists, is targeted at THIS person, and is still
 * answerable (queued/routed). On success returns the ask's question text (the follow-up evaluator's
 * seed prompt); on failure returns the `{ error }` the caller surfaces verbatim.
 *
 * Recording into an already-answered ask would create a dead draft whose Share can never close
 * (approveAndShareStory rejects a second answer for an already-answered ask) — SF-4 — so we reject
 * before ingesting anything.
 */
async function assertAnswerableAsk(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  askId: string,
  personId: string,
): Promise<{ questionText: string } | { error: string }> {
  const [askRow] = await db
    .select({
      targetPersonId: asks.targetPersonId,
      status: asks.status,
      question: asks.questionText,
    })
    .from(asks)
    .where(eq(asks.id, askId))
    .limit(1);
  if (!askRow || askRow.targetPersonId !== personId) {
    return { error: hub.actions.notForYou };
  }
  if (askRow.status !== "queued" && askRow.status !== "routed") {
    return { error: hub.actions.alreadyAnswered };
  }
  return { questionText: askRow.question };
}

/**
 * Record a voice telling. When an `askId` is present, validates that the ask is targeted at the
 * signed-in person and is still answerable, then (flag ON) runs the follow-up mini-loop seeded by
 * the ask question. When `askId` is ABSENT it is a self-initiated voice telling (ADR-0007): there
 * is no ask to validate and no ask question to seed the follow-up evaluator, so it takes the
 * one-shot dispatch path unconditionally. Either way the audio blob is ingested via the account
 * capture path (actor.kind = "account") — the personId is taken from the server session, never the
 * client.
 */
export async function recordAnswerAction(formData: FormData): Promise<ThreadStep> {
  // Correlate every log line for this answer run (ingest → queue → stages → AI seams).
  beginLogContext();
  const rt = await getRuntime();
  const { db, storage, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const audio = formData.get("audio");
  const askIdField = formData.get("askId");
  const askId = typeof askIdField === "string" && askIdField.length > 0 ? askIdField : null;
  if (!(audio instanceof Blob)) {
    return { error: hub.actions.invalidInput };
  }

  // Ask validation runs ONLY when answering a specific ask. A self-initiated telling has none.
  let askQuestionText = "";
  if (askId) {
    const ask = await assertAnswerableAsk(db, askId, ctx.personId);
    if ("error" in ask) return ask;
    askQuestionText = ask.questionText;
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: hub.actions.recordingEmpty };

  const totalTimer = startTimer();
  plog("answer", "recordAnswer: received", {
    person: ctx.personId,
    ask: askId ?? "(self-initiated)",
    bytes: bytes.byteLength,
    contentType: audio.type || "audio/webm",
  });

  let storyId: string;
  try {
    const result = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      ...(askId ? { askId } : {}),
    });
    storyId = result.storyId;
  } catch (err) {
    plogError("answer", "recordAnswer: ingest failed", {
      ask: askId ?? "(self-initiated)",
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
  plog("answer", "recordAnswer: ingested → draft story created", { story: storyId });

  // Per-take append (ADR-0014 Inc 3 slice 6): take 0 is ALWAYS appended onto the draft's working
  // prose as it arrives — transcribe → light Cleanup pass → appendVoiceTakeContribution (the two
  // automatic provenance rows keyed to the take + the working prose). The draft STAYS `draft` (Finish,
  // a later slice, transitions it). This replaces the old monolithic dispatchPipeline render AND the
  // old flag-ON branch that skipped the append entirely — the flag now only decides whether a
  // follow-up is PROPOSED afterwards.
  let transcript: string;
  let prose: string;
  let appendedSegment: string;
  try {
    const takes = await listStoryRecordings(db, storyId); // take 0 seeded at ingest
    const take0 = takes[0];
    if (!take0) {
      // Defensive — persistRecordingAndCreateDraft seeds take 0. Its absence is a save failure.
      plogError("answer", "recordAnswer: take 0 missing after ingest", { story: storyId });
      return { error: hub.actions.saveFailed };
    }
    const t = await transcribeTakeToRecording(rt, take0.id);
    transcript = t.transcript;
    const cleaned = await cleanupTake(rt.languageModel, {
      transcript,
      ...(askQuestionText ? { promptQuestion: askQuestionText } : {}),
    });
    ({ prose, appendedSegment } = await appendVoiceTakeContribution(db, {
      storyId,
      ownerPersonId: ctx.personId,
      storyRecordingId: take0.id,
      rawTranscript: transcript,
      cleanedSegment: cleaned.prose,
      transcribeModelId: t.modelId,
      cleanupModelId: cleaned.modelId,
      cleanupPromptText: cleaned.systemPrompt,
      // The INITIAL take on a fresh draft — there is no prior client editor text yet.
      priorProse: null,
    }));
    plog("answer", "recordAnswer: per-take append complete (draft stays draft)", {
      story: storyId,
      ms: totalTimer(),
    });
  } catch (err) {
    plogError("answer", "recordAnswer: per-take append failed", {
      story: storyId,
      ms: totalTimer(),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }

  // FLAG ON + answering a specific ask → additionally PROPOSE a follow-up seeded by the ask question.
  // (A self-initiated telling has no ask question to seed the evaluator.) The take is already durable
  // and appended above; runFollowUpStep degrades to `null` (stop proposing) on ANY evaluator/phraser
  // failure or timeout, so a broken/slow evaluator can never block the draft — it just means "no
  // follow-up proposed". There is no stitch-to-finish here anymore.
  const policy = resolveFollowUpPolicyForRequest();
  if (policy.enabled && askId) {
    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId: ctx.personId,
      promptText: askQuestionText,
      answerTranscript: transcript,
    });
    if (step) return step;
  }
  return { kind: "appended", storyId, prose, appendedSegment };
}

/**
 * Compose a story — the generalized front door for the in-hub telling surface (ADR-0007). Reads the
 * account session server-side (personId is NEVER trusted from the client), then branches on the form
 * payload:
 *   - a `text` string (and no `audio` Blob) → the typed telling: `ingestTextStory` writes a bare
 *     `kind='text'` draft, then `appendTypedTakeContribution` writes the typed words as the initial
 *     typed take (the `user_authored` provenance row + the draft's working prose). The draft STAYS
 *     `draft` (Finish, a later slice, transitions it) — there is no follow-up mini-loop on the typed
 *     path (no spoken take to evaluate) and no monolithic render.
 *   - otherwise → delegate to `recordAnswerAction` (the voice path, now itself ask-optional).
 *
 * `askId` is OPTIONAL on BOTH branches: when present the ask target/answerable check runs (as when
 * answering a specific question); when absent it is a self-initiated telling.
 */
export async function composeStoryAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const askIdField = formData.get("askId");
  const askId = typeof askIdField === "string" && askIdField.length > 0 ? askIdField : null;
  const audio = formData.get("audio");
  const text = formData.get("text");

  // TEXT branch (ADR-0007): a typed telling, ask-optional. Only taken when there is no audio blob.
  if (!(audio instanceof Blob) && typeof text === "string") {
    if (text.trim().length === 0) return { error: hub.actions.invalidInput };
    if (askId) {
      const ask = await assertAnswerableAsk(db, askId, ctx.personId);
      if ("error" in ask) return ask;
    }

    let storyId: string;
    try {
      const res = await ingestTextStory(db, {
        actor: { kind: "account", personId: ctx.personId },
        text,
        ...(askId ? { askId } : {}),
      });
      storyId = res.storyId;
    } catch (err) {
      plogError("answer", "composeStory(text): ingest failed", {
        ask: askId ?? "(self-initiated)",
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return { error: hub.actions.saveFailed };
    }
    plog("answer", "composeStory(text): ingested → text draft created", { story: storyId });

    // Per-take append (ADR-0014 Inc 3): write the typed words as the INITIAL typed take on the fresh
    // draft — appendTypedTakeContribution appends the `user_authored` provenance row keyed to the
    // narrator and sets the draft's working prose. priorProse=null (nothing was composed yet). The
    // draft STAYS `draft` (Finish, a later slice, transitions it); this replaces the old monolithic
    // dispatchPipeline render. appendTypedTakeContribution trims internally, so the raw `text` is
    // passed straight through — surrounding whitespace never survives into stored prose.
    try {
      const { prose, appendedSegment } = await appendTypedTakeContribution(db, {
        storyId,
        ownerPersonId: ctx.personId,
        text,
        priorProse: null,
      });
      return { kind: "appended", storyId, prose, appendedSegment };
    } catch (err) {
      plogError("answer", "composeStory(text): append failed", {
        story: storyId,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return { error: hub.actions.saveFailed };
    }
  }

  // VOICE branch — delegate to the existing, well-tested path (now ask-optional too).
  return recordAnswerAction(formData);
}

/**
 * PROPOSE-ONLY (ADR-0014 Inc 3 slice 6): the core evaluate → decide → (phrase + persist follow-up |
 * persist "none") helper. The ONLY place the ledger's `decision` rows are written; callers write the
 * `outcome` rows. Selected → phrase + append the decision row → return the `follow_up` step. Nothing
 * selected → append the null-seed decision row → return `null`. On timeout (FOLLOW_UP_BUDGET_MS) or
 * ANY evaluator/phraser/ledger failure → log + return `null`. There is NO stitch-to-finish: `null`
 * means "stop proposing; the draft stays open" (the narrator's take was already appended by the
 * caller). Never throws — a broken/slow evaluator can never block the draft (handoff watch #2).
 * Exported so the server test can drive it directly against a hand-built runtime.
 */
export async function runFollowUpStep(
  rt: FollowUpStepRuntime,
  args: { storyId: string; ownerPersonId: string; promptText: string; answerTranscript: string },
): Promise<{ kind: "follow_up"; storyId: string; prompt: string } | null> {
  const { db, languageModel, followUpEvaluator } = rt;
  const policy = resolveFollowUpPolicyForRequest();

  // Counters + anti-repeat, reconstructed from the ledger. A `decision` row with a selected seed is
  // a follow-up that was ASKED; threadPosition is the count of decision rows (0 = first evaluation).
  const priorDecisions = await listFollowUpDecisionsForStory(db, args.storyId);
  const askedSeeds = priorDecisions
    .filter((r) => r.recordKind === "decision" && r.selectedSeed)
    .map((r) => r.selectedSeed as string);
  const followUpsAskedInThread = askedSeeds.length;
  const threadPosition = priorDecisions.filter((r) => r.recordKind === "decision").length;
  const answerWordCount = args.answerTranscript.trim().split(/\s+/).filter(Boolean).length;
  const distressed = detectDistress(args.answerTranscript);
  const offRampRequested = detectOffRamp(args.answerTranscript);

  try {
    const step = await withTimeout<{ kind: "follow_up"; storyId: string; prompt: string } | null>(
      FOLLOW_UP_BUDGET_MS,
      async () => {
      const evaluation = await followUpEvaluator.evaluate({
        answerTranscript: args.answerTranscript,
        promptText: args.promptText,
        alreadyAskedSeeds: askedSeeds,
        coveredCategories: [],
        followUpsAskedInThread,
        rapportEstablished: RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE,
      });
      const decision = decideFollowUp({
        evaluation,
        policy,
        answerWordCount,
        followUpsAskedInThread,
        // Session cap is inert in v1 (one Ask = one thread); passing the thread count means the
        // per-thread cap is the binding one — honest, not theater (handoff watch #1).
        followUpsAskedInSession: followUpsAskedInThread,
        distressed,
        offRampRequested,
        rapportEstablished: RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE,
        alreadyAskedSeeds: askedSeeds,
      });

      if (decision.selected) {
        // phraseIntent runs BEFORE appendFollowUpDecision so the phrased line lands in the SAME
        // decision row (append-only — we can't backfill it later). Tradeoff: a phrase failure
        // degrades to one-shot with NO decision row written for this turn. Accepted — we'd rather
        // write no row than a decision row with a null phrasedLine that implies "nothing selected".
        const anchors = await createCoreAnchorSource(db).loadForNarrator(args.ownerPersonId);
        const phrased = await phraseIntent(languageModel, {
          intent: { kind: "follow_up", threadSeed: decision.selected.threadSeed },
          anchors,
          priorStories: [],
          isFirstSession: false,
        });
        await appendFollowUpDecision(db, {
          storyId: args.storyId,
          threadPosition,
          evaluatorModelId: evaluation.modelId,
          candidates: evaluation.candidates,
          dispositions: decision.dispositions,
          selectedSeed: decision.selected.threadSeed,
          phrasedLine: phrased.spokenText,
          policy,
        });
        return { kind: "follow_up", storyId: args.storyId, prompt: phrased.spokenText };
      }

      // Nothing selected → record the (fully-audited) "none" decision, then return null (stop).
      await appendFollowUpDecision(db, {
        storyId: args.storyId,
        threadPosition,
        evaluatorModelId: evaluation.modelId,
        candidates: evaluation.candidates,
        dispositions: decision.dispositions,
        selectedSeed: null,
        phrasedLine: null,
        policy,
      });
      return null;
    },
    );

    if (step) return step;
  } catch (err) {
    // Timeout or any evaluator/phraser/ledger failure → stop proposing. The take is already appended
    // by the caller and the draft stays open; a broken/slow evaluator never blocks it.
    plogError("answer", "follow-up step failed (stopped proposing; draft stays open)", {
      story: args.storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  // Nothing selected OR a caught failure → stop proposing. No stitch, no transition: the draft stays
  // open with the take already appended by the caller. The caller returns the `appended` step.
  return null;
}

/**
 * Race a promise against a timeout; the timeout rejects so the caller's catch degrades gracefully.
 * NOTE: a timed-out `fn` is NOT cancellable — the losing evaluator/phraser promise keeps running and
 * may later append a dangling unresolved `selected` decision row onto an already-finalized story.
 * That is a harmless audit artifact: nothing in the finalize/approve/share flow reads unresolved
 * decisions, and the story has already moved to pending_approval via the degrade path.
 */
function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("follow-up budget exceeded")), ms),
    ),
  ]);
}

/**
 * Viewer-scoped processing-status read for the in-hub answer flow (slice 2b). Account-auth: the
 * personId comes from the server session, never the client. The story is read through the SINGLE
 * FRONT DOOR (`getStoryForViewer`), which already enforces owner-only visibility of a not-yet-shared
 * draft — a non-owner gets `null` here (→ storyNotFound), so this cannot be used to probe foreign
 * stories. Maps the story state to the small `{ status, storyId }` contract; no content is returned.
 */
export async function getAnswerStatusAction(storyId: string): Promise<AnswerStatusActionResult> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId) {
    return { error: hub.actions.storyNotFound };
  }
  return { status: mapStoryStateToStatus(story.state), storyId: story.id };
}

/**
 * Share an answer: persists an optional prose correction (L3) if the narrator edited the
 * AI-polished prose, then approves+shares (tap approval per ADR-0004 — no spoken approval clip),
 * then augments the biographical profile from the transcript. The pipeline ran at record time
 * (recordAnswerAction), so the story is already pending_approval here.
 *
 * redirect("/hub") is called OUTSIDE the try/catch to avoid catching NEXT_REDIRECT.
 */
export async function shareAnswerAction(formData: FormData): Promise<ActionResult> {
  // Correlate every log line for this share run (approve/share → augmentation AI call).
  beginLogContext();
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  const tierRaw = formData.get("audienceTier");
  if (typeof storyId !== "string" || !storyId || typeof tierRaw !== "string") {
    return { error: hub.actions.invalidInput };
  }

  const validTiers = ["family", "branch", "public"] as const;
  type ValidTier = (typeof validTiers)[number];
  if (!(validTiers as readonly string[]).includes(tierRaw)) {
    return { error: hub.actions.pickAudience };
  }
  const audienceTier = tierRaw as ValidTier;

  const totalTimer = startTimer();
  plog("answer", "shareAnswer: begin", { story: storyId, person: ctx.personId, tier: audienceTier });

  try {
    // Ownership check via the front door. The owner can always see their own story (any state).
    const story = await getStoryForViewer(db, ctx, storyId);
    if (!story || story.ownerPersonId !== ctx.personId) {
      return { error: hub.actions.storyNotFound };
    }

    // Persist an optional prose correction (L3). Only sent when the narrator changed the
    // AI-polished prose in the review editor; otherwise the field is absent from FormData.
    // saveProseCorrection requires pending_approval (the pipeline set that at record time) and
    // the actor to be the owner (established above) — placed before approveAndShareStory, which
    // transitions the story to approved/shared.
    const correctedProse = formData.get("correctedProse");
    if (typeof correctedProse === "string" && correctedProse.length > 0) {
      await saveProseCorrection(db, {
        storyId,
        correctedProse,
        actorPersonId: ctx.personId,
      });
      plog("answer", "shareAnswer: saved L3 prose correction", {
        story: storyId,
        proseChars: correctedProse.length,
      });
    }

    // Persist an optional edited title. In review the narrator can change the AI-derived title;
    // when they do, the form carries a non-empty `correctedTitle`. Written via the same audited
    // core surface the render stage uses (updateDerivedFields → stories.title), BEFORE the
    // approve/share transition. Absent or whitespace-only → the title is left unchanged.
    const correctedTitle = formData.get("correctedTitle");
    if (typeof correctedTitle === "string" && correctedTitle.trim().length > 0) {
      await updateDerivedFields(db, storyId, { title: correctedTitle.trim() });
      plog("answer", "shareAnswer: saved edited title", { story: storyId });
    }

    // Tap approval (ADR-0004): no approvalAudio clip. Consent record is written with
    // approvalAudioMediaId = NULL (the column is nullable since ADR-0004 landed).
    await approveAndShareStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
      audienceTier,
    });
    plog("answer", "shareAnswer: approved & shared + consent recorded", {
      story: storyId,
      tier: audienceTier,
    });

    // Best-effort post-approval biographical augmentation: re-read the story after approval —
    // the pre-approval getStoryForViewer above was used only for the ownership check; a fresh
    // read fetches the now-approved (and possibly corrected) story, including its transcript.
    // Mine the transcript for biographical-profile fields the narrator hasn't filled in directly.
    // augmentProfileFromStory only writes currently-null fields, so it never overwrites a
    // direct intake answer. Wrapped in its own try/catch so a failed inference can never FAIL the
    // Share. It IS awaited inline — one extra LLM round-trip before the redirect; a durable job
    // queue could later move it off the request path (Next server actions can't safely
    // fire-and-forget after redirect).
    try {
      const approved = await getStoryForViewer(db, ctx, storyId);
      if (approved?.transcript) {
        plog("answer", "shareAnswer: augmenting profile from transcript", {
          story: storyId,
          transcriptChars: approved.transcript.length,
        });
        await augmentProfileFromStory(
          approved.transcript,
          ctx.personId,
          languageModel,
          createCoreAnchorSource(db),
        );
      }
    } catch (e) {
      // Augmentation is a nice-to-have; swallow so the share + redirect always succeed. Log so a
      // silently-never-working feature still leaves a breadcrumb (matches the turn loop's
      // best-effort pattern for markRouted / intake extraction).
      plogError("answer", "shareAnswer: profile augmentation failed (non-fatal)", {
        story: storyId,
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
    }
  } catch {
    return { error: hub.actions.shareFailed };
  }

  plog("answer", "shareAnswer: complete → redirect /hub", { story: storyId, ms: totalTimer() });
  // Called outside try/catch: redirect() throws NEXT_REDIRECT which Next.js intercepts.
  redirect("/hub");
}

/**
 * OPT-IN "Polish with AI" for the review-phase prose editor (ADR-0014 Inc 3, slice 2). Takes the
 * narrator's CURRENT prose (typed or edited) and returns a tidied version — more coherent, spoken
 * self-corrections resolved. Every REAL polish is now PERSISTED: `logPolish` appends an
 * `ai_polished` prose_revisions row (with modelId + promptText) AND updates `stories.prose`, so the
 * prose lineage stays complete. Auth-gated and owner-gated — the actor is resolved from the server
 * session (never the client) and `logPolish` rejects a non-owner. Allowed while the story is `draft`
 * OR `pending_approval` (a narrator may polish while composing or while reviewing before approval).
 */
export async function polishAnswerProseAction(
  formData: FormData,
): Promise<{ prose: string } | { error: string }> {
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const prose = formData.get("prose");
  const storyId = formData.get("storyId");
  if (typeof prose !== "string" || typeof storyId !== "string" || !storyId) {
    return { error: hub.actions.invalidInput };
  }
  const promptQuestion = formData.get("promptQuestion");

  try {
    const result = await polishProse(languageModel, {
      prose,
      promptQuestion: typeof promptQuestion === "string" ? promptQuestion : null,
    });
    // Guard: an empty-prose tap is a no-op (`polishProse` returns modelId === "" — no model ran), so
    // it must NOT write an `ai_polished` row. Persisting an empty/no-model revision would poison the
    // prose lineage. Only a real polish (non-empty modelId) is logged.
    if (result.modelId === "") {
      return { prose: result.prose };
    }
    const story = await logPolish(db, {
      storyId,
      ownerPersonId: ctx.personId,
      polishedProse: result.prose,
      modelId: result.modelId,
      promptText: result.systemPrompt,
    });
    // Return the story's persisted prose (logPolish whitespace-trims it) so the editor reflects
    // exactly what was written. `prose` is nullable on the Story type but logPolish just set it to a
    // non-null string, so the ?? branch is unreachable in practice.
    return { prose: story.prose ?? result.prose };
  } catch (err) {
    plogError("answer", "polishAnswerProse: failed", {
      person: ctx.personId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.answer.genericError };
  }
}

/**
 * Discard a never-consented draft (re-record supersession or explicit discard). DB row deleted
 * first (transactional), then best-effort blob cleanup. The domain enforces state = 'draft' and
 * ownership — only the narrator who owns the draft may discard it.
 */
export async function discardAnswerAction(formData: FormData): Promise<ActionResult> {
  const { db, storage, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  try {
    const { storageKeys } = await discardDraftStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
    });
    // Best-effort blob cleanup: a leaked object-storage key is harmless; a dangling DB row
    // is not — so the row was already removed transactionally above.
    for (const key of storageKeys) {
      await storage.delete(key).catch(() => {});
    }
  } catch {
    return { error: hub.actions.removeFailed };
  }
}

/**
 * Record a follow-up take: the narrator answered an interviewer follow-up. Appends the take onto the
 * existing draft story (ADR-0012 multi-take model), attaches the `answered` outcome for the
 * follow-up they just responded to, transcribes the new take, then runs the next follow-up step
 * (which may propose another follow-up, or finish the thread). Owner + draft-state authz is done
 * here on the server; `ingestFollowUpTake` trusts the passed `ownerPersonId`.
 */
export async function recordFollowUpTakeAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, storage, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const audio = formData.get("audio");
  const storyId = formData.get("storyId");
  const proseField = formData.get("prose");
  if (!(audio instanceof Blob) || typeof storyId !== "string" || !storyId) {
    return { error: hub.actions.invalidInput };
  }
  // The client posts its CURRENT editor text as `prose` — the base the new take is appended onto
  // (non-clobbering: appendVoiceTakeContribution authors from THIS text, not a DB re-read). Required.
  if (typeof proseField !== "string") {
    return { error: hub.actions.invalidInput };
  }

  // Ownership + draft-state via the front door. A follow-up take is only valid while the story is
  // still an un-approved draft.
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") {
    return { error: hub.actions.storyNotFound };
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: hub.actions.recordingEmpty };

  // Degrade guard (handoff watch #2): an ASR/LLM hiccup mid-thread must never 500 the narrator. The
  // take's audio is durable after ingestFollowUpTake and "answered" is semantically correct even if
  // the follow-on transcribe/cleanup/evaluate fails. On ANY failure the story stays `draft` (no
  // stitch, no transition) and the narrator retries with a retryable error. Auth/ownership/state
  // guards stay OUTSIDE this try (a real authz failure surfaces its specific error, not saveFailed).
  try {
    const take = await ingestFollowUpTake(db, storage, {
      storyId,
      ownerPersonId: ctx.personId,
      audio: { bytes, contentType: audio.type || "audio/webm" },
    });

    // Attach the `answered` outcome for the follow-up they just responded to (append-only ledger).
    const unresolved = await latestUnresolvedDecision(db, storyId);
    if (unresolved) {
      await appendFollowUpOutcome(db, {
        storyId,
        decisionId: unresolved.id,
        threadPosition: unresolved.threadPosition,
        outcome: "answered",
      });
    }

    // Append the follow-up take's words onto the CLIENT'S current prose (priorProse = proseField),
    // then optionally propose the next follow-up. No stitch — the draft is built up take-by-take.
    const { transcript, modelId: transcribeModelId } = await transcribeTakeToRecording(
      rt,
      take.storyRecordingId,
    );
    const cleaned = await cleanupTake(rt.languageModel, {
      transcript,
      ...(unresolved?.phrasedLine ? { promptQuestion: unresolved.phrasedLine } : {}),
    });
    const { prose, appendedSegment } = await appendVoiceTakeContribution(db, {
      storyId,
      ownerPersonId: ctx.personId,
      storyRecordingId: take.storyRecordingId,
      rawTranscript: transcript,
      cleanedSegment: cleaned.prose,
      transcribeModelId,
      cleanupModelId: cleaned.modelId,
      cleanupPromptText: cleaned.systemPrompt,
      // Load-bearing: the CLIENT'S editor text, NOT a DB read — non-clobbering append.
      priorProse: proseField,
    });

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId: ctx.personId,
      promptText: unresolved?.phrasedLine ?? "",
      answerTranscript: transcript,
    });
    return step ?? { kind: "appended", storyId, prose, appendedSegment };
  } catch (err) {
    plogError("answer", "recordFollowUpTake: failed (draft stays open; retryable)", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    // The story stays `draft` — the narrator can retry. No stitch-to-finish.
    return { error: hub.actions.saveFailed };
  }
}

/**
 * "That's all for now" — the narrator declines the current follow-up (ADR-0014 Inc 3 slice 6). Marks
 * the outstanding follow-up `skipped` (a first-class path, not a dead end). There is NO transition and
 * NO stitch: the draft's working prose is already whatever the appends built up, and Finish (a later
 * slice) is what transitions the draft. Declining appends no new prose segment — it just records the
 * skip and returns the narrator to the draft surface.
 *
 * NOTE: the name is kept as `finishThreadAction` (rename to `declineFollowUpAction` is deferred to a
 * later slice; StoryComposer's import must not change yet).
 */
export async function finishThreadAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") {
    return { error: hub.actions.storyNotFound };
  }

  // Degrade guard (handoff watch #2): a ledger hiccup must never 500 the narrator. The `skipped`
  // outcome is a real, recorded event; a failure returns a retryable error so the narrator can tap
  // "That's all for now" again. Auth/ownership/state guards stay OUTSIDE this try (a real authz
  // failure surfaces its specific error, not saveFailed).
  try {
    const unresolved = await latestUnresolvedDecision(db, storyId);
    if (unresolved) {
      await appendFollowUpOutcome(db, {
        storyId,
        decisionId: unresolved.id,
        threadPosition: unresolved.threadPosition,
        outcome: "skipped",
      });
    }
    // Empty `appendedSegment`: a decline appends NO prose segment (unlike a take). `prose` is the
    // draft's current working text unchanged; the client's `appended` handler uses the empty segment
    // to just return to the draft surface without inserting anything.
    return { kind: "appended", storyId, prose: story.prose ?? "", appendedSegment: "" };
  } catch (err) {
    plogError("answer", "finishThread: recording skip failed", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
}

/**
 * Review-phase drop of one take. Dropping take 0 discards the WHOLE thread (its follow-ups are
 * orphaned without the initial answer) → `discarded`. Dropping a follow-up take (position > 0)
 * removes just that take and re-stitches the survivors so the review prose reflects the drop.
 *
 * State-machine safety: dropping is only valid PRE-APPROVAL. `dropStoryRecording` guards
 * owner + state (draft/pending_approval), and `stitchAndRenderStory`'s re-transition to
 * pending_approval is a safe no-op from those states — but there is NO approved→pending_approval
 * edge, so a drop after approval would throw. We rely on `dropStoryRecording`'s state guard and
 * never attempt drops on approved stories.
 */
export async function dropTakeAction(formData: FormData): Promise<ThreadStep> {
  const rt = await getRuntime();
  const { db, storage, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  const posRaw = formData.get("position");
  if (typeof storyId !== "string" || !storyId || typeof posRaw !== "string") {
    return { error: hub.actions.invalidInput };
  }
  const position = Number(posRaw);
  if (!Number.isInteger(position) || position < 0) {
    return { error: hub.actions.invalidInput };
  }

  try {
    if (position === 0) {
      // Dropping the initial take discards the whole thread.
      const { storageKeys } = await discardDraftStory(db, {
        storyId,
        narratorPersonId: ctx.personId,
      });
      for (const key of storageKeys) await storage.delete(key).catch(() => {});
      return { kind: "discarded" };
    }
    const { storageKey } = await dropStoryRecording(db, {
      storyId,
      position,
      narratorPersonId: ctx.personId,
    });
    await storage.delete(storageKey).catch(() => {});
    // Re-stitch + re-polish the surviving takes so the review prose reflects the drop.
    await stitchAndRenderStory(rt, storyId);
    return { kind: "ready", storyId };
  } catch {
    return { error: hub.actions.removeFailed };
  }
}
