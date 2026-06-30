/**
 * xAI Grok speech-to-text adapter for the `Transcriber` seam.
 *
 * Lives outside the IP packages: the vendor-SDK guard in
 * `packages/pipeline/test/pipeline.test.ts` scans `@chronicle/{core,db,storage,capture,pipeline,
 * interviewer}` for vendor imports — this package is intentionally outside that set.
 *
 * Talks to xAI's standalone STT endpoint (`POST https://api.x.ai/v1/stt`) via `fetch` (no SDK
 * dep) so this adapter stays a thin shell. `fetch` is injectable for tests; no live calls in CI.
 *
 * Defaults: model = `grok-stt`.
 *
 * Differences from the Groq adapter (intentional, per the xAI REST contract):
 *  - Dedicated `/v1/stt` endpoint, NOT the OpenAI-compatible `/audio/transcriptions` shape.
 *  - Word objects use `text` (not `word`) and return `start`/`end` in SECONDS (2 d.p.).
 *  - There is no `response_format`/`timestamp_granularities` request param — word-level timings
 *    are part of the default JSON response, so we send neither.
 *  - `format` (Inverse Text Normalization) requires `language`; we guard that locally instead of
 *    letting the vendor 400.
 *  - Container detection: xAI auto-detects the container from the bytes for compressed formats.
 *    The `audio_format`/`sample_rate` hints documented by xAI are for RAW audio (pcm/mulaw/…);
 *    our capture layer emits WebM/Opus, which is not in xAI's `audio_format` enum, so we rely on
 *    auto-detection and only send `audio_format` if the caller explicitly sets it. We still attach
 *    a filename on the multipart part as a secondary hint.
 *
 * NOTE on contract: the orchestrator feeds us the WORKING-COPY bytes (VAD-trimmed, optionally
 * time-stretched). We return word timings in those same WORKING-COPY milliseconds; the
 * orchestrator then maps them back to ORIGINAL 1x time via `mapWorkingCopyMsToOriginalMs` before
 * persisting. This adapter MUST NOT do that mapping itself — only the orchestrator knows the
 * segment table. Diarization (`speaker`) is dropped: the contract's `WordTiming` has no speaker
 * field and Phase 1 capture is single-narrator.
 */
import type {
  TranscribeInput,
  Transcriber,
  TranscriptionResult,
  WordTiming,
} from "@chronicle/pipeline";

const DEFAULT_MODEL = "grok-stt";
const DEFAULT_ENDPOINT = "https://api.x.ai/v1/stt";

/** xAI's documented `audio_format` enum — only meaningful for RAW audio inputs. */
export type XaiAudioFormat =
  | "pcm"
  | "mulaw"
  | "alaw"
  | "wav"
  | "mp3"
  | "ogg"
  | "opus"
  | "flac"
  | "aac"
  | "mp4"
  | "m4a"
  | "mkv";

export interface XaiTranscriberOptions {
  /** Reads from `XAI_API_KEY` if omitted. Throws on first call if neither is set. */
  apiKey?: string;
  /** Override the model id. Default: `grok-stt`. */
  model?: string;
  /** Override the transcription endpoint (for self-hosted / proxy / tests). */
  endpoint?: string;
  /** Injectable HTTP transport — tests stub this; prod uses global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Optional language hint (ISO-639-1, e.g. "en"). Passed through to the vendor. Leaving it
   * undefined lets the vendor auto-detect. REQUIRED if `format` is enabled (xAI constraint).
   */
  language?: string;
  /**
   * Enable xAI's Inverse Text Normalization ("format" param): turns spoken numbers/dates/etc.
   * into structured text. Requires `language` — we throw locally if it is missing rather than
   * letting the vendor reject the request.
   */
  format?: boolean;
  /**
   * Enable speaker diarization. We still drop the per-word `speaker` field (the `WordTiming`
   * contract has no place for it); exposed only so a future multi-speaker surface can flip it on
   * once the contract grows a speaker field.
   */
  diarize?: boolean;
  /**
   * Bias terms for known proper nouns / domain vocabulary (xAI `keyterm`, max 100 terms, 50 chars
   * each). This is xAI's equivalent of Groq's `prompt` bias. Per the spec the narrator's voice is
   * canonical — do NOT use this to put words in their mouth; reserve it for names the model
   * otherwise mistranscribes.
   */
  keyterms?: string[];
  /**
   * Explicit raw-audio container hint. Only set this for RAW formats (pcm/mulaw/…); for
   * compressed containers leave it undefined and let xAI auto-detect.
   */
  audioFormat?: XaiAudioFormat;
  /**
   * Filename to send in the multipart form — a secondary container hint. Default is inferred from
   * `contentType` (`audio.webm` for MediaRecorder's default).
   */
  filename?: string;
}

