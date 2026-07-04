"use client";

/**
 * Two-phase story composer — capture then review (relisten + tier-pick + share/re-record/discard).
 *
 * Generalized from the answer flow (ADR-0007): ONE component parameterized by an optional `ask`.
 *  - `mode="answer"` + `ask` present → the in-hub answer flow (question header, follow-up loop).
 *  - `mode="tell"`   + `ask` null    → a self-initiated telling (no question header, no ask to seed
 *    the follow-up evaluator). `/hub/tell` renders this variant.
 *
 * Capture offers a voice⇄text toggle: speak (the canonical path) or type it (ADR-0007 text stories).
 *
 * Phase is server-driven: if `draft` is null, nothing is captured yet (capture phase); if `draft` is
 * non-null, there is a saved take ready to review (review phase). The server component re-renders
 * after each action via router.refresh(), updating the props.
 *
 * All server mutations go through the server actions in answer/[askId]/actions.ts — personId is
 * never sent by the client. The initial capture posts to `composeStoryAction` (the ask-optional
 * front door that branches text vs. voice); follow-up takes stay on `recordFollowUpTakeAction`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KindredVoiceButton, KindredButton, KindredProseEditor } from "@/app/_kindred";
import { hub, common } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import {
  composeStoryAction,
  recordFollowUpTakeAction,
  finishThreadAction,
  dropTakeAction,
  shareAnswerAction,
  discardAnswerAction,
  getAnswerStatusAction,
  polishAnswerProseAction,
  type ThreadStep,
} from "./answer/[askId]/actions";
import { pollUntilReady } from "@/lib/poll-status";
import { AnswerReviewPending } from "./answer/[askId]/AnswerReviewPending";
import { FollowUpPrompt } from "./answer/[askId]/FollowUpPrompt";

type RecordPhase = "idle" | "listening" | "saving" | "softfail";
type Tier = "family" | "branch" | "public";
type Op = "share" | "rerecord" | "discard" | "drop" | null;
type InputMode = "voice" | "text";

const TIER_ORDER: Tier[] = ["family", "branch", "public"];

/** One recorded take in a (possibly multi-take) draft thread. Ordered by `position`; position 0 is
 * the initial answer, positions > 0 are follow-up takes. */
export interface TakeInfo {
  position: number;
  mediaUrl: string;
  isInitial: boolean;
}

export interface DraftInfo {
  storyId: string;
  recordedAt: string; // ISO string (serialized from Date by the server component)
  mediaUrl: string;
  prose: string;
  title: string;
  takes: TakeInfo[];
}

interface StoryComposerProps {
  mode: "answer" | "tell";
  /** The ask being answered (answer mode) or `null`/absent for a self-initiated telling (tell mode). */
  ask?: { id: string; questionText: string; askerName: string } | null;
  draft: DraftInfo | null;
}

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  if (typeof MediaRecorder !== "undefined") {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return "audio/webm";
}

