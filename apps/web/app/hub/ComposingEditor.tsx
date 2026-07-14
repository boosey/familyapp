"use client";

/**
 * ComposingEditor — the live story-composing surface (ADR-0014 Inc 3 slice 10, phase collapse).
 *
 * Extracted from the old two-phase `StoryComposer` (RESOLVED DECISION (b)). `StoryComposer` is now a
 * thin answer/tell chrome wrapper that mounts this; Inc 4's `AboutYouFlow` will mount it too (that is
 * why the extraction happens now — the intake surface reuses this exact editor). Intake-specific
 * behaviour (Save-at-anchor-extraction instead of Share) lands in Inc 4; today only the story path is
 * wired, so there is no `mode` branch yet — the seam is the component boundary itself.
 *
 * THREE phases, keyed on the story's lifecycle STATE (not on presence/absence of a draft):
 *
 *   1. no-draft            — voice⇄text capture entry (record/type take 0). `draft == null`.
 *   2. draft (composing)   — the live surface: the prose editor is ALWAYS mounted (undo/redo + ✨Polish)
 *                            with a persistent capture footer (mic + type box, both live → append more
 *                            takes), a compact per-take relisten strip, an inline follow-up banner, and
 *                            the Finish button. `draft.state === "draft"` OR, before the first refresh,
 *                            the client-optimistic `activeStoryId` (a take-0 follow_up arrives here
 *                            before any server prop).
 *   3. pending_approval    — shrunk review: confirm title + pick tier + Share/Discard (+ optional
 *                            ✨Polish). NO live append. `draft.state === "pending_approval"`.
 *
 * The editor stays mounted across appends and across the draft→pending_approval boundary (the page keys
 * on `draft.storyId`, stable within a compose session), so unsaved hand-edits are never remounted away.
 * Every append/Finish posts the client's CURRENT editor text as `prose`/`priorProse` (the server
 * concatenates onto IT, never a fresh `stories.prose` read) — the non-clobbering discipline ADR-0014
 * exists to enforce (§6). The old "Polishing your words…" poll gate is gone: each take is one
 * synchronous round-trip returning the new prose.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KindredVoiceButton, KindredButton } from "@/app/_kindred";
import { hub, common } from "@/app/_copy";
import { relativeShortDate } from "@/lib/relative-time";
import {
  composeStoryAction,
  recordFollowUpTakeAction,
  appendTypedTakeAction,
  declineFollowUpAction,
  finishDraftAction,
  dropTakeAction,
  shareAnswerAction,
  discardAnswerAction,
  polishAnswerProseAction,
  type ThreadStep,
} from "./answer/[askId]/actions";
import { useProseHistory } from "@/lib/use-prose-history";
import { clog } from "@/lib/clog";
import { AnswerReviewPending } from "./answer/[askId]/AnswerReviewPending";
import { ProseBlock } from "./_composing/ProseBlock";
import { StoryPhotosEditor } from "./StoryPhotosEditor";
import { FamilyPicker } from "./FamilyPicker";
import { TagInput } from "./TagInput";
import { loadTagSuggestionsAction } from "./tag-suggestions-actions";
import type { TagSuggestions, TagToken } from "./tag-input-types";
import {
  editStoryDetailsAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
} from "./stories/[id]/actions";

type RecordPhase = "idle" | "listening" | "saving" | "softfail";
type Tier = "family" | "branch" | "public";
type Op = "share" | "discard" | "drop" | null;
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
  /**
   * Lifecycle state of the resumed story. `draft` = the live composing surface; `pending_approval` =
   * ready for the owner's review. The rendered phase keys off this (ADR-0014 Inc 3 slice 10).
   */
  state: "draft" | "pending_approval";
  takes: TakeInfo[];
}

