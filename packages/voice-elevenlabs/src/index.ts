/**
 * ElevenLabs adapter for the `Voice` seam.
 *
 * Lives outside the IP packages: the vendor-SDK guard in
 * `packages/pipeline/test/pipeline.test.ts` scans `@chronicle/{core,db,storage,capture,pipeline,
 * interviewer}` for vendor imports — this package is intentionally outside that set.
 *
 * Talks to ElevenLabs' TTS HTTP endpoint via `fetch` (no SDK dep) so this adapter stays a thin
 * shell — the IP (prompt assembly, persona selection, sequencing) lives in `@chronicle/interviewer`.
 * `fetch` is injectable for tests; no live calls in CI.
 *
 * Defaults: model = `eleven_turbo_v2_5` (current low-latency default per DECISIONS).
 * Output format: MPEG (`audio/mpeg`) — playable directly in a browser `<audio>` tag and the
 *   safest default across browsers / `MediaSource` consumers. We pin it via the `output_format`
 *   query param (the documented mechanism on this endpoint). We deliberately do NOT send an
 *   `Accept` header: setting both would be contradictory and the query param is authoritative.
 *
 * `durationMs` is returned as 0: the non-streaming TTS endpoint does not surface a reliable
 *   duration, and parsing MP3 frame headers would be overkill for the turn-loop's pacing needs.
 *   The contract documents this field as best-effort.
 */
import type {
  Voice,
  VoiceSpeakInput,
  VoiceSpeakResult,
} from "@chronicle/interviewer";

const DEFAULT_MODEL = "eleven_turbo_v2_5";
const DEFAULT_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_CONTENT_TYPE = "audio/mpeg";

export interface ElevenLabsVoiceOptions {
  /** Reads from `ELEVENLABS_API_KEY` if omitted. Throws on first call if neither is set. */
  apiKey?: string;
  /** Override the TTS model id. Default: `eleven_turbo_v2_5`. */
  model?: string;
  /**
   * Default voice id used when `VoiceSpeakInput.voiceId` is not provided. The interviewer's
   * persona-stability requirement (same warm voice every session) means production callers
   * normally configure exactly one here.
   */
  defaultVoiceId?: string;
  /** Override the TTS endpoint base (for self-hosted / proxy / tests). */
  endpoint?: string;
  /**
   * ElevenLabs `output_format` query param. Default: `mp3_44100_128` → `audio/mpeg`.
   * If overridden, also set `contentType` so callers see the right MIME on the result.
   */
  outputFormat?: string;
  /** MIME for the returned bytes. Default: `audio/mpeg`. Pair with `outputFormat`. */
  contentType?: string;
  /**
   * Optional voice_settings forwarded verbatim (stability, similarity_boost, style, etc.).
   * Kept opaque so persona tuning stays a config concern, not adapter logic.
   */
  voiceSettings?: Record<string, unknown>;
  /** Injectable HTTP transport — tests stub this; prod uses global `fetch`. */
  fetch?: typeof fetch;
}

export class ElevenLabsVoiceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "ElevenLabsVoiceError";
  }
}

export function createElevenLabsVoice(opts: ElevenLabsVoiceOptions = {}): Voice {
  const model = opts.model ?? DEFAULT_MODEL;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const outputFormat = opts.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const contentType = opts.contentType ?? DEFAULT_CONTENT_TYPE;
  const fetchImpl = opts.fetch ?? fetch;

  // Lazy: don't throw at construction time so module load (e.g. test harness) works without env.
  const resolveApiKey = (): string => {
    const key = opts.apiKey ?? process.env["ELEVENLABS_API_KEY"];
    if (!key) {
      throw new Error(
        "ElevenLabsVoice: no API key. Pass `apiKey` or set ELEVENLABS_API_KEY.",
      );
    }
    return key;
  };

  const resolveVoiceId = (input: VoiceSpeakInput): string => {
    const id = input.voiceId ?? opts.defaultVoiceId;
    if (!id) {
      throw new Error(
        "ElevenLabsVoice: no voice id. Pass `input.voiceId` or configure `defaultVoiceId`.",
      );
    }
    return id;
  };

  return {
    async speak(input: VoiceSpeakInput): Promise<VoiceSpeakResult> {
      const apiKey = resolveApiKey();
      const voiceId = resolveVoiceId(input);
      const url = `${endpoint}/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;

      const body: Record<string, unknown> = {
        text: input.text,
        model_id: model,
      };
      if (opts.voiceSettings) body["voice_settings"] = opts.voiceSettings;

      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await safeReadBody(res);
        throw new ElevenLabsVoiceError(
          `ElevenLabs TTS failed: HTTP ${res.status}`,
          res.status,
          errBody,
        );
      }

      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        throw new ElevenLabsVoiceError(
          "ElevenLabs returned empty audio body (HTTP 200)",
          res.status,
          "",
        );
      }
      return {
        bytes: new Uint8Array(buf),
        contentType,
        // Best-effort: the non-streaming endpoint doesn't return duration; the contract permits 0.
        durationMs: 0,
        modelId: model,
      };
    },
  };
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
