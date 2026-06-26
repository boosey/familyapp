/**
 * Content WRITE path (audited). Together with authorization.ts, this is the only production code
 * permitted to touch the `stories`/`media` tables — keeping every content read AND write in a
 * tiny, reviewable surface.
 *
 * `persistRecordingAndCreateDraft` encodes the spec's capture invariant: the original audio
 * Media is written FIRST (and is immutable thereafter — the DB trigger forbids UPDATE/DELETE),
 * then a `draft` Story is created pointing at it. A draft story is born `private` (it stays
 * there until the elder approves by voice). The two writes are wrapped in a transaction so a
 * story can never exist without its canonical recording.
 */
import { media, stories } from "@chronicle/db/content";
import type { Database, Media, Story } from "@chronicle/db";

export interface RecordingInput {
  ownerPersonId: string;
  /** Object-storage key where the immutable audio bytes already live. */
  storageKey: string;
  contentType: string;
  durationSeconds?: number;
  checksum: string;
}

export interface DraftStoryInput {
  /** The question that prompted this telling, if any. */
  promptQuestion?: string;
  /** The Ask this answers, if it came from the family relay. */
  askId?: string;
}

export interface PersistedRecording {
  recording: Media;
  story: Story;
}

/**
 * Persist the canonical recording, then create the draft Story that points at it. Call this only
 * AFTER the audio bytes are safely in object storage — so the recording is durable before any
 * downstream stage (transcription, synthesis) can run, and remains untouched if they all fail.
 */
export async function persistRecordingAndCreateDraft(
  db: Database,
  recording: RecordingInput,
  draft: DraftStoryInput = {},
): Promise<PersistedRecording> {
  return db.transaction(async (tx) => {
    const [rec] = await tx
      .insert(media)
      .values({
        ownerPersonId: recording.ownerPersonId,
        kind: "story_audio",
        storageKey: recording.storageKey,
        contentType: recording.contentType,
        durationSeconds: recording.durationSeconds ?? null,
        checksum: recording.checksum,
      })
      .returning();

    const [story] = await tx
      .insert(stories)
      .values({
        ownerPersonId: recording.ownerPersonId,
        recordingMediaId: rec!.id,
        state: "draft",
        audienceTier: "private",
        promptQuestion: draft.promptQuestion ?? null,
        askId: draft.askId ?? null,
      })
      .returning();

    return { recording: rec!, story: story! };
  });
}
