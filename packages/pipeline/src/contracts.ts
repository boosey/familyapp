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

/** The pipeline stages Phase 1 ships. Adding a stage is a deliberate, named change. */
export type JobName = "transcribe" | "render_story";

export interface JobPayload {
  /** All Phase-1 pipeline jobs target a single Story. */
  storyId: string;
}

export interface EnqueuedJob {
  id: string;
  name: JobName;
  payload: JobPayload;
  enqueuedAt: Date;
  attempts: number;
}

export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface JobQueue {
  /**
   * Enqueue a stage. Returns the job id. Implementations may dedupe by (name, payload) — the
   * in-process impl below does, so re-enqueuing the same job is a no-op while a prior is pending.
   */
  enqueue(name: JobName, payload: JobPayload): Promise<string>;
  /** Register a handler for a stage. Calling twice for the same stage replaces the handler. */
  register(name: JobName, handler: JobHandler): void;
  /** Drain all pending jobs (running handlers). Returns when the queue is empty. */
  drain(): Promise<void>;
  /** Inspect pending jobs — for tests, retry inspection, and observability. */
  pending(): EnqueuedJob[];
}
