/**
 * The capture intake — record → persist immutable audio → draft Story.
 *
 * Non-negotiable invariant (spec): the original audio is persisted FIRST, before any processing,
 * so it is safe even if every later stage fails. This function uploads the bytes to object
 * storage, THEN records the immutable Media row and the draft Story (via the audited core write
 * path). Nothing downstream ever overwrites the recording.
 *
 * Source-agnostic seam: intake accepts `CapturedAudio` from ANY source. The web-link channel is
 * the only producer in Phase 1; a later telephony adapter just produces the same `CapturedAudio`
 * and calls this exact function — no rebuild of capture.
 */
import { createHash, randomUUID } from "node:crypto";
import { persistRecordingAndCreateDraft } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import { resolveElderSession } from "./sessions";

/** The audio entry channel. The pipeline behind this is identical for every value. */
export type CaptureSource = "web_link" | "telephony";

export interface CapturedAudio {
  bytes: Uint8Array;
  /** e.g. "audio/webm". Wideband web capture is the Phase-1 default. */
  contentType: string;
  durationSeconds?: number;
}

export interface IngestRecordingInput {
  /** The raw session token from the elder's link — the only credential on this path. */
  sessionToken: string;
  audio: CapturedAudio;
  /** Defaults to "web_link". Present so a telephony adapter is a config, not a rebuild. */
  source?: CaptureSource;
  promptQuestion?: string;
  askId?: string;
  now?: Date;
}

export interface IngestResult {
  storyId: string;
  recordingMediaId: string;
  storageKey: string;
}

export class InvalidSessionError extends Error {
  readonly code = "INVALID_SESSION";
  constructor() {
    super("session token is unknown, revoked, or expired");
    this.name = "InvalidSessionError";
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

function extensionFor(contentType: string): string {
  return EXT_BY_TYPE[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin";
}

export async function ingestRecording(
  db: Database,
  storage: MediaStorage,
  input: IngestRecordingInput,
): Promise<IngestResult> {
  const resolved = await resolveElderSession(db, input.sessionToken, {
    now: input.now,
  });
  if (!resolved) throw new InvalidSessionError();

  const key = `story-audio/${resolved.personId}/${randomUUID()}.${extensionFor(
    input.audio.contentType,
  )}`;

  // (1) Persist the audio FIRST. After this line the recording is durable in object storage,
  // independent of anything that follows.
  await storage.put({
    key,
    bytes: input.audio.bytes,
    contentType: input.audio.contentType,
  });

  // (2) Record the immutable Media row + the draft Story pointing at it (audited core write).
  const checksum = `sha256:${sha256Hex(input.audio.bytes)}`;
  const { recording, story } = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId: resolved.personId,
      storageKey: key,
      contentType: input.audio.contentType,
      durationSeconds: input.audio.durationSeconds,
      checksum,
    },
    { promptQuestion: input.promptQuestion, askId: input.askId },
  );

  return { storyId: story.id, recordingMediaId: recording.id, storageKey: key };
}
