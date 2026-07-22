/**
 * Pipeline vendor seams — the shared contracts every adapter implements.
 *
 * The IP (orchestration, prompts, behavior policy, idempotency) lives in OUR code; vendors are
 * commodities behind these interfaces. Adapter implementations (Groq Whisper Turbo,
 * Anthropic Claude, Inngest) are thin shells that translate to/from these types — no vendor SDK
 * is imported anywhere outside an adapter file, and none of @chronicle/{core,db,storage,pipeline}
 * IP code imports a vendor SDK. The architecture test enforces this for content tables; reviewers
 * enforce the IP-vs-adapter split.
 */

// ---------------------------------------------------------------------------
// WorkingCopyTransformer — VAD-trim + ~1.6x time-stretch on the COPY only.
// The canonical audio bytes never enter this function in a mutable way; the input is read-only
// (Uint8Array) and the output is a brand-new Uint8Array. The original Media row is untouched.
// ---------------------------------------------------------------------------

/**
 * One VAD-kept segment, with offsets in BOTH the original time-base and the working-copy
 * (post-trim, post-stretch) time-base. The orchestrator uses these to map word timings the
 * transcriber returns (which are in working-copy time) back to ORIGINAL 1x time before
 * persisting — playback-sync needs offsets that line up with the canonical audio.
 */
export interface WorkingCopySegment {
  /** Where this segment lives in the ORIGINAL audio (real seconds, 1x). */
  originalStartMs: number;
  originalEndMs: number;
  /** Where this segment lives in the WORKING-COPY audio (sped-up). */
  workingCopyStartMs: number;
  workingCopyEndMs: number;
}

export interface WorkingCopyResult {
  bytes: Uint8Array;
  contentType: string;
  /** Tempo speed applied to the trimmed audio (e.g. 1.6). Pitch is preserved. */
  speedFactor: number;
  /** VAD-kept segments. At least one. Sum of durations <= original duration. */
  segments: WorkingCopySegment[];
  /**
   * Heuristic SNR / "hard audio" hint. The default transformer should back off `speedFactor`
   * toward 1.3–1.4x for low-SNR inputs (spec); reported here so a reviewer can audit choices.
   */
  notes?: string;
}

export interface WorkingCopyInput {
  bytes: Uint8Array;
  contentType: string;
  /** Optional duration hint from capture; the transformer may also probe the bytes. */
  durationSeconds?: number;
}

export interface WorkingCopyTransformer {
  transform(input: WorkingCopyInput): Promise<WorkingCopyResult>;
}

// ---------------------------------------------------------------------------
// Transcriber — speech-to-text behind a vendor-neutral interface.
// Default in production: Groq Whisper Large v3 Turbo (per DECISIONS).
// ---------------------------------------------------------------------------

export interface WordTiming {
  word: string;
  /** Start time in WORKING-COPY (sped-up) milliseconds — orchestrator maps back to 1x. */
  startMs: number;
  endMs: number;
}

export interface TranscriptionResult {
  text: string;
  /** Word-level timings if the vendor supplies them; empty array if not. */
  words: WordTiming[];
  /** Vendor model identifier — recorded so a regeneration can compare or A/B. */
  modelId: string;
}

