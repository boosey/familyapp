"use client";

/**
 * StoryComposer — the thin answer/tell chrome wrapper around the shared `ComposingEditor` (ADR-0014
 * Inc 3 slice 10, RESOLVED DECISION (b)). The composing surface itself — capture entry, the live
 * always-mounted editor, the Finish flow, the review — lives in `ComposingEditor` so Inc 4's intake
 * surface can mount the same editor. This wrapper only supplies the story-specific chrome:
 *   - `mode="answer"` + `ask` present → the in-hub answer flow (question header, follow-up loop).
 *   - `mode="tell"`   + `ask` null    → a self-initiated telling (no question header). `/hub/tell`.
 * The only mode-dependent behaviour is the discard destination (Stories tab vs Questions tab).
 */
import { ComposingEditor, type DraftInfo } from "./ComposingEditor";

export type { DraftInfo, TakeInfo } from "./ComposingEditor";

interface StoryComposerProps {
  mode: "answer" | "tell";
  /** The ask being answered (answer mode) or `null`/absent for a self-initiated telling (tell mode). */
  ask?: { id: string; questionText: string; askerName: string } | null;
  draft: DraftInfo | null;
  /**
   * ADR-0009 Phase 3 "tell the story of this photo": the album photo this telling is ABOUT. Carried
   * as a client hint into `composeStoryAction` — the server re-resolves auth and the core write gate
   * enforces the owner can actually see it. Tell mode only; null/absent for a plain telling or answer.
   */
  subjectPhotoId?: string | null;
  /**
   * Phase C bulk "tell one story about these N photos". The NON-cover selected photos: attached to the
   * new draft as accompaniment images via the normal photos-editor attach flow (the cover is the
   * `subjectPhotoId` above). Any id equal to the cover is a no-op (the editor dedups against what's
   * already attached). Empty for the ordinary single-photo / plain telling.
   */
  extraSubjectPhotoIds?: string[];
  /** ADR-0009 Phase 3: the caption-derived prompt shown for a tell-a-photo telling (and stored). */
  promptQuestion?: string | null;
  /** The narrator's active families, offered in the share-step multi-family picker (Task 4). */
  families?: { familyId: string; familyName: string }[];
  /** Family ids pre-checked in the picker, seeded from the hub scope (or ask ∩ active for answers). */
  seededFamilyIds?: string[];
  /** True when the narrator must explicitly pick ≥1 family (ambiguous "all"-with-several). */
  familyChoiceRequired?: boolean;
}

export function StoryComposer({
  mode,
  ask = null,
  draft,
  subjectPhotoId = null,
  extraSubjectPhotoIds = [],
  promptQuestion = null,
  families = [],
  seededFamilyIds = [],
  familyChoiceRequired = false,
}: StoryComposerProps) {
  // Where a discard returns the narrator. A tell-mode draft came from the Stories tab; an answer came
  // from the Questions tab. (A legitimate mode-dependent branch.)
  const backTab = mode === "tell" ? "/hub?tab=stories" : "/hub?tab=questions";

  // Dev-time consistency guard. Real behavior is discriminated by ask-presence, NOT by `mode`; this
  // catches a caller whose `mode` disagrees with the actual `ask` prop.
  if (process.env.NODE_ENV !== "production" && (mode === "answer") !== (ask != null)) {
    // eslint-disable-next-line no-console
    console.warn("StoryComposer: `mode` and `ask`-presence disagree");
  }

  // `/hub/tell` (fresh telling) has no ask/story id in its URL to re-query a just-created draft, so the
  // first take hands off to the story's resume URL (`/hub/tell/[storyId]`) to server-drive the rest.
  // `/hub/answer/[askId]` re-queries its draft by `askId` on refresh, so it needs no resumeHref.
  const resumeHref = mode === "tell" ? (storyId: string) => `/hub/tell/${storyId}` : undefined;

  return (
    <ComposingEditor
      ask={ask}
      draft={draft}
      backTab={backTab}
      resumeHref={resumeHref}
      subjectPhotoId={subjectPhotoId}
      extraSubjectPhotoIds={extraSubjectPhotoIds}
      promptQuestion={promptQuestion}
      families={families}
      seededFamilyIds={seededFamilyIds}
      familyChoiceRequired={familyChoiceRequired}
    />
  );
}
