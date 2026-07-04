"use server";

/**
 * Server actions for the story ACCOMPANIMENT editor (ADR-0009 Phase 2) — the "Photos" section in the
 * composer's review phase. Like every hub action, each one re-resolves auth on the server
 * (`getCurrentAuthContext()`) and verifies the actor OWNS the draft story before touching anything —
 * the client is NEVER trusted for identity. The core write primitives (`attachPhotoToStory`,
 * `detachStoryImage`, `setStoryCover`, `reorderStoryImages`) take no AuthContext by design (actor
 * authorization is the caller's job), so this ownership gate is the security boundary.
 *
 * Images are OFF the consent ledger (ADR-0009): attaching / removing / re-covering / reordering
 * writes no `consent_records` row and needs no re-approval. `revalidatePath` refreshes the story
 * detail page so a shared story's gallery / feed cover reflects the change.
 */
import { revalidatePath } from "next/cache";
import {
  getStoryForViewer,
  listStoryImages,
  listActiveFamiliesForPerson,
  listAlbumPhotos,
  attachPhotoToStory,
  detachStoryImage,
  setStoryCover,
  reorderStoryImages,
  type AuthContext,
} from "@chronicle/core";
import type { Database, Story } from "@chronicle/db";
import { rankPhotosForStory, pickPhotoNudge } from "@chronicle/pipeline";
import type { PhotoCandidate, StorySignals } from "@chronicle/pipeline";
import { getRuntime } from "@/lib/runtime";
import { hub } from "@/app/_copy";

/** One attached accompaniment image, as the editor needs it (family-photo provenance only). */
export interface EditorStoryImage {
  storyImageId: string;
  familyPhotoId: string;
  caption: string | null;
  isCover: boolean;
  position: number;
}

/** One album photo the owner may attach (already-attached ones are filtered out). */
export interface EditorAlbumPhoto {
  photoId: string;
  caption: string | null;
}

export type StoryPhotoEditorData =
  | {
      ok: true;
      attached: EditorStoryImage[];
      album: EditorAlbumPhoto[];
      // ADR-0009 Phase 4 · Slice B — a caption-driven "add this photo?" suggestion, or null when no
      // candidate's caption overlaps the story text (the common case; the picker just looks normal).
      nudge: { photoId: string; caption: string | null } | null;
    }
  | { error: string };

export type StoryPhotoActionResult = { ok: true } | { error: string };

/**
 * Ownership gate shared by every action here. Re-resolves auth server-side, reads the story through
 * the SINGLE FRONT DOOR (`getStoryForViewer` — an owner always sees their own story in any state; a
 * non-owner gets `null`), and confirms the actor is the owner. Returns the `{ db, ctx, personId }`
 * on success, or the `{ error }` the caller surfaces verbatim.
 */
async function requireDraftOwner(
  storyId: string,
): Promise<
  | { db: Database; ctx: AuthContext; personId: string; story: Story }
  | { error: string }
> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId) {
    return { error: hub.actions.storyNotFound };
  }
  return { db, ctx, personId: ctx.personId, story };
}

/**
 * Load the editor's data: the story's attached (non-deleted, family-photo) images in order, plus the
 * owner's album photos NOT yet attached (across every family they contribute to, deduped). The story
 * is gated by `requireDraftOwner` first (an attachment link is visible only when its story is).
 */
export async function loadStoryPhotoEditorAction(
  storyId: string,
): Promise<StoryPhotoEditorData> {
  const gate = await requireDraftOwner(storyId);
  if ("error" in gate) return gate;
  const { db, ctx, personId, story } = gate;

  try {
    const images = await listStoryImages(db, storyId);
    const attached: EditorStoryImage[] = images
      .filter((img): img is typeof img & { familyPhotoId: string } => img.familyPhotoId !== null)
      .map((img) => ({
        storyImageId: img.id,
        familyPhotoId: img.familyPhotoId,
        caption: img.caption,
        isCover: img.isCover,
        position: img.position,
      }));

    const attachedPhotoIds = new Set(attached.map((a) => a.familyPhotoId));

    // The owner's whole album pool (every family they are an active member of), deduped by photo id
    // (a photo shared into two families appears once), minus what's already on the story. This pool
    // is already authorized by `listAlbumPhotos` (active membership gated); the ranker below only
    // RE-ORDERS it — it opens no new read path and never widens the candidate set.
    const families = await listActiveFamiliesForPerson(db, personId);
    const seen = new Set<string>();
    const candidates: PhotoCandidate[] = [];
    for (const fam of families) {
      const photos = await listAlbumPhotos(db, ctx, fam.familyId);
      for (const p of photos) {
        if (seen.has(p.id) || attachedPhotoIds.has(p.id)) continue;
        seen.add(p.id);
        // `exifCapturedAt` is used ONLY here, server-side, by the ranker — it never rides to the
        // client (the emitted `EditorAlbumPhoto` carries only photoId + caption).
        candidates.push({ id: p.id, caption: p.caption, exifCapturedAt: p.exifCapturedAt });
      }
    }

    // Silent, deterministic ranking (ADR-0009 Phase 4 · Slice A): caption-overlap ∪ era-year
    // proximity. Usually there is no signal (eraYear/exif null) → recency order is preserved, so the
    // picker looks exactly as it did before and `nudge` is null.
    const signals: StorySignals = {
      text: [
        story.title,
        story.prose,
        story.transcript,
        story.summary,
        (story.tags ?? []).join(" "),
        story.promptQuestion,
        story.eraLabel,
      ]
        .filter(Boolean)
        .join(" "),
      eraYear: story.eraYear,
    };
    const ranked = rankPhotosForStory(signals, candidates);
    const album: EditorAlbumPhoto[] = ranked.map((r) => ({ photoId: r.id, caption: r.caption }));
    const nudge = pickPhotoNudge(ranked);

    return { ok: true, attached, album, nudge };
  } catch {
    return { error: hub.storyImages.loadError };
  }
}