export interface TranscribeInput {
  /** The WORKING-COPY bytes (VAD-trimmed + sped-up). The canonical audio is never sent. */
  bytes: Uint8Array;
  contentType: string;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// LanguageModel — the bought LLM behind a single interface. Used (in Phase 1) by the
// speech-to-story renderer. Prompts + behavior rules live in OUR code (render-story.ts),
// never the vendor's — the vendor only sees the assembled messages.
// ---------------------------------------------------------------------------

export interface LanguageModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LanguageModelRequest {
  messages: LanguageModelMessage[];
  /** Hard cap on output length. */
  maxOutputTokens?: number;
  /** Lower = more faithful to the transcript; higher = more creative. */
  temperature?: number;
  /**
   * Optional structured-output hint. Adapters may use JSON-mode if available; the orchestrator
   * tolerates either a JSON-wrapped or raw-text response (it parses defensively).
   */
  responseFormat?: "text" | "json";
}

export interface LanguageModelResponse {
  text: string;
  modelId: string;
}

export interface LanguageModel {
  complete(req: LanguageModelRequest): Promise<LanguageModelResponse>;
}

// ---------------------------------------------------------------------------
// JobQueue — the durable, staged, idempotent flow seam. Production = Inngest (per DECISIONS);
// dev/test = the in-process impl in this package. Each stage is responsible for being
// idempotent (the orchestrator checks current story state before doing work and re-running a
// stage with the same inputs produces the same outputs without duplicate side effects).
// ---------------------------------------------------------------------------

/** Delivery channels an invitation can be sent over (email/SMS wedge). */
export type DeliveryChannel = "email" | "sms";

export interface StoryJobPayload {
  /** All Phase-1 pipeline jobs target a single Story. */
  storyId: string;
  /**
   * Retry generation (issue #11). OMITTED for the initial run so its dedupe id is unchanged from
   * history; SET (≥1) on a narrator-initiated retry so the durable queue's send-side dedupe (which
   * hashes the payload) sees a distinct event and actually re-fires the stage. The orchestrator
   * carries it verbatim through internal stage cascades. Handlers ignore it — it is a queue concern.
   */
  attempt?: number;
}

export interface InviteJobPayload {
  invitationId: string;
  /**
   * Deliberately NO token here: the raw invite token never crosses the enqueue boundary (it would
   * sit in the persisted event payload). The `invite.send` worker recovers it at delivery time via
   * `getInvitationTokenForDelivery` (core) and treats null as a dead invite — skip, no error.
   */
  channels: DeliveryChannel[];
}

/** Payload for post-share family email pings (#270 / C13b). Worker re-resolves recipients from DB. */
export interface StorySharedNotifyJobPayload {
  storyId: string;
}

/** Payload for the "Ask became actionable" askee email ping (#276). Worker re-resolves the
 *  recipient (prefs + email) from DB via `resolveQuestionsForMePing`. */
export interface AskActionableNotifyJobPayload {
  askId: string;
}

/** Maps each job name to its payload type. Adding a job = a deliberate, named entry here. */
export interface JobPayloadMap {
  transcribe: StoryJobPayload;
  render_story: StoryJobPayload;
  "invite.send": InviteJobPayload;
  "story.shared.notify": StorySharedNotifyJobPayload;
  "ask.actionable.notify": AskActionableNotifyJobPayload;
}

/** The pipeline stages Phase 1 ships (plus invite delivery). Adding a stage is a deliberate, named change. */
export type JobName = keyof JobPayloadMap;

/** Union of all job payload shapes. Handlers registered for a specific `JobName` should prefer the
 *  precise `JobPayloadMap[N]` type (via `JobHandler<N>`) rather than narrowing this union. */
export type JobPayload = JobPayloadMap[JobName];

export interface EnqueuedJob {
  id: string;
  name: JobName;
  payload: JobPayload;
  enqueuedAt: Date;
  attempts: number;
}

export type JobHandler<N extends JobName = JobName> = (payload: JobPayloadMap[N]) => Promise<void>;

/** Vendor-neutral shape of a terminal failure — never leaks the queue vendor's error object. */
export interface JobFailureInfo {
  message: string;
  name?: string;
}

/**
 * Called when a stage has TERMINALLY failed — the durable queue exhausted its retries (issue #11).
 * Receives the original payload (so it can act on the job's identifying id) and a vendor-neutral
 * error summary. MUST be idempotent and must not throw for a routine failure; its job is to record
 * the signal.
 */
export type JobFailureHandler<N extends JobName = JobName> = (
  payload: JobPayloadMap[N],
  error: JobFailureInfo,
) => Promise<void>;

/**
 * Per-name dedupe/attempt key: story jobs key on storyId(+attempt) (preserving the existing
 * retry-generation dedupe-bust behavior — see `StoryJobPayload.attempt`), invite jobs key on
 * invitationId, loop-ping jobs key on storyId, ask-actionable jobs key on askId. Adding a job name
 * means adding a deliberate branch here.
 */
export function jobDedupeKey<N extends JobName>(name: N, payload: JobPayloadMap[N]): string {
  if (name === "invite.send") {
    return `invite.send|${(payload as InviteJobPayload).invitationId}`;
  }
  if (name === "story.shared.notify") {
    return `story.shared.notify|${(payload as StorySharedNotifyJobPayload).storyId}`;
  }
  if (name === "ask.actionable.notify") {
    return `ask.actionable.notify|${(payload as AskActionableNotifyJobPayload).askId}`;
  }
  const p = payload as StoryJobPayload;
  return `${name}|${p.storyId}${p.attempt !== undefined ? `|${p.attempt}` : ""}`;
}

export interface JobQueue {
  /**
   * Enqueue a stage. Returns the job id. Implementations may dedupe by (name, payload) — the
   * in-process impl below does, so re-enqueuing the same job is a no-op while a prior is pending.
   */
  enqueue<N extends JobName>(name: N, payload: JobPayloadMap[N]): Promise<string>;
  /**
   * Register a handler for a stage. Calling twice for the same stage replaces the handler.
   * `onFailure` (optional) runs when the stage terminally fails after the queue exhausts retries —
   * the durable (Inngest) impl wires it to the vendor's native failure hook; the in-process impl,
   * which has no retries, invokes it the first (and only) time a handler throws.
   */
  register<N extends JobName>(name: N, handler: JobHandler<N>, onFailure?: JobFailureHandler<N>): void;
  /** Drain all pending jobs (running handlers). Returns when the queue is empty. */
  drain(): Promise<void>;
  /** Inspect pending jobs — for tests, retry inspection, and observability. */
  pending(): EnqueuedJob[];
}

// ---------------------------------------------------------------------------
// PhotoUnderstanding — RESERVED vision seam (ADR-0009 Story Imagery).
// A future subscription-gated ranker will turn photo bytes into labels/caption/embedding to rank
// album photos against a story. It is deliberately NOT wired into the v1 deterministic
// `rankPhotosForStory` (photo-ranker.ts) — this interface + its mock only reserve the home so the
// eventual vision adapter has a vendor-neutral seam to implement. No vendor SDK lives here.
// ---------------------------------------------------------------------------

export interface PhotoUnderstandingInput {
  photoId: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface PhotoUnderstandingResult {
  labels: string[];
  /** Vendor model identifier — recorded so a re-derivation can compare or A/B. */
  modelId: string;
}

export interface PhotoUnderstanding {
  /** Vision → labels/caption/embedding for a photo. RESERVED (ADR-0009): NOT wired into the v1
   *  deterministic ranker; a future subscription-gated ranker will consume it. */
  describe(input: PhotoUnderstandingInput): Promise<PhotoUnderstandingResult>;
}