interface XaiSttWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}

interface XaiSttResponse {
  text: string;
  language?: string;
  duration?: number;
  words?: XaiSttWord[];
  // channels[] (multichannel) — ignored; Phase 1 capture is single-channel.
}

export class XaiTranscriberError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "XaiTranscriberError";
  }
}

export function createXaiTranscriber(opts: XaiTranscriberOptions = {}): Transcriber {
  const model = opts.model ?? DEFAULT_MODEL;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = opts.fetch ?? fetch;

  if (opts.format && !opts.language) {
    // Fail fast at construction — the misconfiguration is static, so don't wait for a vendor 400.
    throw new Error(
      "XaiTranscriber: `format` (Inverse Text Normalization) requires `language`.",
    );
  }

  // Resolve apiKey lazily so adapter construction at module load doesn't throw when env is unset
  // (the test harness, for instance, never calls .transcribe()).
  const resolveApiKey = (): string => {
    const key = opts.apiKey ?? process.env["XAI_API_KEY"];
    if (!key) {
      throw new Error(
        "XaiTranscriber: no API key. Pass `apiKey` or set XAI_API_KEY.",
      );
    }
    return key;
  };

  return {
    async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
      if (input.bytes.length === 0) {
        throw new Error("XaiTranscriber: received zero-byte audio input");
      }
      const apiKey = resolveApiKey();
      const filename = opts.filename ?? inferFilename(input.contentType);
      const form = new FormData();
      // Wrap bytes in a Blob — File extends Blob and the multipart contract uses filename via the
      // third arg to FormData.append.
      const blob = new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: input.contentType });
      form.append("file", blob, filename);
      form.append("model", model);
      if (opts.language) form.append("language", opts.language);
      if (opts.format) form.append("format", "true");
      if (opts.diarize) form.append("diarize", "true");
      if (opts.audioFormat) form.append("audio_format", opts.audioFormat);
      // xAI accepts repeated `keyterm` entries for the bias-terms array.
      for (const term of opts.keyterms ?? []) form.append("keyterm", term);

      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Content-Type is set automatically by fetch for FormData (with the boundary).
        },
        body: form,
      });

      if (!res.ok) {
        const body = await safeReadBody(res);
        throw new XaiTranscriberError(
          `xAI transcription failed: HTTP ${res.status}`,
          res.status,
          body,
        );
      }

      const rawBody = await res.text();
      let json: XaiSttResponse;
      try {
        json = JSON.parse(rawBody) as XaiSttResponse;
      } catch {
        const preview = rawBody.slice(0, 200);
        throw new XaiTranscriberError(
          `xAI transcription returned non-JSON body (HTTP ${res.status}): ${preview}`,
          res.status,
          rawBody,
        );
      }
      const text = (json.text ?? "").trim();
      // Word timings: vendor returns SECONDS (floats); the contract is milliseconds (integers,
      // working-copy time-base). Round to nearest ms so JSON comparisons are stable. The vendor
      // word field is `text` (not `word`); `speaker`/`confidence` are dropped.
      const words: WordTiming[] = (json.words ?? []).map((w) => ({
        word: w.text,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
      }));
      return { text, words, modelId: model };
    },
  };
}

function inferFilename(contentType: string): string {
  // A secondary container hint on the multipart part. We deliberately handle only the formats our
  // capture layer actually emits (webm/wav/mp3/m4a) plus a passthrough; an unknown content-type
  // defaults to .webm (MediaRecorder's default).
  const ct = contentType.toLowerCase();
  if (ct.includes("webm")) return "audio.webm";
  if (ct.includes("ogg")) return "audio.ogg";
  if (ct.includes("wav")) return "audio.wav";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "audio.mp3";
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("x-m4a")) return "audio.m4a";
  if (ct.includes("flac")) return "audio.flac";
  return "audio.webm";
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
