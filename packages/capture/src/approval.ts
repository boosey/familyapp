/**
 * The voice-only approval gate — the capture-side counterpart to `ingestRecording`.
 *
 * Same storage-first ordering (DECISIONS.md: authenticity beats polish): the elder's spoken
 * approval clip is written to object storage BEFORE the DB-side atomic transition. If the DB
 * write fails, the approval audio is still durable in storage and recoverable; if the storage
 * upload fails, NOTHING is written and the story stays `pending_approval` — the elder is invited
 * to try again, and no half-approved state ever exists.
 *
 * The atomic DB-side work — insert `approval_audio` Media → transition pending_approval → approved
 * → shared @ chosen tier → append the FIRST `approved_for_sharing` ConsentRecord — happens in
 * one transaction inside `@chronicle/core`'s audited `approveAndShareStory`, never here.
 *
 * Source-agnostic (same as recording capture): the approval audio is a `CapturedAudio`, so a
 * later telephony adapter can deliver it identically — no rebuild.
 */
import { createHash, randomUUID } from "node:crypto";
import { approveAndShareStory, getStoryForViewer } from "@chronicle/core";
import type { ApproveAndShareResult } from "@chronicle/core";
import type { AudienceTier, Database } from "@chronicle/db";
import type { MediaStorage } from "@chronicle/storage";
import type { CapturedAudio } from "./capture";
import { InvalidSessionError } from "./capture";
import { resolveElderSession } from "./sessions";

export class StoryNotApprovableError extends Error {
  readonly code = "STORY_NOT_APPROVABLE";
  constructor(reason: string) {
    super(reason);
    this.name = "StoryNotApprovableError";
  }
}

export class InvalidAudienceTierError extends Error {
  readonly code = "INVALID_AUDIENCE_TIER";
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidAudienceTierError";
  }
}

/**
 * The tiers an elder may publish a story to. `private` is excluded by design — approval is the act
 * of *sharing*, so "approve as private" is meaningless. This is the domain's authoritative list;
 * the transport layer must NOT re-encode it (a string from an untrusted client lands here and is
 * checked once, fail-fast, before any storage or DB write).
 */
const SHAREABLE_TIERS: ReadonlySet<Exclude<AudienceTier, "private">> = new Set([
  "branch",
  "family",
  "public",
]);

function assertShareableTier(
  tier: string,
): asserts tier is Exclude<AudienceTier, "private"> {
  if (!SHAREABLE_TIERS.has(tier as Exclude<AudienceTier, "private">)) {
    throw new InvalidAudienceTierError(
      `audience tier ${JSON.stringify(tier)} is not a shareable tier (expected one of: ${[
        ...SHAREABLE_TIERS,
      ].join(", ")})`,
    );
  }
}

export interface CaptureApprovalInput {
  /** Elder's session token — the only credential on this path. */
  sessionToken: string;
  /** The story the elder is approving (must be pending_approval and owned by the elder). */
  storyId: string;
  /** The tier the elder is choosing to share at; private is meaningless here. */
  audienceTier: Exclude<AudienceTier, "private">;
  /** The spoken-approval audio clip. */
  audio: CapturedAudio;
  now?: Date;
}

export interface CaptureApprovalResult extends ApproveAndShareResult {
  approvalAudioStorageKey: string;
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

export async function captureApproval(
  db: Database,
  storage: MediaStorage,
  input: CaptureApprovalInput,
): Promise<CaptureApprovalResult> {
  // Fail-fast on a bad tier BEFORE touching the session, storage, or DB — a malformed tier from
  // the transport layer must never reach a side effect.
  assertShareableTier(input.audienceTier);

  const resolved = await resolveElderSession(db, input.sessionToken, {
    now: input.now,
  });
  if (!resolved) throw new InvalidSessionError();

  // Verify ownership + state through the SINGLE FRONT DOOR — the elder, as owner, always sees
  // their own story regardless of state. This is the only path here that touches story content,
  // so no architecture-allowlist entry is needed for this file.
  const story = await getStoryForViewer(
    db,
    { kind: "elder_session", personId: resolved.personId },
    input.storyId,
  );
  if (!story) {
    throw new StoryNotApprovableError(
      `story ${input.storyId} not found or not visible to this session`,
    );
  }
  if (story.ownerPersonId !== resolved.personId) {
    // Defense in depth: getStoryForViewer would not surface a non-owner draft, but assert anyway.
    throw new StoryNotApprovableError(
      `story ${input.storyId} is not owned by the elder on this session`,
    );
  }
  if (story.state !== "pending_approval") {
    throw new StoryNotApprovableError(
      `story ${input.storyId} is in state ${story.state}; approval requires pending_approval`,
    );
  }

  // (1) Upload approval audio FIRST. After this line the spoken approval is durable in storage,
  // independent of anything that follows.
  const key = `approval-audio/${resolved.personId}/${randomUUID()}.${extensionFor(
    input.audio.contentType,
  )}`;
  await storage.put({
    key,
    bytes: input.audio.bytes,
    contentType: input.audio.contentType,
  });

  // (2) Atomic DB-side write: media row + state walk + first consent event, all in one tx.
  const checksum = `sha256:${sha256Hex(input.audio.bytes)}`;
  const result = await approveAndShareStory(db, {
    storyId: input.storyId,
    elderPersonId: resolved.personId,
    audienceTier: input.audienceTier,
    approvalAudio: {
      storageKey: key,
      contentType: input.audio.contentType,
      checksum,
      ...(input.audio.durationSeconds !== undefined
        ? { durationSeconds: input.audio.durationSeconds }
        : {}),
    },
    ...(input.now !== undefined ? { now: input.now } : {}),
  });

  return { ...result, approvalAudioStorageKey: key };
}
