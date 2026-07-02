/**
 * Storage-first intake ingest — the intake analogue of ingestRecording. Uploads the audio bytes to
 * object storage FIRST (durable before anything else), then writes the immutable intake media row +
 * the voice intake_answers row via the audited core repository. Transcription is a SEPARATE step the
 * caller runs after this returns (createIntakeRecording seeds text=""). No Story, no pipeline.
 */
import { randomUUID } from "node:crypto";
import { createIntakeRecording } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import { resolveCaptureActor } from "./identity";
import type { CaptureActor, CapturedAudio } from "./capture";
import { extensionFor, sha256Hex } from "./audio-util";

export interface IngestIntakeInput {
  actor: CaptureActor;
  questionKey: string;
  promptQuestion: string;
  audio: CapturedAudio;
  now?: Date;
}

export interface IngestIntakeResult {
  intakeAnswerId: string;
  mediaId: string;
  storageKey: string;
}

export async function ingestIntakeRecording(
  db: Database,
  storage: MediaStorage,
  input: IngestIntakeInput,
): Promise<IngestIntakeResult> {
  const resolved = await resolveCaptureActor(db, input.actor, { now: input.now });

  const key = `intake-audio/${resolved.personId}/${randomUUID()}.${extensionFor(
    input.audio.contentType,
  )}`;

  // (1) Persist the audio FIRST — durable in object storage independent of anything after.
  await storage.put({ key, bytes: input.audio.bytes, contentType: input.audio.contentType });

  // (2) Immutable media row + voice intake answer (audited core write).
  const checksum = `sha256:${sha256Hex(input.audio.bytes)}`;
  const answer = await createIntakeRecording(db, {
    personId: resolved.personId,
    questionKey: input.questionKey,
    promptQuestion: input.promptQuestion,
    storageKey: key,
    contentType: input.audio.contentType,
    durationSeconds: input.audio.durationSeconds,
    checksum,
  });

  // always set: createIntakeRecording writes a media row before the intake_answers upsert
  return { intakeAnswerId: answer.id, mediaId: answer.mediaId!, storageKey: key };
}
