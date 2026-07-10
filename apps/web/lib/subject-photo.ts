/**
 * ADR-0009 Phase 3 subject/carry-forward helpers shared by the in-hub answer actions and the
 * login-free `/api/capture` link-session path. Ask subject photos take precedence over a client
 * tell-a-photo hint; carry-forward attaches the remaining ask photos as accompaniment after the
 * story is created (best-effort — never fails the answer).
 */
import {
  listAskSubjectPhotos,
  attachPhotoToStory,
} from "@chronicle/core";
import { plogError } from "@chronicle/pipeline";
import type { Database } from "@chronicle/db";

/**
 * Resolve the story's SUBJECT photo for a new telling, plus any photos to carry forward as
 * accompaniment. Two independent origins, ask-photos taking precedence:
 *   - Answer→story carry-forward: when the answered ask HAS subject photos, the FIRST becomes the
 *     new story's subject/cover and the REST are attached as accompaniment (this fn returns them so
 *     the caller can attach after the story is created — the answerer is the ask target / co-member,
 *     so the core album-access gate passes).
 *   - Tell-a-photo: a self-initiated telling started from the album viewer carries a single
 *     `subjectPhotoId` (the client hint). It is NOT trusted for identity — the core write gate
 *     (`assertPersonCanAccessAlbumPhoto`, run inside ingest against the SERVER-resolved owner) is
 *     what enforces the owner can actually see it; a crafted id for an unseeable photo makes ingest
 *     throw.
 * `clientSubjectPhotoId` is ignored whenever the ask supplies photos (an answer isn't a tell-a-photo).
 */
export async function resolveSubjectPhotos(
  db: Database,
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
export async function attachCarryForwardPhotos(
  db: Database,
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
