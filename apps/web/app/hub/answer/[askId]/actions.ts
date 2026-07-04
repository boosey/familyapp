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
  finishDraft,
  updateDerivedFields,
  listStoryRecordings,
  appendVoiceTakeContribution,
  appendTypedTakeContribution,
  dropStoryRecording,
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
  listAskSubjectPhotos,
  attachPhotoToStory,
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
  polishProse,
  deriveMetadata,
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

export type ActionResult = { error: string } | undefined;

/**
 * The single client-facing result the answer surface drives on (`handleStep` interprets it). A record
 * action resolves to one of:
 *   - `follow_up`: the interviewer proposed a deepening question — show the follow-up screen.
 *   - `appended`: a take (voice/typed) was appended onto the draft's working prose, or a decline
 *     recorded — the draft stays `draft`; the client seeds the returned prose and stays composing.
 *   - `take_dropped`: a follow-up take's audio was removed (ADR-0014 Inc 3 slice 7). The draft state
 *     is UNCHANGED and the take's text stays in the working prose — the narrator edits it out
 *     manually (RESOLVED DECISION d). The client just refreshes the takes list + shows a message.
 *   - `discarded`: the whole draft was dropped (e.g. dropping take 0) → back to the hub.
 *   - `finish_offer`: the Finish-check ran a speculative polish that MATERIALLY differs (ADR-0014 Inc 3
 *     slice 8). Nothing is persisted yet — the client shows an inline dismissible card carrying the
 *     polished text plus its `polishModelId`/`polishPromptText` so an accept can `logPolish` it WITHOUT
 *     re-running the model (0 extra LLM calls).
 *   - `finished`: the draft was sealed `draft → pending_approval` (Finish). Either the polish was
 *     declined/immaterial (finished as-is) or accepted (finished on the polished text).
 *   - `{ error }`: a validation/auth failure surfaced to the narrator.
 * NOTE (ADR-0014 Inc 3 slice 11): the legacy `ready` stitch-to-review variant was REMOVED — no answer
 * action has produced it since slice 7, and the composing surface (`ComposingEditor`) never polls. The
 * link-session capture surface (`/s/[token]`) keeps its OWN status polling via `/api/capture/status`
 * (which maps story state to a `"ready"` STRING through `mapStoryStateToStatus`) — that is a distinct
 * type, unaffected by this removal.
 */
export type ThreadStep =
  | {
      kind: "follow_up";
      storyId: string;
      prompt: string;
      // ADR-0014 Inc 3 slice 10: a follow_up now also carries the working prose after the take that
      // triggered it was appended, so the client can seed the always-mounted composing editor
      // OPTIMISTICALLY (no refresh/remount) and show the follow-up as an inline banner. Without this,
      // a take-0 follow_up (which arrives before any refresh) would have no prose to seed the editor.
      prose: string;
      appendedSegment: string;
    }
  | { kind: "appended"; storyId: string; prose: string; appendedSegment: string }
  | { kind: "take_dropped"; storyId: string }
  | {
      kind: "finish_offer";
      storyId: string;
      polished: string;
      polishModelId: string;
      polishPromptText: string;
    }
  | { kind: "finished"; storyId: string }
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

