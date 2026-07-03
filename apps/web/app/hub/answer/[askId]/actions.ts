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
  listStoryRecordings,
  dropStoryRecording,
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
} from "@chronicle/core";
import { ingestRecording, ingestFollowUpTake } from "@chronicle/capture";
import {
  augmentProfileFromStory,
  beginLogContext,
  plog,
  plogError,
  startTimer,
  transcribeTakeToRecording,
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
 * Record an answer to an ask. Validates that the ask is targeted at the signed-in person,
 * then ingests the audio blob via the account capture path (actor.kind = "account") — the
 * personId is taken from the server session, never from the client.
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
  if (!(audio instanceof Blob) || typeof askIdField !== "string" || !askIdField) {
    return { error: hub.actions.invalidInput };
  }

  // Defense: confirm the ask is targeted at this exact person before recording anything.
  const [askRow] = await db
    .select({
      targetPersonId: asks.targetPersonId,
      status: asks.status,
      question: asks.questionText,
    })
    .from(asks)
    .where(eq(asks.id, askIdField))
    .limit(1);
  if (!askRow || askRow.targetPersonId !== ctx.personId) {
    return { error: hub.actions.notForYou };
  }
  const askQuestionText = askRow.question;
  // Only queued/routed asks are answerable. Recording into an already-answered ask would create
  // a dead draft whose Share can never close (approveAndShareStory rejects a second answer for an
  // already-answered ask) — SF-4. Reject before ingesting anything.
  if (askRow.status !== "queued" && askRow.status !== "routed") {
    return { error: hub.actions.alreadyAnswered };
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: hub.actions.recordingEmpty };

  const totalTimer = startTimer();
  plog("answer", "recordAnswer: received", {
    person: ctx.personId,
    ask: askIdField,
    bytes: bytes.byteLength,
    contentType: audio.type || "audio/webm",
  });

  let storyId: string;
  try {
    const result = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: ctx.personId },
      audio: { bytes, contentType: audio.type || "audio/webm" },
      askId: askIdField,
    });
    storyId = result.storyId;
  } catch (err) {
    plogError("answer", "recordAnswer: ingest failed", {
      ask: askIdField,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
  plog("answer", "recordAnswer: ingested → draft story created", { story: storyId });

  const policy = resolveFollowUpPolicyForRequest();
  if (!policy.enabled) {
    // FLAG OFF — byte-for-byte today's one-shot path. Render BEFORE review (prose-provenance
    // design): transcribe → polish so the review phase can show the polished prose for the narrator
    // to read and edit. dispatchPipeline hides the durable-vs-synchronous decision: dev/CI runs it
    // in-process to completion (story reaches pending_approval before this returns); prod enqueues
    // onto the durable Inngest queue. Idempotent if re-run.
    try {
      await rt.dispatchPipeline(storyId);
    } catch (err) {
      plogError("answer", "recordAnswer: render pipeline failed", {
        story: storyId,
        ms: totalTimer(),
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return { error: hub.actions.saveFailed };
    }
    plog("answer", "recordAnswer: dispatched (synchronous in dev → pending_approval; enqueued in prod)", {
      story: storyId,
      ms: totalTimer(),
    });
    // Return `ready` so the client polls processing status. In dev/CI dispatch ran to completion
    // above (the first poll returns `ready`); in prod the durable pipeline is still running and the
    // client polls until it reaches `pending_approval`.
    return { kind: "ready", storyId };
  }

  // FLAG ON — mini-loop: transcribe take 0 (the evaluator's input), then evaluate → decide →
  // (phrase a follow-up | stitch + render). The whole follow-up attempt degrades to the one-shot
  // render on ANY failure so a broken/slow evaluator can never block sharing (handoff watch #2).
  try {
    const takes = await listStoryRecordings(db, storyId); // take 0 seeded at ingest
    const take0 = takes[0];
    if (!take0) {
      // Defensive — persistRecordingAndCreateDraft seeds take 0. If it is somehow absent, fall
      // back to the one-shot render so the narrator can still finish.
      await rt.dispatchPipeline(storyId);
      return { kind: "ready", storyId };
    }
    const { transcript } = await transcribeTakeToRecording(rt, take0.id);
    return await runFollowUpStep(rt, {
      storyId,
      ownerPersonId: ctx.personId,
      promptText: askQuestionText,
      answerTranscript: transcript,
    });
  } catch (err) {
    // A failure BEFORE runFollowUpStep's own guard (e.g. transcribe/take lookup) — degrade to the
    // one-shot render, which re-transcribes the canonical recording independently.
    plogError("answer", "recordAnswer: follow-up entry failed (degraded to one-shot)", {
      story: storyId,
      ms: totalTimer(),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    try {
      await rt.dispatchPipeline(storyId);
      return { kind: "ready", storyId };
    } catch {
      return { error: hub.actions.saveFailed };
    }
  }
}

/**
 * The core evaluate → decide → (phrase + persist follow-up | persist "none" + stitch/render) helper.
 * The ONLY place the ledger's `decision` rows are written; callers write the `outcome` rows. On
 * timeout (FOLLOW_UP_BUDGET_MS) or ANY evaluator/phraser failure it degrades to one-shot: stitch +
 * render the takes recorded so far and send the narrator to review. Never throws for a follow-up
 * failure — sharing is never blocked (handoff watch #2). Exported so the server test can drive it
 * directly against a hand-built runtime.
 */
export async function runFollowUpStep(
  rt: FollowUpStepRuntime,
  args: { storyId: string; ownerPersonId: string; promptText: string; answerTranscript: string },
): Promise<ThreadStep> {
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
    const step = await withTimeout(FOLLOW_UP_BUDGET_MS, async () => {
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
        return { kind: "follow_up", storyId: args.storyId, prompt: phrased.spokenText } as ThreadStep;
      }

      // Nothing selected → record the (fully-audited) "none" decision, then fall through to finish.
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
    });

    if (step) return step;
  } catch (err) {
    // Timeout or any evaluator/phraser/ledger failure → degrade to one-shot. Never block sharing.
    plogError("answer", "follow-up step failed (degraded to one-shot)", {
      story: args.storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  // Fall-through (nothing selected OR a caught failure): stitch the takes so far + polish once →
  // pending_approval, and send the narrator to review.
  await stitchAndRenderStory(rt, args.storyId);
  return { kind: "ready", storyId: args.storyId };
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
 * OPT-IN "Polish with AI" for the review-phase prose editor. Stateless text transform: takes the
 * narrator's CURRENT prose (typed or edited) and returns a tidied version — more coherent, spoken
 * self-corrections resolved. It persists NOTHING; the narrator sees the result in the editor, can
 * undo it, and only a subsequent Share writes the L3 correction. Auth-gated (an account session)
 * purely so this isn't an open LLM endpoint; there is no story to own yet on the typed path, so no
 * ownership check. An empty prose is echoed back unchanged (the pipeline no-ops before any LLM call).
 */
export async function polishAnswerProseAction(
  formData: FormData,
): Promise<{ prose: string } | { error: string }> {
  const { auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const prose = formData.get("prose");
  if (typeof prose !== "string") return { error: hub.actions.invalidInput };
  const promptQuestion = formData.get("promptQuestion");

  try {
    const result = await polishProse(languageModel, {
      prose,
      promptQuestion: typeof promptQuestion === "string" ? promptQuestion : null,
    });
    return { prose: result.prose };
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
  if (!(audio instanceof Blob) || typeof storyId !== "string" || !storyId) {
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

  // Degrade guard (handoff watch #2): an ASR/LLM/render hiccup mid-thread must never 500 the
  // narrator. The take's audio is durable after ingestFollowUpTake and "answered" is semantically
  // correct even if the follow-on transcribe/evaluate fails; on failure we stitch the takes-so-far
  // and finish gracefully. Auth/ownership/state guards stay OUTSIDE this try (a real authz failure
  // should surface its specific error, not be masked as saveFailed).
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

    const { transcript } = await transcribeTakeToRecording(rt, take.storyRecordingId);
    return await runFollowUpStep(rt, {
      storyId,
      ownerPersonId: ctx.personId,
      promptText: unresolved?.phrasedLine ?? "",
      answerTranscript: transcript,
    });
  } catch (err) {
    plogError("answer", "recordFollowUpTake: failed (degraded to finish)", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    // Graceful finish: stitch the takes recorded so far → pending_approval. If stitch ALSO fails,
    // surface a retryable error rather than an unhandled throw.
    try {
      await stitchAndRenderStory(rt, storyId);
      return { kind: "ready", storyId };
    } catch {
      return { error: hub.actions.saveFailed };
    }
  }
}

/**
 * "That's all for now" — the narrator declines the current follow-up and finishes the thread. Marks
 * the outstanding follow-up `skipped` (a first-class path, not a dead end), stitches + polishes the
 * takes recorded so far → pending_approval, and sends the narrator to review.
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

  // Degrade guard (handoff watch #2): a render hiccup must never 500 the narrator. The `skipped`
  // outcome is appended BEFORE stitch (the skip is a real, recorded event); a stitch failure returns
  // a retryable error so the narrator can tap "That's all for now" again. Auth/ownership/state
  // guards stay OUTSIDE this try (a real authz failure surfaces its specific error).
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
    await stitchAndRenderStory(rt, storyId);
    return { kind: "ready", storyId };
  } catch (err) {
    plogError("answer", "finishThread: stitch failed", {
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