export function StoryComposer({ mode, ask = null, draft }: StoryComposerProps) {
  const router = useRouter();

  // Where a discard returns the narrator. A tell-mode draft came from the Stories tab, so send them
  // back there; an answer came from the Questions tab. (A legitimate mode-dependent branch.)
  const backTab = mode === "tell" ? "/hub?tab=stories" : "/hub?tab=questions";

  // Dev-time consistency guard. `mode` is part of the props contract (Task 10 renders
  // mode="tell"), but real behavior is discriminated by ask-presence and input-origin — NOT by
  // `mode`. This catches a caller whose `mode` disagrees with the actual `ask` prop (which would
  // otherwise silently render the wrong surface).
  if (process.env.NODE_ENV !== "production" && (mode === "answer") !== (ask != null)) {
    // eslint-disable-next-line no-console
    console.warn("StoryComposer: `mode` and `ask`-presence disagree");
  }

  // ── Capture phase state ─────────────────────────────────────────────────────
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("idle");
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [textDraft, setTextDraft] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Review phase state ──────────────────────────────────────────────────────
  const [tier, setTier] = useState<Tier>("family");
  const [op, setOp] = useState<Op>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [proseDraft, setProseDraft] = useState(draft?.prose ?? "");
  const [titleDraft, setTitleDraft] = useState(draft?.title ?? "");

  // ── Optimistic review-pending state ─────────────────────────────────────────
  // Set the instant recording stops (or a typed telling is submitted): a local object URL of the
  // take (empty for text — there is no audio), shown with a polishing spinner while
  // composeStoryAction runs. Discarded when the draft prop arrives (keyed remount).
  const [localTake, setLocalTake] = useState<{ url: string } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  // Abort the processing poll if this instance unmounts (e.g. the keyed remount into review-ready).
  const pollAbortRef = useRef<AbortController | null>(null);

  // ── Follow-up thread state ──────────────────────────────────────────────────
  // `followUp` holds the interviewer's current follow-up prompt (null = not in a follow-up). The
  // active storyId is carried across takes here — the first `ready`/`follow_up` step supplies it,
  // and every follow-up take posts against it (draft.storyId only exists in the review phase).
  const [followUp, setFollowUp] = useState<{ prompt: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);

  // Revoke the object URL when localTake changes or the component unmounts (the remount into
  // review-ready unmounts this instance), so we don't leak blob URLs. Also abort any in-flight poll.
  useEffect(() => {
    if (!localTake) return;
    return () => {
      if (localTake.url) URL.revokeObjectURL(localTake.url);
      pollAbortRef.current?.abort();
    };
  }, [localTake]);

  const recordAgain = useCallback(() => {
    setPendingError(null);
    pollAbortRef.current?.abort();
    setLocalTake(null); // triggers the effect cleanup above → revokes the URL
    setRecordPhase("idle");
  }, []);

  // ── Thread-step router ──────────────────────────────────────────────────────
  // Central interpreter for every ThreadStep a record/follow-up/finish/drop action resolves to.
  // Branches on `kind` BEFORE touching `storyId` (the `discarded` variant has none). This is the
  // single place that decides what screen comes next:
  //   - error      → surface it (stay on the current screen; pending screen shows it if a take is up)
  //   - follow_up  → show the follow-up prompt (carry the active storyId)
  //   - discarded  → the whole draft is gone → back to the hub
  //   - ready      → thread finished + stitched → poll processing, then refresh into review
  const handleStep = useCallback(
    async (step: ThreadStep) => {
      if ("error" in step) {
        setPendingError(step.error);
        setRecordPhase("idle");
        return;
      }
      if (step.kind === "follow_up") {
        setActiveStoryId(step.storyId);
        setLocalTake(null); // clear the optimistic in-flight take → show the follow-up screen
        setFollowUp({ prompt: step.prompt });
        setRecordPhase("idle");
        return;
      }
      if (step.kind === "discarded") {
        router.push(backTab);
        return;
      }
      // step.kind === "ready" — thread complete + stitched. The story may still be rendering
      // out-of-band (prod durable queue) or be ready already (dev/CI synchronous dispatch). Poll the
      // viewer-scoped status, keeping the optimistic local-audio "Polishing…" screen up meanwhile. On
      // ready, router.refresh() pulls the pending_approval draft (with prose) → the keyed remount
      // swaps in the review editor. On the soft cap, show a warm "taking longer" message (never hang).
      setActiveStoryId(step.storyId);
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const outcome = await pollUntilReady({
        getStatus: async () => {
          const status = await getAnswerStatusAction(step.storyId);
          if ("error" in status) throw new Error(status.error);
          return status.status;
        },
        signal: controller.signal,
      });
      if (outcome === "ready") {
        router.refresh();
      } else if (outcome === "timeout") {
        setPendingError(hub.answer.takingLonger);
      }
      // "aborted" → the component unmounted; do nothing.
    },
    [router, backTab],
  );

  // ── Capture phase handlers ──────────────────────────────────────────────────
  const uploadRecording = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      // Show the review-pending screen immediately, playing the take from a local object URL, while
      // the server action (ingest → transcribe → evaluate/render) runs below.
      setPendingError(null);
      setLocalTake({ url: URL.createObjectURL(blob) });

      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      // A follow-up take posts against the active story; the initial answer posts against the ask
      // (when there is one) via the ask-optional compose front door.
      let result: ThreadStep;
      if (followUp && activeStoryId) {
        form.append("storyId", activeStoryId);
        result = await recordFollowUpTakeAction(form);
      } else {
        if (ask) form.append("askId", ask.id);
        result = await composeStoryAction(form);
      }
      await handleStep(result);
    } catch {
      setPendingError(hub.answer.genericError);
    }
  }, [ask, followUp, activeStoryId, handleStep]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: pickMimeType() });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => void uploadRecording();
      mediaRecorderRef.current = mr;
      mr.start();
      setRecordPhase("listening");
    } catch {
      setRecordPhase("softfail");
    }
  }, [uploadRecording]);

  const stopRecording = useCallback(() => {
    setRecordPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  // Voice-button click: start when idle, stop when listening, no-op while saving (the button is
  // blocked then anyway). Shared by the record phase and the follow-up screen.
  const voiceClick = useCallback(() => {
    if (recordPhase === "listening") stopRecording();
    else if (recordPhase === "idle") void startRecording();
  }, [recordPhase, startRecording, stopRecording]);

  // Submit a typed telling (ADR-0007 text story). Reuses the optimistic pending screen (no audio
  // url); composeStoryAction takes the text branch (ingestTextStory → render), then handleStep polls
  // + refreshes into review — the same downstream path as the voice take.
  const submitText = useCallback(async () => {
    if (textDraft.trim().length === 0) return;
    try {
      setPendingError(null);
      setLocalTake({ url: "" }); // reuse the pending screen; no audio to play back for text
      const form = new FormData();
      form.set("text", textDraft.trim());
      if (ask) form.set("askId", ask.id);
      const step = await composeStoryAction(form);
      await handleStep(step);
    } catch {
      setPendingError(hub.answer.genericError);
    }
  }, [textDraft, ask, handleStep]);

  // ── Follow-up finish handler ────────────────────────────────────────────────
  // "That's all for now" — decline the current follow-up and finish the thread (a first-class path,
  // never a dead end). finishThreadAction stitches the takes so far → the resulting `ready` step
  // polls + refreshes into the (multi-take) review phase.
  const onFinish = useCallback(async () => {
    if (!activeStoryId) return;
    setPendingError(null); // clear any prior finish error before retrying
    setFinishing(true);
    try {
      const form = new FormData();
      form.set("storyId", activeStoryId);
      const step = await finishThreadAction(form);
      await handleStep(step);
    } catch {
      setPendingError(hub.answer.genericError);
    } finally {
      setFinishing(false);
    }
  }, [activeStoryId, handleStep]);

  // ── Review phase handlers ───────────────────────────────────────────────────
  const handleShare = async () => {
    setActionError(null);
    setOp("share");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      form.append("audienceTier", tier);
      if (proseDraft !== draft!.prose) {
        form.append("correctedProse", proseDraft);
      }
      // Send an edited title only when the narrator actually changed it (empty/unchanged → the
      // server leaves the AI-derived title as-is).
      if (titleDraft.trim() && titleDraft.trim() !== draft!.title) {
        form.append("correctedTitle", titleDraft.trim());
      }
      const result = await shareAnswerAction(form);
      if (result?.error) {
        setActionError(result.error);
        setOp(null);
      }
      // On success the server action calls redirect("/hub") — navigation happens automatically.
    } catch {
      setActionError(hub.answer.genericError);
      setOp(null);
    }
  };

  const handleReRecord = async () => {
    setActionError(null);
    setOp("rerecord");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      const result = await discardAnswerAction(form);
      if (result?.error) {
        // The draft was NOT removed — stay put. Switching to the record phase here would tell
        // the narrator their take is gone while it silently survives as an orphan.
        setActionError(result.error);
        setOp(null);
        return;
      }
      router.refresh(); // discard succeeded → server re-renders with draft=null → record phase
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  const handleDiscard = async () => {
    setActionError(null);
    setOp("discard");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      const result = await discardAnswerAction(form);
      if (result?.error) {
        // The draft was NOT removed — do not navigate away as if it had been (would leave a
        // permanent orphan the narrator believes is discarded).
        setActionError(result.error);
        setOp(null);
        return;
      }
      router.push(backTab);
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  // Drop one take from a multi-take thread. Dropping the initial take (position 0) discards the
  // whole thread server-side (→ `discarded` → hub); dropping a follow-up take re-stitches the
  // survivors (→ `ready` → re-poll + refresh into the updated review). A hard failure surfaces the
  // error inline (never a silent dead end); non-error steps are delegated to handleStep.
  const handleDropTake = async (position: number) => {
    setActionError(null);
    setOp("drop");
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      form.append("position", String(position));
      const result = await dropTakeAction(form);
      if ("error" in result) {
        setActionError(result.error);
        setOp(null);
        return;
      }
      await handleStep(result);
      // Reset op like the sibling handlers. A drop does NOT change storyId, so the review is NOT
      // remounted by the `key={draft.storyId}` on the ready path — without this, isRemoving stays
      // true and Share/re-record/discard/drop are all disabled forever. Harmless on the discarded
      // (position 0) path since handleStep has already navigated away.
      setOp(null);
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  // ── Shared question header ──────────────────────────────────────────────────
  // Rendered only in answer mode (an ask is present). A self-initiated telling has no question, so
  // the header is null and the capture phase shows a warm tell-prompt instead.
  const questionHeader = ask ? (
    <div style={{ marginBottom: 32, textAlign: "center" }}>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          color: "var(--text-meta)",
          letterSpacing: "var(--tracking-mono)",
          margin: "0 0 10px",
        }}
      >
        {hub.answer.askedBy(ask.askerName)}
      </p>
      <p
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "clamp(1.35rem, 3.5vw, var(--text-story-lg))",
          lineHeight: "var(--leading-snug)",
          color: "var(--text-body)",
          margin: 0,
          maxWidth: "28ch",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {ask.questionText}
      </p>
    </div>
  ) : null;

  // ── REVIEW PHASE ────────────────────────────────────────────────────────────
  if (draft) {
    // Sharing: show a warm interstitial while the pipeline runs
    if (op === "share") {
      return (
        <div
          aria-live="polite"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "clamp(1.5rem, 4vw, 32px)",
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            {hub.answer.assembling}
          </p>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              margin: 0,
            }}
          >
            {hub.answer.assemblingSub}
          </p>
        </div>
      );
    }

    const isRemoving = op === "rerecord" || op === "discard" || op === "drop";

    return (
      <div>
        {questionHeader}

        {/* Recorded timestamp */}
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: "var(--text-meta)",
            letterSpacing: "var(--tracking-mono)",
            textAlign: "center",
            margin: "0 0 20px",
          }}
        >
          {hub.answer.recordedAt(relativeShortDate(draft.recordedAt))}
        </p>

        {/* Relisten. A thread-of-one keeps the original single-take control (backward-compatible);
            a multi-take thread lists each take with its own relisten + a drop for follow-up takes.
            A text story has no audio (takes: [], mediaUrl: "") → the audio block is omitted. */}
        {draft.takes.length > 1 ? (
          <div style={{ margin: "0 auto 32px", maxWidth: 480 }}>
            {draft.takes.map((take) => (
              <div key={take.position} style={{ marginBottom: 20 }}>
                <p
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--support)",
                    margin: "0 0 8px",
                  }}
                >
                  {take.isInitial ? hub.answer.initialAnswerLabel : hub.answer.followUpTakeLabel}
                </p>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  controls
                  src={take.mediaUrl}
                  style={{
                    width: "100%",
                    display: "block",
                    borderRadius: "var(--radius-md)",
                  }}
                />
                {!take.isInitial && (
                  <div style={{ marginTop: 8, textAlign: "right" }}>
                    <KindredButton
                      label={hub.answer.dropTake}
                      variant="ghost"
                      size="small"
                      disabled={isRemoving}
                      onClick={() => handleDropTake(take.position)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : draft.mediaUrl ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <audio
            controls
            src={draft.mediaUrl}
            style={{
              width: "100%",
              maxWidth: 480,
              display: "block",
              margin: "0 auto 32px",
              borderRadius: "var(--radius-md)",
            }}
          />
        ) : null}

        {/* Editable title — prepopulated from the AI-derived title, saved on Share only if changed. */}
        <div style={{ marginBottom: 24 }}>
          <label className="kin-form-label">
            {hub.compose.titleLabel}
            <input
              type="text"
              className="kin-field"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              disabled={isRemoving}
            />
          </label>
        </div>

        {/* Read + edit the polished prose before sharing */}
        <div style={{ marginBottom: 32 }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              margin: "0 0 14px",
            }}
          >
            {hub.answer.reviewYourWords}
          </p>
          <KindredProseEditor
            value={proseDraft}
            onChange={setProseDraft}
            disabled={isRemoving}
            historyKey={draft.storyId}
            labels={common.proseEditor}
            onPolish={async (text) => {
              const form = new FormData();
              form.append("prose", text);
              form.append("promptQuestion", ask?.questionText ?? "");
              // Slice 2: the story exists in the review phase, so bind the polish to it — the action
              // persists every real polish via logPolish (an ai_polished revision + stories.prose).
              form.append("storyId", draft.storyId);
              const res = await polishAnswerProseAction(form);
              if ("error" in res) throw new Error(res.error);
              return res.prose;
            }}
          />
        </div>

        {/* Tier picker (mirrors ApprovalRecorder) */}
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 32px" }}>
          <legend
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              marginBottom: 14,
              display: "block",
              width: "100%",
            }}
          >
            {hub.answer.whoShouldHear}
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {TIER_ORDER.map((value) => {
              const opt = common.audienceTiers[value];
              const checked = tier === value;
              return (
                <label
                  key={value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    width: "100%",
                    padding: "16px 20px",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    transition: "background var(--dur-fade)",
                    background: checked ? "var(--accent-soft)" : "var(--surface-card)",
                    border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                    boxSizing: "border-box",
                  }}
                >
                  <input
                    type="radio"
                    name="audienceTier"
                    value={value}
                    checked={checked}
                    onChange={() => setTier(value)}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                  />
                  {/* Radio dot */}
                  <span
                    style={{
                      flex: "0 0 auto",
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: `2px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
                      background: checked ? "var(--accent)" : "transparent",
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "var(--accent-on)",
                        opacity: checked ? 1 : 0,
                        transition: "opacity var(--dur-fade)",
                      }}
                    />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--text-ui)",
                        fontWeight: 600,
                        color: "var(--text-body)",
                      }}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "var(--text-label)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {opt.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Error */}
        {actionError && (
          <p
            aria-live="polite"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-danger, #b00)",
              margin: "0 0 16px",
              textAlign: "center",
            }}
          >
            {actionError}
          </p>
        )}

        {/* Share */}
        <div style={{ marginBottom: 14 }}>
          <KindredButton
            label={hub.answer.shareWithFamily}
            variant="primary"
            size="large"
            fullWidth
            disabled={isRemoving}
            onClick={handleShare}
          />
        </div>

        {/* Re-record / Discard row */}
        <div style={{ display: "flex", gap: 12 }}>
          <KindredButton
            label={hub.answer.reRecord}
            variant="secondary"
            size="small"
            fullWidth
            disabled={isRemoving}
            onClick={handleReRecord}
          />
          <KindredButton
            label={hub.answer.discard}
            variant="ghost"
            size="small"
            fullWidth
            disabled={isRemoving}
            onClick={handleDiscard}
          />
        </div>
      </div>
    );
  }

  // ── REVIEW-PENDING PHASE ────────────────────────────────────────────────────
  // Captured locally; render is in flight (or failed). Shown until the draft prop arrives. A typed
  // telling has no audio url — the pending screen still shows the polishing spinner + message.
  if (localTake) {
    return (
      <AnswerReviewPending
        audioUrl={localTake.url}
        error={pendingError}
        onRecordAgain={recordAgain}
        header={questionHeader}
      />
    );
  }

  // ── RECORD PHASE (soft mic failure) ─────────────────────────────────────────
  if (recordPhase === "softfail") {
    return (
      <div style={{ textAlign: "center" }}>
        {questionHeader}
        <p
          aria-live="polite"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 auto",
            maxWidth: 360,
          }}
        >
          {hub.answer.micError}
        </p>
      </div>
    );
  }

  // ── FOLLOW-UP PHASE ─────────────────────────────────────────────────────────
  // The interviewer proposed a deepening question. Shown after the record/pending/softfail branches
  // so the optimistic in-flight take (localTake) still owns the window between stopping a follow-up
  // recording and the next step resolving. recordPhase is narrowed to non-"softfail" here.
  if (followUp) {
    return (
      <FollowUpPrompt
        prompt={followUp.prompt}
        recordPhase={recordPhase}
        onVoiceClick={voiceClick}
        onFinish={onFinish}
        finishing={finishing}
        error={pendingError ?? undefined}
      />
    );
  }

  // ── CAPTURE PHASE (initial voice⇄text capture) ──────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 32,
      }}
    >
      {questionHeader}
      {/* Tell mode has no question header — show a warm prompt so the capture screen isn't blank. */}
      {!ask && (
        <p
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "clamp(1.35rem, 3.5vw, var(--text-story-lg))",
            lineHeight: "var(--leading-snug)",
            color: "var(--text-body)",
            margin: 0,
            maxWidth: "24ch",
            textAlign: "center",
          }}
        >
          {hub.compose.tellPrompt}
        </p>
      )}

      {/* Voice⇄text toggle — speak (canonical) or type it (ADR-0007 text story). */}
      <div
        role="group"
        aria-label={hub.compose.inputModeAria}
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          borderRadius: "var(--radius-pill)",
          background: "var(--surface-card)",
          border: "var(--border-width) solid var(--border)",
        }}
      >
        <ToggleOption
          label={hub.compose.speak}
          active={inputMode === "voice"}
          onClick={() => setInputMode("voice")}
        />
        <ToggleOption
          label={hub.compose.typeIt}
          active={inputMode === "text"}
          onClick={() => setInputMode("text")}
        />
      </div>

      {inputMode === "voice" ? (
        <>
          <KindredVoiceButton
            listening={recordPhase === "listening"}
            saving={recordPhase === "saving"}
            size={220}
            label={
              recordPhase === "listening"
                ? hub.answer.listeningTapStop
                : recordPhase === "saving"
                  ? common.voiceButton.oneMoment
                  : common.voiceButton.tapToSpeak
            }
            onClick={voiceClick}
          />
          {recordPhase === "idle" && (
            <p
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-sm)",
                color: "var(--text-meta)",
                margin: 0,
                textAlign: "center",
                maxWidth: 300,
              }}
            >
              {hub.answer.takeYourTime}
            </p>
          )}
        </>
      ) : (
        <div style={{ width: "100%", maxWidth: 480 }}>
          <label className="kin-form-label">
            {hub.compose.textareaLabel}
            <textarea
              className="kin-field"
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              rows={8}
              placeholder={hub.compose.textPlaceholder}
            />
          </label>
          <div style={{ marginTop: 16 }}>
            <KindredButton
              label={hub.compose.continueLabel}
              variant="primary"
              size="large"
              fullWidth
              disabled={textDraft.trim().length === 0}
              onClick={submitText}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Capture-mode toggle option ────────────────────────────────────────────── */
function ToggleOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        minHeight: 36,
        padding: "0 18px",
        borderRadius: "var(--radius-pill)",
        border: "none",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent-on)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-ui-sm)",
        fontWeight: 600,
        cursor: "pointer",
        transition: "background var(--dur-fade), color var(--dur-fade)",
      }}
    >
      {label}
    </button>
  );
}