/**
 * Attach an album photo to the story. The core primitive AUTHORIZES the attach — it throws
 * `InvariantViolation` when the actor is neither the photo's contributor nor an active member of any
 * family it is placed in (so a crafted request can't attach a stranger's photo by id — IDOR), and
 * also when the photo is missing/soft-deleted or already on the story (the unique index). Every such
 * failure maps to one non-committal error; the picker never OFFERS an unattachable photo, so a real
 * user only reaches the happy path.
 */
export async function attachStoryPhotoAction(
  formData: FormData,
): Promise<StoryPhotoActionResult> {
  const storyId = formData.get("storyId");
  const familyPhotoId = formData.get("familyPhotoId");
  if (typeof storyId !== "string" || typeof familyPhotoId !== "string" || !familyPhotoId) {
    return { error: hub.actions.invalidInput };
  }

  const gate = await requireDraftOwner(storyId);
  if ("error" in gate) return gate;

  try {
    await attachPhotoToStory(gate.db, {
      storyId,
      familyPhotoId,
      attachedByPersonId: gate.personId,
    });
    revalidatePath(`/hub/stories/${storyId}`);
    return { ok: true };
  } catch {
    // Any core throw — unauthorized actor (cross-family IDOR), missing/deleted photo, or a
    // duplicate-attach unique violation — surfaces one friendly, non-committal note.
    return { error: hub.actions.photoAttachFailed };
  }
}

/** Remove an attached image from the story (scoped to the story). Cover promotion is handled by the
 * core primitive. */
export async function detachStoryPhotoAction(
  formData: FormData,
): Promise<StoryPhotoActionResult> {
  const storyId = formData.get("storyId");
  const storyImageId = formData.get("storyImageId");
  if (typeof storyId !== "string" || typeof storyImageId !== "string" || !storyImageId) {
    return { error: hub.actions.invalidInput };
  }

  const gate = await requireDraftOwner(storyId);
  if ("error" in gate) return gate;

  try {
    await detachStoryImage(gate.db, { storyId, storyImageId });
    revalidatePath(`/hub/stories/${storyId}`);
    return { ok: true };
  } catch {
    return { error: hub.actions.photoUpdateFailed };
  }
}

/** Make an attached image the story's cover. */
export async function setStoryCoverAction(
  formData: FormData,
): Promise<StoryPhotoActionResult> {
  const storyId = formData.get("storyId");
  const storyImageId = formData.get("storyImageId");
  if (typeof storyId !== "string" || typeof storyImageId !== "string" || !storyImageId) {
    return { error: hub.actions.invalidInput };
  }

  const gate = await requireDraftOwner(storyId);
  if ("error" in gate) return gate;

  try {
    await setStoryCover(gate.db, { storyId, storyImageId });
    revalidatePath(`/hub/stories/${storyId}`);
    return { ok: true };
  } catch {
    return { error: hub.actions.photoUpdateFailed };
  }
}

/**
 * Reorder the story's images. The client sends the FULL new order (elder-friendly up/down buttons
 * compute it), which the core primitive validates must be exactly the story's current image set.
 */
export async function reorderStoryPhotosAction(
  formData: FormData,
): Promise<StoryPhotoActionResult> {
  const storyId = formData.get("storyId");
  const orderedStoryImageIds = formData
    .getAll("orderedStoryImageIds")
    .filter((v): v is string => typeof v === "string");
  if (typeof storyId !== "string" || orderedStoryImageIds.length === 0) {
    return { error: hub.actions.invalidInput };
  }

  const gate = await requireDraftOwner(storyId);
  if ("error" in gate) return gate;

  try {
    await reorderStoryImages(gate.db, { storyId, orderedStoryImageIds });
    revalidatePath(`/hub/stories/${storyId}`);
    return { ok: true };
  } catch {
    return { error: hub.actions.photoUpdateFailed };
  }
}