/** Read an optional non-empty string field from FormData; returns `null` when absent/blank/non-string. */
function formField(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}

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
 * Resolve the story's SUBJECT photo (ADR-0009 Phase 3) for a new telling, plus any photos to carry
 * forward as accompaniment. Two independent origins, ask-photos taking precedence:
 *   - Answer→story carry-forward: when the answered ask HAS subject photos, the FIRST becomes the new
 *     story's subject/cover and the REST are attached as accompaniment (this fn returns them so the
 *     caller can attach after the story is created — the answerer is the ask target / co-member, so
 *     the core album-access gate passes).
 *   - Tell-a-photo: a self-initiated telling started from the album viewer carries a single
 *     `subjectPhotoId` (the client hint). It is NOT trusted for identity — the core write gate
 *     (`assertPersonCanAccessAlbumPhoto`, run inside ingest against the SERVER-resolved owner) is what
 *     enforces the owner can actually see it; a crafted id for an unseeable photo makes ingest throw.
 * `clientSubjectPhotoId` is ignored whenever the ask supplies photos (an answer isn't a tell-a-photo).
 */
async function resolveSubjectPhotos(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  askId: string | null,
  clientSubjectPhotoId: string | null,
): Promise<{ subjectPhotoId?: string; carryForward: string[] }> {
  if (askId) {
    const askPhotos = await listAskSubjectPhotos(db, askId);
    if (askPhotos.length > 0) {
      return { subjectPhotoId: askPhotos[0], carryForward: askPhotos.slice(1) };
    }
  }
  if (clientSubjectPhotoId) {
    return { subjectPhotoId: clientSubjectPhotoId, carryForward: [] };
  }
  return { carryForward: [] };
}

/**
 * Attach the carry-forward (non-subject) ask photos onto the freshly-created story as accompaniment.
 * Best-effort per photo: the subject/cover is already durable (inserted atomically at story creation),
 * so a hiccup attaching a secondary photo must never fail the answer. `attachedByPersonId` is the
 * SERVER-resolved answerer (the ask target / co-member), whom the core album-access gate authorizes.
 */
async function attachCarryForwardPhotos(
  db: Awaited<ReturnType<typeof getRuntime>>["db"],
  storyId: string,
  photoIds: string[],
  answererPersonId: string,
): Promise<void> {
  for (const familyPhotoId of photoIds) {
    try {
      await attachPhotoToStory(db, { storyId, familyPhotoId, attachedByPersonId: answererPersonId });
    } catch (err) {
      plogError("answer", "carry-forward photo attach failed (non-fatal)", {
        story: storyId,
        photo: familyPhotoId,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }
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

  // ADR-0009 Phase 3 subject/carry-forward. The client `subjectPhotoId` (tell-a-photo) is a hint
  // only — the core write gate re-checks it against the server-resolved owner. Ask subject photos
  // (carry-forward) take precedence and are read server-side from the ask.
  const { subjectPhotoId, carryForward } = await resolveSubjectPhotos(
    db,
    askId,
    formField(formData, "subjectPhotoId"),
  );
  const promptQuestion = formField(formData, "promptQuestion");

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
      ...(subjectPhotoId ? { subjectPhotoId } : {}),
      ...(promptQuestion ? { promptQuestion } : {}),
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

  // Answer→story carry-forward (ADR-0009 Phase 3): the remaining ask subject photos ride onto the
  // story as accompaniment (the first already became the subject/cover inside ingest). Best-effort —
  // never blocks the answer.
  await attachCarryForwardPhotos(db, storyId, carryForward, ctx.personId);

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
    // Carry the just-appended working prose onto the follow_up step so the client seeds the composing
    // editor optimistically (ADR-0014 Inc 3 slice 10 — take-0 follow_up arrives before any refresh).
    if (step) return { ...step, prose, appendedSegment };
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

    // ADR-0009 Phase 3 subject/carry-forward — same rules as the voice path (see resolveSubjectPhotos).
    const { subjectPhotoId, carryForward } = await resolveSubjectPhotos(
      db,
      askId,
      formField(formData, "subjectPhotoId"),
    );
    const promptQuestion = formField(formData, "promptQuestion");

    let storyId: string;
    try {
      const res = await ingestTextStory(db, {
        actor: { kind: "account", personId: ctx.personId },
        text,
        ...(askId ? { askId } : {}),
        ...(subjectPhotoId ? { subjectPhotoId } : {}),
        ...(promptQuestion ? { promptQuestion } : {}),
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

    // Carry-forward accompaniment (ADR-0009 Phase 3; best-effort — the subject/cover is already
    // durable). Same rules as the voice path.
    await attachCarryForwardPhotos(db, storyId, carryForward, ctx.personId);

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
 * Append a TYPED take onto an EXISTING draft (ADR-0014 Inc 3 slice 10). This is what makes the
 * composing surface's capture footer type-box "live" for take ≥ 1: `composeStoryAction`'s text branch
 * only ever creates a NEW story (take 0, `priorProse=null`), so a second typed contribution needs its
 * own front door. Reuses the audited `appendTypedTakeContribution` core fn — the narrator's `prose`
 * (their current editor text) is the base concatenated onto (non-clobbering, the same priorProse
 * discipline the voice-append path follows). Owner + `draft`-state gated via the front door.
 */
export async function appendTypedTakeAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  const text = formData.get("text");
  const proseField = formData.get("prose");
  if (
    typeof storyId !== "string" ||
    !storyId ||
    typeof text !== "string" ||
    typeof proseField !== "string"
  ) {
    return { error: hub.actions.invalidInput };
  }
  if (text.trim().length === 0) return { error: hub.actions.invalidInput };

  // Ownership + draft-state via the front door. Appending a take is only valid on an un-approved
  // draft the caller owns.
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") {
    return { error: hub.actions.storyNotFound };
  }

  try {
    const { prose, appendedSegment } = await appendTypedTakeContribution(db, {
      storyId,
      ownerPersonId: ctx.personId,
      text,
      // Load-bearing: the CLIENT'S editor text, NOT a DB read — non-clobbering append.
      priorProse: proseField,
    });
    return { kind: "appended", storyId, prose, appendedSegment };
  } catch (err) {
    plogError("answer", "appendTypedTake: failed", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
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
  const { db, auth, languageModel, narratorMemory } = await getRuntime();
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
    // read fetches the now-approved (and possibly corrected) story, including its prose.
    // Mine the PROSE (not the transcript) for biographical-profile fields the narrator hasn't filled
    // in directly (ADR-0014 Inc 3 slice 8, decision c): new-model append-built stories leave
    // `transcript` NULL — only `prose` is populated — so reading `transcript` here silently no-oped.
    // augmentProfileFromStory only writes currently-null fields, so it never overwrites a
    // direct intake answer. Wrapped in its own try/catch so a failed inference can never FAIL the
    // Share. It IS awaited inline — one extra LLM round-trip before the redirect; a durable job
    // queue could later move it off the request path (Next server actions can't safely
    // fire-and-forget after redirect).
    try {
      const approved = await getStoryForViewer(db, ctx, storyId);
      if (approved?.prose) {
        plog("answer", "shareAnswer: augmenting profile from prose", {
          story: storyId,
          proseChars: approved.prose.length,
        });
        await augmentProfileFromStory(
          approved.prose,
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

    // Consent-gated narrator-memory feed (ADR-0014 §9): a Story feeds the (deferred) memory model
    // ONLY here, post-approval — a discarded/unshared draft never reaches this seam. Currently a
    // no-op sink; the SEAM is placed so extraction lands here when the model arrives. Best-effort in
    // its OWN try/catch: a memory-feed failure must never fail the share/redirect. Only when the
    // approved story has prose (the consented text mined for memory).
    try {
      const approved = await getStoryForViewer(db, ctx, storyId);
      if (approved?.prose) {
        await narratorMemory.record({
          personId: ctx.personId,
          source: "story",
          text: approved.prose,
        });
      }
    } catch (e) {
      plogError("answer", "shareAnswer: narrator-memory feed failed (non-fatal)", {
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
    // Same as take 0: carry the appended prose onto a follow_up so the client seeds the mounted editor.
    return step
      ? { ...step, prose, appendedSegment }
      : { kind: "appended", storyId, prose, appendedSegment };
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
 * "That's all for now" — the narrator declines the current follow-up (ADR-0014 Inc 3 slice 6, renamed
 * from `finishThreadAction` in slice 10). Marks the outstanding follow-up `skipped` (a first-class
 * path, not a dead end). There is NO transition and NO stitch: the draft's working prose is already
 * whatever the appends built up, and Finish (`finishDraftAction`) is what transitions the draft.
 * Declining appends no new prose segment — it just records the skip and returns the narrator to the
 * composing surface.
 *
 * Non-clobbering (ADR-0014 Inc 3 slice 10, forward-risk (i) fix): the composing editor is now ALWAYS
 * mounted while the follow-up banner shows, so the narrator may have unsaved hand-edits. This action
 * therefore ECHOES the client's posted `prose` back (never a fresh `stories.prose` read) and returns
 * `appendedSegment: ""`; the client's `appended` handler SKIPS `history.replace` on an empty segment,
 * so a decline never overwrites in-flight edits. (`prose` is optional for backward-safety; absent →
 * the server working text, unchanged.)
 */
export async function declineFollowUpAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };
  // The client's current editor text (non-clobbering echo). Optional: absent → fall back to DB prose.
  const proseField = formData.get("prose");
  const clientProse = typeof proseField === "string" ? proseField : null;

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
    // Empty `appendedSegment` + echoed client prose: a decline appends NO new prose segment. The client
    // skips `history.replace` on the empty segment, so its unsaved edits survive (forward-risk (i) fix).
    return { kind: "appended", storyId, prose: clientProse ?? story.prose ?? "", appendedSegment: "" };
  } catch (err) {
    plogError("answer", "declineFollowUp: recording skip failed", {
      story: storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.actions.saveFailed };
  }
}

/**
 * Whitespace-normalize for the Finish-check "materially differs" test: collapse every run of
 * whitespace to a single space and trim. Two strings that differ only in spacing/newlines normalize
 * equal — so a polish that only reflows whitespace is NOT offered (it would be a no-op change).
 */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Finish + Finish-check (ADR-0014 Inc 3 slice 8). Seals a `draft` to `pending_approval`, optionally
 * offering a speculative polish first. `intent`:
 *   - `probe`: run `polishProse` on the CLIENT'S current editor `prose`. If a REAL polish
 *     (`modelId !== ""`) MATERIALLY differs (whitespace-normalized `!==`), return a `finish_offer`
 *     carrying the polished text + its modelId/promptText — persisting NOTHING. Otherwise finish the
 *     posted prose as-is (`finished`).
 *   - `accept`: the narrator took the offered polish. Re-uses the already-computed polished text +
 *     modelId/promptText posted back by the client — `logPolish` (one `ai_polished` row + prose) then
 *     `deriveMetadata` then `finishDraft` — with NO second `polishProse` call (0 extra LLM calls).
 *   - `decline`: finish the posted prose as-is (`deriveMetadata` + `finishDraft`, no polish).
 *
 * priorProse discipline (load-bearing): Finish operates on the POSTED `prose` (the client's editor
 * text), NEVER a fresh `stories.prose` read — the same non-clobbering rule the append actions follow.
 * Auth + owner + `draft`-state are pre-checked via the front door; `finishDraft`/`logPolish` re-enforce
 * owner+draft internally.
 */
export async function finishDraftAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const { db, auth, languageModel } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const intent = formData.get("intent");
  const storyId = formData.get("storyId");
  const proseField = formData.get("prose");
  const promptField = formData.get("promptQuestion");
  if (
    typeof storyId !== "string" ||
    !storyId ||
    typeof proseField !== "string" ||
    (intent !== "probe" && intent !== "accept" && intent !== "decline")
  ) {
    return { error: hub.actions.invalidInput };
  }
  const promptQuestion =
    typeof promptField === "string" && promptField.length > 0 ? promptField : null;

  // Ownership + draft-state via the front door. Finish is only valid on an un-approved draft the
  // caller owns; a foreign/non-draft story is refused before any work (finishDraft/logPolish re-check).
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") {
    return { error: hub.actions.storyNotFound };
  }

  try {
    if (intent === "accept") {
      // The client posts back the ALREADY-computed polished text + its provenance from the offer, so
      // acceptance records the polish WITHOUT re-running polishProse (0 extra LLM calls).
      const polishedField = formData.get("polished");
      if (typeof polishedField !== "string" || polishedField.length === 0) {
        return { error: hub.actions.invalidInput };
      }
      const polishModelIdField = formData.get("polishModelId");
      const polishPromptTextField = formData.get("polishPromptText");
      const polishModelId = typeof polishModelIdField === "string" ? polishModelIdField : "";
      const polishPromptText =
        typeof polishPromptTextField === "string" ? polishPromptTextField : "";

      await logPolish(db, {
        storyId,
        ownerPersonId: ctx.personId,
        polishedProse: polishedField,
        modelId: polishModelId,
        promptText: polishPromptText,
      });
      const meta = await deriveMetadata(languageModel, { fullText: polishedField, promptQuestion });
      await finishDraft(db, {
        storyId,
        ownerPersonId: ctx.personId,
        finalText: polishedField,
        metadata: { title: meta.title, summary: meta.summary, tags: meta.tags },
      });
      plog("answer", "finishDraft: accepted polish → finished (pending_approval)", {
        story: storyId,
      });
      return { kind: "finished", storyId };
    }

    if (intent === "probe") {
      // Speculative Finish-check: does a polish MATERIALLY change the narrator's words? If so, offer it
      // (persist nothing); if not (or no model ran), fall through and finish as-is.
      const polish = await polishProse(languageModel, { prose: proseField, promptQuestion });
      if (
        polish.modelId !== "" &&
        normalizeWhitespace(polish.prose) !== normalizeWhitespace(proseField)
      ) {
        plog("answer", "finishDraft: probe → polish differs, offering", { story: storyId });
        return {
          kind: "finish_offer",
          storyId,
          polished: polish.prose,
          polishModelId: polish.modelId,
          polishPromptText: polish.systemPrompt,
        };
      }
      plog("answer", "finishDraft: probe → polish immaterial, finishing as-is", { story: storyId });
      // fall through to the finish-as-is path below
    }

    // decline (or probe with an immaterial/absent polish): seal the POSTED prose unchanged.
    const meta = await deriveMetadata(languageModel, { fullText: proseField, promptQuestion });
    await finishDraft(db, {
      storyId,
      ownerPersonId: ctx.personId,
      finalText: proseField,
      metadata: { title: meta.title, summary: meta.summary, tags: meta.tags },
    });
    plog("answer", "finishDraft: finished as-is (pending_approval)", { story: storyId });
    return { kind: "finished", storyId };
  } catch (err) {
    plogError("answer", "finishDraft: failed", {
      story: storyId,
      intent,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return { error: hub.answer.genericError };
  }
}

/**
 * Review/compose-phase drop of one take (ADR-0014 Inc 3 slice 7 — audio-only). Dropping take 0
 * discards the WHOLE thread (its follow-ups are orphaned without the initial answer) → `discarded`.
 * Dropping a follow-up take (position > 0) removes ONLY that take's audio + its per-take
 * prose_revisions rows (via `dropStoryRecording`) — it does NOT re-stitch and does NOT change
 * `stories.prose`: the narrator's words stay in the working prose and they edit them out manually
 * (RESOLVED DECISION d). Returns `take_dropped` so the client refreshes the takes list + shows the
 * decision-(d) message, keeping the composing surface (and the unsaved prose editor) intact.
 *
 * State-machine safety: dropping is only valid PRE-APPROVAL. `dropStoryRecording` guards
 * owner + state (draft/pending_approval); we never attempt drops on approved stories.
 */
export async function dropTakeAction(formData: FormData): Promise<ThreadStep> {
  const { db, storage, auth } = await getRuntime();
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
    // Audio-only (slice 7): no re-stitch, no state transition, no prose edit. The take's text stays
    // in the working prose; the client shows the decision-(d) message and refreshes the takes list.
    return { kind: "take_dropped", storyId };
  } catch {
    return { error: hub.actions.removeFailed };
  }
}
