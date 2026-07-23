/**
 * The capture intake — record → persist immutable audio → draft Story.
 *
 * Non-negotiable invariant (spec): the original audio is persisted FIRST, before any processing,
 * so it is safe even if every later stage fails. This function uploads the bytes to object
 * storage, THEN records the immutable Media row and the draft Story (via the audited core write
 * path). Nothing downstream ever overwrites the recording.
 *
 * Source-agnostic seam: intake accepts `CapturedAudio` from ANY source. The login-free web-link
 * channel (`/s/[token]`) is the sole capture channel — narrators record in a phone browser; there
 * is no telephony channel.
 */
import { randomUUID } from "node:crypto";
import { createTextDraft, persistRecordingAndCreateDraft, persistTakeRecording } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import { resolveCaptureActor } from "./identity";
import { sha256Hex, extensionFor } from "./audio-util";

/** The audio entry channel. Currently the login-free web-link surface is the only channel. */
export type CaptureSource = "web_link";

/**
 * WHO is capturing — the identity-agnostic credential for the capture orchestrator (ADR-0003).
 *
 *   - `account`      — a signed-in Person (the in-hub answer flow). Identity is the resolved
 *                      `personId`; trust is established by the web auth layer BEFORE calling capture,
 *                      so capture trusts the personId directly (it never re-authenticates a cookie).
 *   - `link_session` — the login-free `/s/[token]` surface. The raw token IS the identity; capture
 *                      resolves it via `resolveLinkSession` and rejects unknown/expired/revoked.
 *
 * Both kinds funnel into the SAME storage-first orchestrator (`ingestRecording` / `captureApproval`)
 * — the only difference is how the owning `personId` is obtained. Core is untouched (already
 * `personId`-based).
 */
export type CaptureActor =
  | { kind: "account"; personId: string }
  | { kind: "link_session"; token: string };

export interface CapturedAudio {
  bytes: Uint8Array;
  /** e.g. "audio/webm". Wideband web capture is the Phase-1 default. */
  contentType: string;
  durationSeconds?: number;
}

export interface IngestRecordingInput {
  /** WHO is capturing — a link-session token or a signed-in account (ADR-0003). */
  actor: CaptureActor;
  audio: CapturedAudio;
  /** The capture channel. Defaults to "web_link" (the only channel today). */
  source?: CaptureSource;
  promptQuestion?: string;
  askId?: string;
  /** The album photo this story is ABOUT (ADR-0009 Phase 3 "subject"). Threaded to core, which
   *  atomically makes it the story's first cover image (gated: the owner must be able to see it). */
  subjectPhotoId?: string;
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


export async function ingestRecording(
  db: Database,
  storage: MediaStorage,
  input: IngestRecordingInput,
): Promise<IngestResult> {
  const resolved = await resolveCaptureActor(db, input.actor, { now: input.now });

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
    {
      promptQuestion: input.promptQuestion,
      askId: input.askId,
      // Carry the link-session's family onto the draft as its originating context (ADR-0010), so
      // approval can default-target the story into the family it was told for. Null for account.
      originatingFamilyId: resolved.originatingFamilyId ?? undefined,
      // ADR-0009 Phase 3: the album photo this story is about (atomic cover insert in core).
      subjectPhotoId: input.subjectPhotoId,
    },
  );

  return { storyId: story.id, recordingMediaId: recording.id, storageKey: key };
}

export interface IngestTextStoryInput {
  /** WHO is capturing — a link-session token or a signed-in account (ADR-0003). */
  actor: CaptureActor;
  /** The typed words — canonical for a text story. */
  text: string;
  promptQuestion?: string;
  askId?: string;
  /** The album photo this story is ABOUT (ADR-0009 Phase 3 "subject"). See `IngestRecordingInput`. */
  subjectPhotoId?: string;
  now?: Date;
}

export interface IngestTextResult {
  storyId: string;
}

/**
 * Text-origin sibling of `ingestRecording` (ADR-0007). No object storage — there are no audio
 * bytes. Resolves WHO is capturing exactly like the voice path, then writes a text draft via the
 * audited core write. The pipeline (start-at-render for text stories) turns the typed text into
 * prose/title just as it does a voice transcript.
 */
export async function ingestTextStory(
  db: Database,
  input: IngestTextStoryInput,
): Promise<IngestTextResult> {
  const resolved = await resolveCaptureActor(db, input.actor, { now: input.now });
  const { story } = await createTextDraft(db, {
    ownerPersonId: resolved.personId,
    text: input.text,
    ...(input.promptQuestion !== undefined ? { promptQuestion: input.promptQuestion } : {}),
    ...(input.askId !== undefined ? { askId: input.askId } : {}),
    // Carry the link-session's family onto the draft as its originating context (ADR-0010) so
    // approval can default-target the story into the family it was told for. Null for account.
    ...(resolved.originatingFamilyId ? { originatingFamilyId: resolved.originatingFamilyId } : {}),
    // ADR-0009 Phase 3: the album photo this story is about (atomic cover insert in core).
    ...(input.subjectPhotoId !== undefined ? { subjectPhotoId: input.subjectPhotoId } : {}),
  });
  return { storyId: story.id };
}

/**
 * Persist a FOLLOW-UP take onto an EXISTING draft story (ADR-0012's multi-take model). A sibling of
 * `ingestRecording` that appends a take rather than creating a story: same storage-FIRST discipline
 * (the audio is durable before any DB row), but the core write is `persistTakeRecording` (append the
 * immutable Media + the next `story_recordings` row) instead of `persistRecordingAndCreateDraft`.
 *
 * The caller (the in-hub answer action, Task 6b) does its own owner + draft-state authorization
 * BEFORE calling this — so, like the `account` branch of `ingestRecording`, this trusts the passed
 * `ownerPersonId` and never re-authenticates.
 */
export async function ingestFollowUpTake(
  db: Database,
  storage: MediaStorage,
  input: { storyId: string; ownerPersonId: string; audio: CapturedAudio },
): Promise<{ storyRecordingId: string; recordingMediaId: string; storageKey: string }> {
  const key = `story-audio/${input.ownerPersonId}/${randomUUID()}.${extensionFor(
    input.audio.contentType,
  )}`;

  // (1) Persist the audio FIRST — durable before any DB row is written, exactly as ingestRecording.
  await storage.put({
    key,
    bytes: input.audio.bytes,
    contentType: input.audio.contentType,
  });

  // (2) Append the immutable Media row + the next ordered take (audited core write).
  const checksum = `sha256:${sha256Hex(input.audio.bytes)}`;
  const { recording, storyRecording } = await persistTakeRecording(
    db,
    {
      ownerPersonId: input.ownerPersonId,
      storageKey: key,
      contentType: input.audio.contentType,
      ...(input.audio.durationSeconds !== undefined
        ? { durationSeconds: input.audio.durationSeconds }
        : {}),
      checksum,
    },
    input.storyId,
  );

  return { storyRecordingId: storyRecording.id, recordingMediaId: recording.id, storageKey: key };
}
