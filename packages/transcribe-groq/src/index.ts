/**
 * Groq Whisper adapter for the `Transcriber` seam.
 *
 * Lives outside the IP packages: the vendor-SDK guard in
 * `packages/pipeline/test/pipeline.test.ts` scans `@chronicle/{core,db,storage,capture,pipeline,
 * interviewer}` for vendor imports — this package is intentionally outside that set.
 *
 * Talks to Groq's OpenAI-compatible transcription endpoint via `fetch` (no SDK dep) so this
 * adapter stays a thin shell. `fetch` is injectable for tests; no live calls in CI.
 *
 * Defaults: model = `whisper-large-v3-turbo` (per DECISIONS).
 *
 * NOTE on contract: the orchestrator feeds us the WORKING-COPY bytes (VAD-trimmed, optionally
 * time-stretched). We return word timings in those same WORKING-COPY milliseconds; the
 * orchestrator then maps them back to ORIGINAL 1x time via `mapWorkingCopyMsToOriginalMs` before
 * persisting. This adapter MUST NOT do that mapping itself — only the orchestrator knows the
 * segment table.
 */
import type {
  TranscribeInput,
  Transcriber,
  TranscriptionResult,
  WordTiming,
} from "@chronicle/pipeline";

const DEFAULT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface GroqTranscriberOptions {
  /** Reads from `GROQ_API_KEY` if omitted. Throws on first call if neither is set. */
  apiKey?: string;
  /** Override the model id. Default: `whisper-large-v3-turbo`. */
  model?: string;
  /** Override the transcription endpoint (for self-hosted / proxy / tests). */
  endpoint?: string;
  /** Injectable HTTP transport — tests stub this; prod uses global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Optional language hint (ISO-639-1, e.g. "en"). Passed through to the vendor. Leaving it
   * undefined lets the vendor auto-detect.
   */
  language?: string;
  /**
   * Optional prompt to bias the model (vendor's `prompt` parameter). Keep terse; the spec says
   * the narrator's voice is canonical, so do NOT use this to put words in their mouth — reserve
   * it for known proper nouns or domain terms that the model otherwise transliterates poorly.
   */
  prompt?: string;
  /**
   * Filename to send in the multipart form. The OpenAI-compatible API uses the extension to
   * pick a decoder; default is `audio.webm` which matches MediaRecorder's most common output.
   * Override if your contentType implies a different container (we infer when we can).
   */
  filename?: string;
}

interface GroqVerboseJson {
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
  // segments, language, duration, etc. — ignored; we only persist words + text.
}

export class GroqTranscriberError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "GroqTranscriberError";
  }
}

export function createGroqTranscriber(opts: GroqTranscriberOptions = {}): Transcriber {
  const model = opts.model ?? DEFAULT_MODEL;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = opts.fetch ?? fetch;
  // Resolve apiKey lazily so adapter construction at module load doesn't throw when env is unset
  // (the test harness, for instance, never calls .transcribe()).
  const resolveApiKey = (): string => {
    const key = opts.apiKey ?? process.env["GROQ_API_KEY"];
    if (!key) {
      throw new Error(
        "GroqTranscriber: no API key. Pass `apiKey` or set GROQ_API_KEY.",
      );
    }
    return key;
  };

  return {
    async transcribe(input: TranscribeInput): Promise<TranscriptionResult> {
      if (input.bytes.length === 0) {
        throw new Error("GroqTranscriber: received zero-byte audio input");
      }
      const apiKey = resolveApiKey();
      const filename = opts.filename ?? inferFilename(input.contentType);
      const form = new FormData();
      // Wrap bytes in a Blob — File extends Blob and the OpenAI multipart contract uses
      // filename via the third arg to FormData.append.
      const blob = new Blob([input.bytes as Uint8Array<ArrayBuffer>], { type: input.contentType });
      form.append("file", blob, filename);
      form.append("model", model);
      form.append("response_format", "verbose_json");
      // The OpenAI-compatible API accepts repeated `timestamp_granularities[]` entries.
      form.append("timestamp_granularities[]", "word");
      if (opts.language) form.append("language", opts.language);
      if (opts.prompt) form.append("prompt", opts.prompt);

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
        throw new GroqTranscriberError(
          `Groq transcription failed: HTTP ${res.status}`,
          res.status,
          body,
        );
      }

      const rawBody = await res.text();
      let json: GroqVerboseJson;
      try {
        json = JSON.parse(rawBody) as GroqVerboseJson;
      } catch {
        const preview = rawBody.slice(0, 200);
        throw new GroqTranscriberError(
          `Groq transcription returned non-JSON body (HTTP ${res.status}): ${preview}`,
          res.status,
          rawBody,
        );
      }
      const text = (json.text ?? "").trim();
      // Word timings: vendor returns seconds (floats); the contract is milliseconds (integers,
      // working-copy time-base). Round to nearest ms so JSON comparisons are stable.
      const words: WordTiming[] = (json.words ?? []).map((w) => ({
        word: w.word,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
      }));
      return { text, words, modelId: model };
    },
  };
}

function inferFilename(contentType: string): string {
  // The vendor uses the extension to pick a decoder; pick one that matches the MIME we were given.
  // We deliberately handle only the formats our capture layer actually emits (webm/wav/mp3/m4a)
  // plus a passthrough; an unknown content-type defaults to .webm (MediaRecorder's default).
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