export interface ComposingEditorProps {
  /** The ask being answered (answer mode) or `null` for a self-initiated telling (tell mode). Drives
   * the question header + seeds the follow-up evaluator's prompt on Finish. */
  ask?: { id: string; questionText: string; askerName: string } | null;
  draft: DraftInfo | null;
  /** Where a discard navigates (Stories vs Questions tab) — the caller owns the answer/tell chrome. */
  backTab: string;
  /**
   * How to build the resume URL for a freshly-created story (ADR-0014 Inc 3 slice 10). Some entry
   * surfaces cannot server-drive the draft after take 0 by a plain `router.refresh()`: `/hub/tell`
   * has no ask/story id in its URL to re-query by, so a refresh keeps returning `draft = null` and the
   * client-optimistic session would never reach the review phase. When provided, the FIRST take on a
   * draft-less surface navigates to `resumeHref(storyId)` (e.g. `/hub/tell/[storyId]`), which loads the
   * story and server-drives the rest. When ABSENT (e.g. `/hub/answer/[askId]`, which re-queries its
   * draft by `askId`), a `router.refresh()` on the same URL is enough — this preserves client state
   * like the follow-up banner across the transition.
   */
  resumeHref?: (storyId: string) => string;
  /**
   * ADR-0009 Phase 3 "tell the story of this photo" (story mode only). The album photo this telling
   * is ABOUT — carried as a client hint into `composeStoryAction` at take 0 (the server re-resolves
   * auth; the core write gate re-checks the owner can see it) and shown above the capture prompt.
   * Null/absent for an answer, a plain telling, or intake.
   */
  subjectPhotoId?: string | null;
  /**
   * Phase C bulk "tell one story about these N photos". The NON-cover selected photo ids, carried to
   * the photos editor (mounted in the review phase, once the draft exists) which auto-attaches each as
   * an accompaniment image via the SAME `attachStoryPhotoAction` the manual picker uses. Ids already
   * attached (notably the cover `subjectPhotoId`) are skipped — no double-attach. Empty for the
   * ordinary single-photo / plain telling.
   */
  extraSubjectPhotoIds?: string[];
  /** ADR-0009 Phase 3: the caption-derived prompt shown for a tell-a-photo telling (and stored). */
  promptQuestion?: string | null;
  /** The narrator's active families, offered in the share-step multi-family picker (Task 4). Shown
   * only for a multi-family author (length > 1) on the family/branch tiers. */
  families?: { familyId: string; familyName: string }[];
  /** Family ids pre-checked in the picker, seeded from the hub scope (or ask ∩ active for answers). */
  seededFamilyIds?: string[];
  /** True when the narrator must explicitly pick ≥1 family (ambiguous "all"-with-several). */
  familyChoiceRequired?: boolean;
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

export function ComposingEditor({
  ask = null,
  draft,
  backTab,
  resumeHref,
  subjectPhotoId = null,
  extraSubjectPhotoIds = [],
  promptQuestion = null,
  families = [],
  seededFamilyIds = [],
  familyChoiceRequired = false,
}: ComposingEditorProps) {
  const router = useRouter();

  // ── Capture / footer state ──────────────────────────────────────────────────
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("idle");
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [textDraft, setTextDraft] = useState("");
  const [appending, setAppending] = useState(false); // typed-append round-trip in flight (inline)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Prose + review state ────────────────────────────────────────────────────
  const [proseDraft, setProseDraft] = useState(draft?.prose ?? "");
  const [titleDraft, setTitleDraft] = useState(draft?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(false);
  const [tier, setTier] = useState<Tier>("family");
  // Share-step multi-family target (Task 4). Seeded from the hub scope / ask families; only surfaced
  // for a multi-family author on the family/branch tiers (see `showFamilyPicker`).
  const [pickedFamilies, setPickedFamilies] = useState<Set<string>>(() => new Set(seededFamilyIds));
  const toggleFamily = (id: string) =>
    setPickedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const showFamilyPicker = families.length > 1 && (tier === "family" || tier === "branch");

  const [op, setOp] = useState<Op>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Non-error transient notice (decision d): shown after a follow-up take's audio is removed — the
  // take's words stay in the working prose on purpose, so this tells the narrator to edit them out.
  const [dropNotice, setDropNotice] = useState<string | null>(null);

  // ── Finish-check offer (ADR-0014 Inc 3 slice 8) ─────────────────────────────
  const [finishOffer, setFinishOffer] = useState<{
    storyId: string;
    polished: string;
    polishModelId: string;
    polishPromptText: string;
  } | null>(null);
  const [finishingDraft, setFinishingDraft] = useState(false);
  // A ✨Polish tap is round-tripping. The tap lives inside KindredProseEditor (which tracks its own
  // in-flight flag for the button label), but the PARENT must also know: a slow Polish resolving after a
  // concurrent append/Finish would history.replace() stale text over the newer prose (a clobber, and a
  // DB one too since logPolish has no staleness guard). So `polishHandler` raises this and it joins the
  // unified mutation lock — during a Polish nothing else may start, and Polish can't start during them.
  const [polishing, setPolishing] = useState(false);

  // ── Optimistic initial-capture (take 0) state ───────────────────────────────
  // Set the instant the FIRST recording stops (or a typed telling is submitted): a local object URL
  // of the take, shown with a "Polishing…" screen while composeStoryAction runs. Only used for take 0
  // (there is no mounted editor yet); appends within the composing surface use an inline indicator.
  const [localTake, setLocalTake] = useState<{ url: string } | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // ── Follow-up thread state ──────────────────────────────────────────────────
  // The interviewer's current follow-up prompt (null = not in a follow-up), shown as an inline banner
  // in the composing surface. The active storyId is carried across takes for the optimistic window
  // before the first refresh (draft.storyId only exists once the server prop lands).
  const [followUp, setFollowUp] = useState<{ prompt: string } | null>(null);
  const [declining, setDeclining] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null);

  // The id every append/Finish posts against: the server draft once it lands, else the optimistic id.
  const composingStoryId = draft?.storyId ?? activeStoryId;

  // ── Unified TagInput (compose review) ───────────────────────────────────────
  // Text/person tokens autosave immediately via the existing story-detail actions; family tokens do
  // NOT share here (nothing is shared until Finish/Share) — adding one just toggles it into the
  // EXISTING `pickedFamilies` set that the FamilyPicker above already reads, so it shows up
  // pre-selected there. No window.confirm on family removal in compose (see spec §2).
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestions>({ people: [], families: [], tags: [] });
  // Seeded from `suggestions.tags` once loaded (those are the story's EXISTING tags per
  // loadTagSuggestionsAction) so resuming a review session with prior tags shows them as chips.
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftPeople, setDraftPeople] = useState<{ personId: string; displayName: string }[]>([]);
  const tagsSeededRef = useRef(false);
  const lastSavedTagsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!composingStoryId) return;
    void loadTagSuggestionsAction(composingStoryId).then((res) => {
      if ("error" in res) return;
      setTagSuggestions(res);
      if (!tagsSeededRef.current) {
        tagsSeededRef.current = true;
        setDraftTags(res.tags);
        lastSavedTagsRef.current = res.tags.join(","); // seed = already-saved; don't re-POST it
      }
    });
  }, [composingStoryId]);

  const composeTokens: TagToken[] = useMemo(
    () => [
      ...draftTags.map((value): TagToken => ({ kind: "text", value })),
      ...draftPeople.map((p): TagToken => ({ kind: "person", personId: p.personId, displayName: p.displayName })),
      ...families
        .filter((f) => pickedFamilies.has(f.familyId))
        .map((f): TagToken => ({ kind: "family", familyId: f.familyId, name: f.familyName })),
    ],
    [draftTags, draftPeople, families, pickedFamilies],
  );

  // Text tags write through editStoryDetailsAction, which requires a NON-EMPTY title. During compose
  // the title may still be empty (the narrator hasn't reached the title field yet in some flows), so
  // when it's empty we keep the tag in local state only (the chip still shows, nothing is lost) and
  // rely on this effect to flush it once a title exists. This is the title-gating this task's spec
  // calls out as the key risk; see the task report for why this approach was chosen over threading
  // tags through the Share/Finish FormData (those actions don't accept a `tags` field).
  const effectiveReviewTitle = titleTouched ? titleDraft : (draft?.title ?? "");
  useEffect(() => {
    if (!composingStoryId) return;
    if (!effectiveReviewTitle.trim()) return;
    const csv = draftTags.join(",");
    if (lastSavedTagsRef.current === csv) return;
    lastSavedTagsRef.current = csv;
    const fd = new FormData();
    fd.set("storyId", composingStoryId);
    fd.set("title", effectiveReviewTitle.trim());
    fd.set("tags", csv);
    void editStoryDetailsAction(fd);
  }, [composingStoryId, effectiveReviewTitle, draftTags]);

  const onTagAdd = (token: TagToken) => {
    if (token.kind === "family") {
      toggleFamily(token.familyId);
      return;
    }
    if (token.kind === "text") {
      setDraftTags((prev) => (prev.includes(token.value) ? prev : [...prev, token.value]));
      return;
    }
    // person
    if (token.personId) {
      const personId = token.personId;
      setDraftPeople((prev) => [...prev, { personId, displayName: token.displayName }]);
      if (!composingStoryId) return;
      const fd = new FormData();
      fd.set("storyId", composingStoryId);
      fd.set("personId", personId);
      void tagStorySubjectAction(fd).then((res) => {
        if (res && "error" in res) setDraftPeople((prev) => prev.filter((p) => p.personId !== personId));
      });
    } else {
      const tempKey = `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const displayName = token.displayName;
      setDraftPeople((prev) => [...prev, { personId: tempKey, displayName }]);
      if (!composingStoryId) return;
      const fd = new FormData();
      fd.set("storyId", composingStoryId);
      fd.set("newPersonDisplayName", displayName);
      void tagStorySubjectAction(fd).then((res) => {
        if (res && "error" in res) {
          setDraftPeople((prev) => prev.filter((p) => p.personId !== tempKey));
          return;
        }
        if (res && "personId" in res && res.personId) {
          const realId = res.personId;
          setDraftPeople((prev) =>
            prev.map((p) => (p.personId === tempKey ? { personId: realId, displayName } : p)),
          );
        }
      });
    }
  };

  const onTagRemove = (token: TagToken) => {
    if (token.kind === "family") {
      // No confirm here — nothing is shared until Finish (spec §2). Just toggle it back off.
      toggleFamily(token.familyId);
      return;
    }
    if (token.kind === "text") {
      setDraftTags((prev) => prev.filter((t) => t !== token.value));
      return;
    }
    const personId = token.personId;
    setDraftPeople((prev) => prev.filter((p) => p.personId !== personId));
    if (!composingStoryId || !personId) return;
    const fd = new FormData();
    fd.set("storyId", composingStoryId);
    fd.set("personId", personId);
    void untagStorySubjectAction(fd);
  };

  // A NON-recording mutation is round-tripping (typed append, decline, Finish, or ✨Polish). No new
  // recording may START while one is in flight (cold-review findings 3+4+5): the mic is otherwise ungated
  // by these flags, so a decline/finish/polish racing a mic-start could reset recordPhase under a live
  // MediaRecorder or let a fresh take/edit clobber the in-flight write. (Recording states —
  // listening/saving — are handled via recordPhase; this covers only the non-recording mutations so the
  // mic can still STOP while listening.) This enumeration is now exhaustive over the mutation entry points.
  const otherMutationInFlight = appending || declining || finishingDraft || polishing;

  // ── Lifted prose history ────────────────────────────────────────────────────
  // Owned HERE (not inside KindredProseEditor) so an append can seed the prose as one undoable step via
  // `history.replace` — an event the editor doesn't emit. resetKey is the STABLE `draft?.storyId`: within
  // one compose session it never churns (the page keys on it, so the ONLY remount is no-draft→draft at
  // take 0, where re-seeding from draft.prose is correct). The hook returns a MEMOIZED handle (slice 10
  // forward-risk (iii)), so putting it in callback deps below doesn't churn them each render.
  const history = useProseHistory(proseDraft, setProseDraft, draft?.storyId);

  // Revoke the object URL when localTake changes or the component unmounts.
  useEffect(() => {
    if (!localTake) return;
    return () => {
      if (localTake.url) URL.revokeObjectURL(localTake.url);
    };
  }, [localTake]);

  // Invalidate a live Finish-check offer on ANY prose edit (slice 8 data-loss fix). The polished text
  // reflects the prose AT PROBE TIME; if the narrator keeps typing, accepting it would drop the new
  // words. The functional setter makes it a no-op when no offer is up, so it never fires on the append
  // path's `history.replace` seeding (finishOffer is null then).
  useEffect(() => {
    setFinishOffer((cur) => (cur ? null : cur));
  }, [proseDraft]);

  const recordAgain = useCallback(() => {
    setPendingError(null);
    setLocalTake(null); // triggers the effect cleanup above → revokes the URL
    setRecordPhase("idle");
  }, []);

  // ── Thread-step router ──────────────────────────────────────────────────────
  // Server-drive the surface after a mutation: on a draft-less entry surface with a `resumeHref` (fresh
  // `/hub/tell`), the FIRST created story navigates to its resume URL (which loads the draft); otherwise
  // a same-URL refresh re-drives it (and preserves client state like the follow-up banner).
  const settle = useCallback(
    (storyId: string) => {
      if (draft == null && resumeHref) router.replace(resumeHref(storyId));
      else router.refresh();
    },
    [draft, resumeHref, router],
  );

  // Central interpreter for every ThreadStep an append/decline/finish/drop action resolves to.
  const handleStep = useCallback(
    async (step: ThreadStep) => {
      if ("error" in step) {
        setPendingError(step.error);
        setRecordPhase("idle");
        setAppending(false);
        return;
      }
      if (step.kind === "follow_up") {
        // The interviewer proposed a deepening question. Seed the just-appended prose into the mounted
        // editor OPTIMISTICALLY and show the inline banner — do NOT refresh (a remount would wipe the
        // client `followUp` banner; the take-0 follow_up arrives before any server draft prop).
        clog("follow_up_proposed", {
          story: step.storyId,
          appended: step.appendedSegment !== "",
        });
        setActiveStoryId(step.storyId);
        history.replace(step.prose);
        setLocalTake(null);
        setFollowUp({ prompt: step.prompt });
        setRecordPhase("idle");
        setAppending(false);
        return;
      }
      if (step.kind === "discarded") {
        router.push(backTab);
        return;
      }
      if (step.kind === "finish_offer") {
        setFinishOffer({
          storyId: step.storyId,
          polished: step.polished,
          polishModelId: step.polishModelId,
          polishPromptText: step.polishPromptText,
        });
        return;
      }
      if (step.kind === "finished") {
        // Draft sealed → pending_approval. Settle surfaces the (shrunk) review phase — a refresh in
        // place when the page server-drives (storyId stable → no remount → proseDraft carries over as
        // the finalText), or a navigate to the resume URL on a draft-less surface.
        setFinishOffer(null);
        setFollowUp(null);
        settle(step.storyId);
        return;
      }
      if (step.kind === "appended") {
        // A take (voice/typed) was appended, OR a follow-up was declined. Clear any follow-up banner
        // (fix (ii): stale prompt after an append). An EMPTY appendedSegment is a decline — skip the
        // `history.replace` (fix (i): it would clobber unsaved hand-edits) and skip the refresh (a
        // remount would re-seed from stale server prose). A real take refreshes so its audio shows in
        // the relisten strip; the storyId is stable so that refresh does NOT remount the editor.
        clog("take_appended", {
          story: step.storyId,
          // Empty segment = a decline echo, not a real appended take.
          appended: step.appendedSegment !== "",
        });
        setActiveStoryId(step.storyId);
        setFollowUp(null);
        setLocalTake(null);
        setPendingError(null);
        setRecordPhase("idle");
        setAppending(false);
        if (step.appendedSegment !== "") {
          history.replace(step.prose);
          settle(step.storyId);
        }
        return;
      }
    },
    [router, backTab, history, settle],
  );

  // ── Recording lifecycle ─────────────────────────────────────────────────────
  const uploadRecording = useCallback(async () => {
    try {
      const type = mediaRecorderRef.current?.mimeType ?? "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      setPendingError(null);

      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      if (composingStoryId) {
        // Append a voice take onto the existing draft — inline (the editor stays mounted; no
        // full-screen pending). §6: post the client's CURRENT editor text so the server concatenates
        // onto it (non-clobbering).
        form.append("storyId", composingStoryId);
        form.append("prose", proseDraft);
        const result = await recordFollowUpTakeAction(form);
        await handleStep(result);
      } else {
        // Initial capture (take 0): show the full-screen "Polishing…" screen while the action runs.
        setLocalTake({ url: URL.createObjectURL(blob) });
        if (ask) form.append("askId", ask.id);
        // ADR-0009 Phase 3 tell-a-photo hints (story mode); the server re-checks auth + visibility.
        if (subjectPhotoId) form.append("subjectPhotoId", subjectPhotoId);
        if (promptQuestion) form.append("promptQuestion", promptQuestion);
        const result = await composeStoryAction(form);
        await handleStep(result);
      }
    } catch {
      setPendingError(hub.answer.genericError);
      setRecordPhase("idle");
    }
  }, [ask, composingStoryId, proseDraft, subjectPhotoId, promptQuestion, handleStep]);

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
      clog("record_start", { story: composingStoryId ?? "(take-0)", take: composingStoryId ? "append" : "initial" });
    } catch {
      setRecordPhase("softfail");
    }
  }, [uploadRecording, composingStoryId]);

  const stopRecording = useCallback(() => {
    setRecordPhase("saving");
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    clog("record_stop", { story: composingStoryId ?? "(take-0)" });
  }, [composingStoryId]);

  const voiceClick = useCallback(() => {
    if (recordPhase === "listening") stopRecording();
    // Only START a recording when idle AND no other mutation is round-tripping (findings 3+4).
    else if (recordPhase === "idle" && !otherMutationInFlight) void startRecording();
  }, [recordPhase, otherMutationInFlight, startRecording, stopRecording]);

  // Submit typed text. Take 0 (no draft yet) → composeStoryAction (creates the story, full-screen
  // pending). Take ≥ 1 (composing) → appendTypedTakeAction onto the existing draft (inline).
  const submitText = useCallback(async () => {
    if (textDraft.trim().length === 0) return;
    try {
      setPendingError(null);
      if (composingStoryId) {
        setAppending(true);
        const form = new FormData();
        form.set("storyId", composingStoryId);
        form.set("text", textDraft.trim());
        form.set("prose", proseDraft);
        const step = await appendTypedTakeAction(form);
        setTextDraft("");
        await handleStep(step);
      } else {
        setLocalTake({ url: "" }); // reuse the pending screen; no audio to play back for text
        const form = new FormData();
        form.set("text", textDraft.trim());
        if (ask) form.set("askId", ask.id);
        // ADR-0009 Phase 3 tell-a-photo hints (story mode); the server re-checks auth + visibility.
        if (subjectPhotoId) form.set("subjectPhotoId", subjectPhotoId);
        if (promptQuestion) form.set("promptQuestion", promptQuestion);
        const step = await composeStoryAction(form);
        await handleStep(step);
      }
    } catch {
      setPendingError(hub.answer.genericError);
    } finally {
      // Robust liveness: always clear the typed-append flag (handleStep also clears it on its terminal
      // branches, but a `finally` doesn't depend on the server fn's return-type discipline). No-op for
      // the no-draft branch, which never sets it.
      setAppending(false);
    }
  }, [textDraft, ask, composingStoryId, proseDraft, subjectPhotoId, promptQuestion, handleStep]);

  // ── Decline the current follow-up ("That's all for now") ─────────────────────
  // A first-class path, never a dead end. Records the `skipped` outcome and drops the banner WITHOUT
  // refreshing (fix (i): a refresh/remount would clobber unsaved hand-edits; declineFollowUpAction
  // echoes the posted prose + an empty segment so handleStep skips the replace).
  const onDeclineFollowUp = useCallback(async () => {
    if (!composingStoryId) return;
    setPendingError(null);
    setDeclining(true);
    try {
      const form = new FormData();
      form.set("storyId", composingStoryId);
      form.set("prose", proseDraft);
      const step = await declineFollowUpAction(form);
      await handleStep(step);
    } catch {
      setPendingError(hub.answer.genericError);
    } finally {
      setDeclining(false);
    }
  }, [composingStoryId, proseDraft, handleStep]);

  // ── Finish + Finish-check (relocated onto the composing surface in slice 10) ─
  const runFinish = async (intent: "probe" | "accept" | "decline") => {
    if (!composingStoryId) return;
    setActionError(null);
    setFinishingDraft(true);
    clog("finish", { story: composingStoryId, intent });
    try {
      const form = new FormData();
      form.set("intent", intent);
      form.set("storyId", composingStoryId);
      // priorProse discipline: post the CLIENT'S current editor text (non-clobbering).
      form.set("prose", proseDraft);
      if (ask) form.set("promptQuestion", ask.questionText);
      // Accept: the server persists the POLISHED text as finalText (not the posted `prose`). Remember it
      // so we can sync the editor once the finish lands — otherwise `proseDraft` stays the pre-polish
      // text, the shrunk review reseeds nothing (storyId stable → no remount), and Share would send the
      // stale pre-polish `proseDraft` as `correctedProse`, silently overwriting the accepted polish.
      const acceptedPolish = intent === "accept" && finishOffer ? finishOffer.polished : null;
      if (acceptedPolish) {
        form.set("polished", acceptedPolish);
        form.set("polishModelId", finishOffer!.polishModelId);
        form.set("polishPromptText", finishOffer!.polishPromptText);
      }
      const step = await finishDraftAction(form);
      // Sync the editor to the persisted polished text BEFORE handleStep clears the offer + settles.
      if (acceptedPolish && "kind" in step && step.kind === "finished") {
        history.replace(acceptedPolish);
      }
      await handleStep(step);
    } catch {
      setActionError(hub.answer.genericError);
    } finally {
      setFinishingDraft(false);
    }
  };

  const onFinishDraft = () => runFinish("probe");
  const onUsePolished = () => runFinish("accept");
  const onDismissFinishCheck = () => {
    setFinishOffer(null);
    void runFinish("decline");
  };

  // ── Polish tap (shared by composing + review) ────────────────────────────────
  // Raises the parent `polishing` flag for the whole round-trip so it joins the mutation lock (finding
  // 5): otherwise a slow Polish resolving after a concurrent append/Finish would history.replace() stale
  // text over the newer prose. KindredProseEditor's own polishing flag only drives the button label.
  const polishHandler = useCallback(
    async (text: string) => {
      setPolishing(true);
      clog("polish_tap", { story: composingStoryId ?? "(none)", chars: text.length });
      try {
        const form = new FormData();
        form.append("prose", text);
        form.append("promptQuestion", ask?.questionText ?? promptQuestion ?? "");
        if (composingStoryId) form.append("storyId", composingStoryId);
        const res = await polishAnswerProseAction(form);
        if ("error" in res) throw new Error(res.error);
        return res.prose;
      } finally {
        setPolishing(false);
      }
    },
    [ask, composingStoryId, promptQuestion],
  );

  // ── Review-phase handlers (pending_approval) ─────────────────────────────────
  const handleShare = async () => {
    setActionError(null);
    setOp("share");
    // The review Share is a button (not a native form submit), so the FamilyPicker's hidden
    // required-input can't backstop us — guard the ambiguous empty selection here before posting.
    if (showFamilyPicker && familyChoiceRequired && pickedFamilies.size === 0) {
      setActionError(hub.answer.whichFamiliesRequired);
      setOp(null);
      return;
    }
    clog("review_share", { story: draft!.storyId, tier });
    try {
      const form = new FormData();
      form.append("storyId", draft!.storyId);
      form.append("audienceTier", tier);
      if (showFamilyPicker) {
        for (const id of pickedFamilies) form.append("familyIds", id);
      }
      if (proseDraft !== draft!.prose) form.append("correctedProse", proseDraft);
      const effectiveTitle = titleTouched ? titleDraft : (draft!.title ?? "");
      if (effectiveTitle.trim() && effectiveTitle.trim() !== draft!.title) {
        form.append("correctedTitle", effectiveTitle.trim());
      }
      const result = await shareAnswerAction(form);
      if (result?.error) {
        setActionError(result.error);
        setOp(null);
      }
      // On success the server action redirects to /hub.
    } catch {
      setActionError(hub.answer.genericError);
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

  // Drop one take. Dropping take 0 discards the whole thread (→ `discarded` → hub). Dropping a
  // follow-up take (position > 0) is AUDIO-ONLY (decision d): the words stay in the prose, the
  // narrator edits them out; we show the notice and refresh the takes list.
  const handleDropTake = async (position: number) => {
    setActionError(null);
    setDropNotice(null);
    setOp("drop");
    try {
      const form = new FormData();
      form.append("storyId", composingStoryId ?? draft!.storyId);
      form.append("position", String(position));
      const result = await dropTakeAction(form);
      if ("error" in result) {
        setActionError(result.error);
        setOp(null);
        return;
      }
      if (result.kind === "take_dropped") {
        setDropNotice(hub.answer.takeDropped);
        router.refresh();
        setOp(null);
        return;
      }
      await handleStep(result); // position 0 → `discarded` → hub
      setOp(null);
    } catch {
      setActionError(hub.actions.removeFailed);
      setOp(null);
    }
  };

  // ── Shared question header (answer mode only) ────────────────────────────────
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

  const composing = draft?.state === "draft" || (draft == null && activeStoryId != null);

  // ── PENDING-APPROVAL REVIEW (shrunk: title + relisten + edit + tier + Share/Discard) ──
  if (draft && draft.state === "pending_approval") {
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
          <p style={{ fontFamily: "var(--font-story)", fontSize: "clamp(1.5rem, 4vw, 32px)", color: "var(--text-muted)", margin: 0 }}>
            {hub.answer.assembling}
          </p>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-meta)", margin: 0 }}>
            {hub.answer.assemblingSub}
          </p>
        </div>
      );
    }

    // Lock the review mutations while a ✨Polish round-trips too (finding 5): otherwise a Share fired
    // during a Polish would post the pre-polish proseDraft as correctedProse and then redirect, losing
    // the polish. (op === "discard" covers the Discard round-trip. op === "share" is handled by the
    // early return above: setOp("share") swaps this whole form out for the "assembling" view in the
    // same render, so the review controls — including TagInput — are unmounted before any share I/O
    // happens; there is no window where they're both mounted and editable.)
    const isRemoving = op === "discard" || polishing;
    return (
      <div>
        {questionHeader}
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

        <RelistenStrip takes={draft.takes} mediaUrl={draft.mediaUrl} />

        {/* Editable title */}
        <div style={{ marginBottom: 24 }}>
          <label className="kin-form-label">
            {hub.compose.titleLabel}
            <input
              type="text"
              className="kin-field"
              value={titleTouched ? titleDraft : (draft.title ?? "")}
              onChange={(e) => {
                setTitleTouched(true);
                setTitleDraft(e.target.value);
              }}
              disabled={isRemoving}
            />
          </label>
        </div>

        <ProseBlock
          proseDraft={proseDraft}
          setProseDraft={setProseDraft}
          disabled={isRemoving}
          history={history}
          onPolish={polishHandler}
        />

        {/* Photos (ADR-0009 Phase 2) — attach from the owner's album, set a cover, remove, reorder.
            Self-contained: fetches + mutates via its own auth-re-resolving server actions. Off the
            consent ledger, so it lives here in the pre-share review, independent of Share. */}
        <StoryPhotosEditor storyId={draft.storyId} autoAttachPhotoIds={extraSubjectPhotoIds} />

        {/* Unified tags/people/families field (spec 2026-07-13 §2). Text + person tokens autosave to
            the draft immediately; a family token here only toggles it into `pickedFamilies` — nothing
            is shared until Share/Finish, so it just pre-selects the FamilyPicker below. */}
        <div style={{ display: "grid", gap: 6, marginBottom: 32 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              display: "block",
            }}
          >
            {hub.tagInput.label}
          </span>
          <TagInput
            tokens={composeTokens}
            suggestions={tagSuggestions}
            onAdd={onTagAdd}
            onRemove={onTagRemove}
            disabled={isRemoving}
          />
        </div>

        <TierPicker tier={tier} setTier={setTier} disabled={isRemoving} />

        {/* Multi-family target (Task 4) — only for a multi-family author on family/branch tiers. */}
        {showFamilyPicker ? (
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
              {hub.answer.whichFamilies}
            </legend>
            {familyChoiceRequired ? (
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-label)",
                  color: "var(--text-muted)",
                  margin: "0 0 12px",
                }}
              >
                {hub.answer.whichFamiliesHelp}
              </p>
            ) : null}
            <FamilyPicker
              families={families}
              selected={pickedFamilies}
              onToggle={toggleFamily}
              disabled={isRemoving}
              required={familyChoiceRequired}
              requiredMessage={hub.answer.whichFamiliesRequired}
            />
          </fieldset>
        ) : null}

        {actionError && <ErrorLine message={actionError} />}

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
        <KindredButton
          label={hub.answer.discard}
          variant="ghost"
          size="small"
          fullWidth
          disabled={isRemoving}
          onClick={handleDiscard}
        />
      </div>
    );
  }

  // ── DRAFT COMPOSING SURFACE (editor always mounted + footer + relisten + Finish) ──
  if (composing) {
    const savingTake = recordPhase === "saving" || appending;
    // While ANY mutation is in flight — a recording (listening OR saving), a typed append, a decline, a
    // Finish, or a ✨Polish round-trip — no other mutation may start and the editor must be read-only: the
    // mutating request captured the prose AT ISSUE TIME, so an edit or a competing action now would be
    // silently clobbered when it lands (the ADR-0014 hazard; cold-review findings 2+3+4+5). The mic stays
    // live only to STOP an in-flight recording — starting a new one is gated by `otherMutationInFlight`.
    const busy = recordPhase === "listening" || savingTake || otherMutationInFlight;
    return (
      <div>
        {questionHeader}

        {/* Compact per-take relisten strip (audio only; drop on follow-up takes). Absent in the
            optimistic window before the first refresh (no server takes yet). */}
        {draft && <RelistenStrip takes={draft.takes} mediaUrl={draft.mediaUrl} onDrop={handleDropTake} dropDisabled={op === "drop" || busy} />}

        <ProseBlock
          proseDraft={proseDraft}
          setProseDraft={setProseDraft}
          disabled={busy}
          history={history}
          onPolish={polishHandler}
        />

        {dropNotice && <NoticeLine message={dropNotice} />}

        {/* Inline follow-up banner (replaces the old full-screen FollowUpPrompt). Declining is a peer
            path — a full-size ghost button, never a dead end. */}
        {followUp && (
          <div
            style={{
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-card)",
              padding: "16px 18px",
              margin: "0 0 20px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-label)",
                color: "var(--text-meta)",
                letterSpacing: "var(--tracking-mono)",
                margin: "0 0 8px",
              }}
            >
              {hub.answer.followUpIntro}
            </p>
            <p
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story)",
                lineHeight: "var(--leading-snug)",
                color: "var(--text-body)",
                margin: "0 0 12px",
              }}
            >
              {followUp.prompt}
            </p>
            <KindredButton
              label={hub.answer.thatsAllForNow}
              variant="ghost"
              size="small"
              disabled={busy}
              onClick={onDeclineFollowUp}
            />
          </div>
        )}

        {/* Persistent capture footer — mic + type box, both live (append more takes). */}
        <div
          style={{
            borderTop: "var(--border-width) solid var(--border)",
            paddingTop: 24,
            marginTop: 8,
            marginBottom: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
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
            <ToggleOption label={hub.compose.speak} active={inputMode === "voice"} disabled={busy} onClick={() => setInputMode("voice")} />
            <ToggleOption label={hub.compose.typeIt} active={inputMode === "text"} disabled={busy} onClick={() => setInputMode("text")} />
          </div>

          {inputMode === "voice" ? (
            <KindredVoiceButton
              listening={recordPhase === "listening"}
              saving={savingTake}
              disabled={otherMutationInFlight}
              size={160}
              label={
                recordPhase === "listening"
                  ? hub.answer.listeningTapStop
                  : savingTake
                    ? common.voiceButton.oneMoment
                    : common.voiceButton.tapToSpeak
              }
              onClick={voiceClick}
            />
          ) : (
            <div style={{ width: "100%", maxWidth: 480 }}>
              <label className="kin-form-label">
                {hub.compose.textareaLabel}
                <textarea
                  className="kin-field"
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  rows={5}
                  placeholder={hub.compose.textPlaceholder}
                  disabled={busy}
                />
              </label>
              <div style={{ marginTop: 12 }}>
                <KindredButton
                  label={hub.compose.continueLabel}
                  variant="secondary"
                  size="default"
                  fullWidth
                  disabled={busy || textDraft.trim().length === 0}
                  onClick={submitText}
                />
              </div>
            </div>
          )}
        </div>

        {pendingError && <ErrorLine message={pendingError} />}

        {/* Finish-check offer card (slice 8) — inline, dismissible; taking or dismissing both finish. */}
        {finishOffer && (
          <div
            style={{
              border: "1.5px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--surface-card)",
              padding: "18px 20px",
              margin: "0 0 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--support)",
                  margin: 0,
                }}
              >
                {hub.answer.finishCheckTitle}
              </p>
              <KindredButton
                label={hub.answer.dismissFinishCheck}
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={onDismissFinishCheck}
              />
            </div>
            <p
              style={{
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-story)",
                lineHeight: "var(--leading-relaxed)",
                color: "var(--text-body)",
                margin: "12px 0 16px",
                whiteSpace: "pre-wrap",
              }}
            >
              {finishOffer.polished}
            </p>
            <KindredButton
              label={hub.answer.usePolishedVersion}
              variant="secondary"
              size="small"
              fullWidth
              disabled={busy}
              onClick={onUsePolished}
            />
          </div>
        )}

        {/* Finish — seals the draft (runs the speculative Finish-check first). */}
        <KindredButton
          label={hub.answer.finish}
          variant="primary"
          size="large"
          fullWidth
          disabled={busy}
          onClick={onFinishDraft}
        />
      </div>
    );
  }

  // ── REVIEW-PENDING (initial take-0 capture in flight) ────────────────────────
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
          style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-muted)", margin: "0 auto", maxWidth: 360 }}
        >
          {hub.answer.micError}
        </p>
      </div>
    );
  }

  // ── CAPTURE ENTRY (no-draft: initial voice⇄text capture of take 0) ───────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
      {questionHeader}
      {/* Tell-a-photo (ADR-0009 Phase 3): show the subject photo above the prompt so the narrator sees
          exactly which photo they're telling the story of. Bytes come from the audited byte route (the
          owner can see their own album photo). */}
      {!ask && subjectPhotoId && (
        // eslint-disable-next-line @next/next/no-img-element -- audited byte route, not a static asset.
        <img
          src={`/api/album-photo/${subjectPhotoId}`}
          alt={promptQuestion ?? hub.compose.tellPrompt}
          style={{
            width: "100%",
            maxWidth: 360,
            maxHeight: "40dvh",
            objectFit: "contain",
            borderRadius: "var(--radius-md)",
            display: "block",
            background: "var(--surface-sunken)",
          }}
        />
      )}
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
          {promptQuestion ?? hub.compose.tellPrompt}
        </p>
      )}

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
        <ToggleOption label={hub.compose.speak} active={inputMode === "voice"} onClick={() => setInputMode("voice")} />
        <ToggleOption label={hub.compose.typeIt} active={inputMode === "text"} onClick={() => setInputMode("text")} />
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
              style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-meta)", margin: 0, textAlign: "center", maxWidth: 300 }}
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

/* ── Sub-components ─────────────────────────────────────────────────────────── */

/** A per-take audio relisten strip. A thread-of-one keeps the single-take control; a multi-take thread
 * lists each take with its own relisten (+ a drop for follow-up takes when `onDrop` is provided). A
 * text story has no audio (takes: [], mediaUrl: "") → nothing renders. */
function RelistenStrip({
  takes,
  mediaUrl,
  onDrop,
  dropDisabled,
}: {
  takes: TakeInfo[];
  mediaUrl: string;
  onDrop?: (position: number) => void;
  dropDisabled?: boolean;
}) {
  if (takes.length > 1) {
    return (
      <div style={{ margin: "0 auto 32px", maxWidth: 480 }}>
        {takes.map((take) => (
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
            <audio controls src={take.mediaUrl} style={{ width: "100%", display: "block", borderRadius: "var(--radius-md)" }} />
            {!take.isInitial && onDrop && (
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <KindredButton
                  label={hub.answer.dropTake}
                  variant="ghost"
                  size="small"
                  disabled={dropDisabled}
                  onClick={() => onDrop(take.position)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (mediaUrl) {
    return (
      /* eslint-disable-next-line jsx-a11y/media-has-caption */
      <audio
        controls
        src={mediaUrl}
        style={{ width: "100%", maxWidth: 480, display: "block", margin: "0 auto 32px", borderRadius: "var(--radius-md)" }}
      />
    );
  }
  return null;
}

/** The audience-tier radio picker (mirrors ApprovalRecorder). */
function TierPicker({ tier, setTier, disabled }: { tier: Tier; setTier: (t: Tier) => void; disabled: boolean }) {
  return (
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
                disabled={disabled}
                style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
              />
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
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui)", fontWeight: 600, color: "var(--text-body)" }}>
                  {opt.label}
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", color: "var(--text-muted)" }}>
                  {opt.desc}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p
      aria-live="polite"
      style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-danger, #b00)", margin: "0 0 16px", textAlign: "center" }}
    >
      {message}
    </p>
  );
}

function NoticeLine({ message }: { message: string }) {
  return (
    <p
      aria-live="polite"
      style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-meta)", margin: "0 0 16px", textAlign: "center" }}
    >
      {message}
    </p>
  );
}

/* ── Capture-mode toggle option ────────────────────────────────────────────── */
function ToggleOption({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
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
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !active ? 0.5 : 1,
        transition: "background var(--dur-fade), color var(--dur-fade)",
      }}
    >
      {label}
    </button>
  );
}
