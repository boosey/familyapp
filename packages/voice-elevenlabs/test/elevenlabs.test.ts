/**
 * Adapter tests — no live API calls. We inject a stubbed `fetch` and verify request shape
 * (URL, headers, JSON body) plus response translation (bytes, contentType, modelId echo,
 * voice id resolution, error mapping, missing-key behavior).
 */
import { describe, expect, it, vi } from "vitest";
import { createElevenLabsVoice, ElevenLabsVoiceError } from "../src/index";

function audioResponse(payload: Uint8Array, init: { status?: number } = {}): Response {
  return new Response(payload, {
    status: init.status ?? 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

const FAKE_MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03]);

// Tuple-typed fetch stub so `spy.mock.calls[0]` keeps `[url, init]` instead of collapsing to `[]`.
type FetchArgs = [string | URL, RequestInit?];
function fetchStub(impl: (...args: FetchArgs) => Promise<Response>) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(impl);
}

describe("createElevenLabsVoice", () => {
  it("POSTs to /v1/text-to-speech/{voiceId} with xi-api-key + JSON body + output_format query", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "xi-test",
      defaultVoiceId: "voice-123",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const out = await v.speak({ text: "Hello, Sofia." });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128",
    );
    expect(init?.method).toBe("POST");
    const headers = new Headers(init!.headers);
    expect(headers.get("xi-api-key")).toBe("xi-test");
    expect(headers.get("content-type")).toBe("application/json");
    // Pin the decision: output format is selected via the `output_format` query param ONLY.
    // No `accept` header — it would contradict the query param on this endpoint.
    expect(headers.get("accept")).toBeNull();
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body["text"]).toBe("Hello, Sofia.");
    expect(body["model_id"]).toBe("eleven_turbo_v2_5");
    expect(body["voice_settings"]).toBeUndefined();

    expect(out.bytes).toEqual(FAKE_MP3);
    expect(out.contentType).toBe("audio/mpeg");
    expect(out.durationMs).toBe(0);
    expect(out.modelId).toBe("eleven_turbo_v2_5");
  });

  it("prefers input.voiceId over the configured default", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "default-voice",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await v.speak({ text: "x", voiceId: "override-voice" });
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/text-to-speech/override-voice?");
  });

  it("throws a clear error when neither input.voiceId nor defaultVoiceId is set", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "k",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(v.speak({ text: "x" })).rejects.toThrow(/voice id/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("honors model override and echoes it as modelId", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "v",
      model: "eleven_multilingual_v2",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const out = await v.speak({ text: "x" });
    expect(out.modelId).toBe("eleven_multilingual_v2");
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body["model_id"]).toBe("eleven_multilingual_v2");
  });

  it("forwards voice_settings when configured", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "v",
      voiceSettings: { stability: 0.5, similarity_boost: 0.8 },
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await v.speak({ text: "x" });
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body["voice_settings"]).toEqual({ stability: 0.5, similarity_boost: 0.8 });
  });

  it("honors outputFormat + contentType overrides (query param and result MIME)", async () => {
    const fetchSpy = fetchStub(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        }),
    );
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "v",
      outputFormat: "pcm_16000",
      contentType: "audio/wav",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    const out = await v.speak({ text: "x" });
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("output_format=pcm_16000");
    expect(out.contentType).toBe("audio/wav");
  });

  it("throws ElevenLabsVoiceError with status and body on non-2xx", async () => {
    const fetchImpl = fetchStub(async () =>
      new Response("quota exceeded", {
        status: 429,
        headers: { "content-type": "text/plain" },
      }),
    );
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "v",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await expect(v.speak({ text: "x" })).rejects.toMatchObject({
      name: "ElevenLabsVoiceError",
      status: 429,
      responseBody: "quota exceeded",
    });
    await expect(v.speak({ text: "x" })).rejects.toBeInstanceOf(ElevenLabsVoiceError);
  });

  it("throws a clear error when no API key is configured", async () => {
    const prev = process.env["ELEVENLABS_API_KEY"];
    delete process.env["ELEVENLABS_API_KEY"];
    try {
      const v = createElevenLabsVoice({
        defaultVoiceId: "v",
        fetch: (async () => new Response()) as unknown as typeof fetch,
      });
      await expect(v.speak({ text: "x" })).rejects.toThrow(/ELEVENLABS_API_KEY/);
    } finally {
      if (prev !== undefined) process.env["ELEVENLABS_API_KEY"] = prev;
    }
  });

  it("throws ElevenLabsVoiceError when a 200 response has an empty body", async () => {
    const fetchSpy = fetchStub(
      async () =>
        new Response(new Uint8Array(0), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        }),
    );
    const v = createElevenLabsVoice({
      apiKey: "k",
      defaultVoiceId: "v",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await expect(v.speak({ text: "x" })).rejects.toMatchObject({
      name: "ElevenLabsVoiceError",
      status: 200,
    });
    await expect(v.speak({ text: "x" })).rejects.toBeInstanceOf(ElevenLabsVoiceError);
  });

  it("encodes special characters in the voice id path segment", async () => {
    const fetchSpy = fetchStub(async () => audioResponse(FAKE_MP3));
    const v = createElevenLabsVoice({
      apiKey: "k",
      fetch: fetchSpy as unknown as typeof fetch,
    });
    await v.speak({ text: "x", voiceId: "weird id/with?chars" });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/text-to-speech/weird%20id%2Fwith%3Fchars?");
  });
});
