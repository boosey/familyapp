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
import { randomUUID } from "node:crypto";
import { persistRecordingAndCreateDraft, persistTakeRecording } from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import { resolveCaptureActor } from "./identity";
import { sha256Hex, extensionFor } from "./audio-util";

/** The audio entry channel. The pipeline behind this is identical for every value. */
export type CaptureSource = "web_link" | "telephony";

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
    },
  );

  return { storyId: story.id, recordingMediaId: recording.id, storageKey: key };
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
