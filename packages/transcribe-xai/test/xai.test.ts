/**
 * Adapter tests — no live API calls. We inject a stubbed `fetch` and verify request shape
 * (URL, auth header, multipart fields) and response translation (text trim, seconds→ms word
 * timings via the xAI `text` word field, modelId echo).
 */
import { describe, expect, it, vi } from "vitest";
import { createXaiTranscriber, XaiTranscriberError } from "../src/index";

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// Tuple-typed fetch stub so `spy.mock.calls[0]` keeps `[url, init]` instead of collapsing to `[]`.
type FetchArgs = [string | URL, RequestInit?];
function fetchStub(impl: (...args: FetchArgs) => Promise<Response>) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(impl);
}

describe("createXaiTranscriber", () => {
  it("POSTs to the xAI /v1/stt endpoint with bearer auth + model, no response_format param", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({ text: "hello world", words: [] }),
    );
    const t = createXaiTranscriber({ apiKey: "xai-test", fetch: fetchSpy as unknown as typeof fetch });
    await t.transcribe({ bytes: bytes("xxx"), contentType: "audio/webm" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.x.ai/v1/stt");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe("Bearer xai-test");
    // FormData is opaque to assertions; round-trip via a Request to read fields.
    const fields = await readFormFields(init!.body as FormData);
    expect(fields.get("model")).toBe("grok-stt");
    // xAI returns words by default — these OpenAI-style params must NOT be sent.
    expect(fields.get("response_format")).toBeNull();
    expect(fields.getAll("timestamp_granularities[]")).toEqual([]);
    const file = fields.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe("audio/webm");
    expect((file as File).name).toBe("audio.webm");
  });

  it("converts seconds to milliseconds (rounded) from the xAI `text` word field", async () => {
    const fetchImpl = fetchStub(async () =>
      jsonResponse({
        text: " hello world ",
        words: [
          { text: "hello", start: 0.0, end: 0.4567, confidence: 0.99 },
          { text: "world", start: 0.5012, end: 1.2, speaker: 0 },
        ],
      }),
    );
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    const out = await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });

    expect(out.text).toBe("hello world"); // trimmed
    expect(out.modelId).toBe("grok-stt");
    // `confidence` and `speaker` are intentionally dropped — not in the WordTiming contract.
    expect(out.words).toEqual([
      { word: "hello", startMs: 0, endMs: 457 },
      { word: "world", startMs: 501, endMs: 1200 },
    ]);
  });

  it("treats a missing `words` array as no timings, not a crash", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok" }));
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    const out = await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });
    expect(out.words).toEqual([]);
  });

  it("honors model override", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({
      apiKey: "k",
      model: "grok-stt-next",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const out = await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });
    expect(out.modelId).toBe("grok-stt-next");
    const fields = await readFormFields(fetchImpl.mock.calls[0]![1]!.body as FormData);
    expect(fields.get("model")).toBe("grok-stt-next");
  });

  it("forwards optional language, format, diarize, audioFormat and keyterms", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({
      apiKey: "k",
      language: "en",
      format: true,
      diarize: true,
      audioFormat: "wav",
      keyterms: ["Acme Corp", "Sofia"],
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await t.transcribe({ bytes: bytes("x"), contentType: "audio/wav" });
    const fields = await readFormFields(fetchImpl.mock.calls[0]![1]!.body as FormData);
    expect(fields.get("language")).toBe("en");
    expect(fields.get("format")).toBe("true");
    expect(fields.get("diarize")).toBe("true");
    expect(fields.get("audio_format")).toBe("wav");
    expect(fields.getAll("keyterm")).toEqual(["Acme Corp", "Sofia"]);
  });

  it("omits optional params when not provided", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });
    const fields = await readFormFields(fetchImpl.mock.calls[0]![1]!.body as FormData);
    expect(fields.get("language")).toBeNull();
    expect(fields.get("format")).toBeNull();
    expect(fields.get("diarize")).toBeNull();
    expect(fields.get("audio_format")).toBeNull();
    expect(fields.getAll("keyterm")).toEqual([]);
  });

  it("throws at construction when `format` is set without `language`", () => {
    expect(() =>
      createXaiTranscriber({ apiKey: "k", format: true }),
    ).toThrow(/format.*requires.*language/i);
  });

  it("picks a filename extension that matches the contentType", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    for (const [ct, expected] of [
      ["audio/webm", "audio.webm"],
      ["audio/ogg; codecs=opus", "audio.ogg"],
      ["audio/wav", "audio.wav"],
      ["audio/mpeg", "audio.mp3"],
      ["audio/mp4", "audio.m4a"],
      ["audio/x-m4a", "audio.m4a"],
      ["audio/flac", "audio.flac"],
      ["application/octet-stream", "audio.webm"], // fallback
    ] as const) {
      await t.transcribe({ bytes: bytes("x"), contentType: ct });
      const fields = await readFormFields(
        fetchImpl.mock.calls.at(-1)![1]!.body as FormData,
      );
      const file = fields.get("file") as File;
      expect(file.name).toBe(expected);
    }
  });

  it("throws XaiTranscriberError with status and body on non-2xx", async () => {
    const fetchImpl = fetchStub(async () =>
      new Response("rate limited", { status: 429, headers: { "content-type": "text/plain" } }),
    );
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    await expect(
      t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" }),
    ).rejects.toMatchObject({
      name: "XaiTranscriberError",
      status: 429,
      responseBody: "rate limited",
    });
    await expect(
      t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" }),
    ).rejects.toBeInstanceOf(XaiTranscriberError);
  });

  it("throws XaiTranscriberError with a helpful preview on non-JSON 200 body", async () => {
    const html = "<!doctype html><html><body>Bad Gateway proxy page</body></html>";
    const fetchImpl = fetchStub(async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    );
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    await expect(
      t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" }),
    ).rejects.toMatchObject({
      name: "XaiTranscriberError",
      status: 200,
      responseBody: html,
    });
    await expect(
      t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" }),
    ).rejects.toThrow(/non-JSON/);
  });

  it("honors endpoint override", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const proxy = "https://proxy.example.com/v1/stt";
    const t = createXaiTranscriber({
      apiKey: "k",
      endpoint: proxy,
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(proxy);
  });

  it("rejects zero-byte audio without calling fetch", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({ apiKey: "k", fetch: fetchImpl as unknown as typeof fetch });
    await expect(
      t.transcribe({ bytes: new Uint8Array(0), contentType: "audio/webm" }),
    ).rejects.toThrow(/zero-byte audio/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors the filename override option", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse({ text: "ok", words: [] }));
    const t = createXaiTranscriber({
      apiKey: "k",
      filename: "custom.flac",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" });
    const fields = await readFormFields(fetchImpl.mock.calls[0]![1]!.body as FormData);
    const file = fields.get("file") as File;
    expect(file.name).toBe("custom.flac");
  });

  it("throws a clear error when no API key is configured", async () => {
    const prev = process.env["XAI_API_KEY"];
    delete process.env["XAI_API_KEY"];
    try {
      const t = createXaiTranscriber({ fetch: (async () => new Response()) as unknown as typeof fetch });
      await expect(
        t.transcribe({ bytes: bytes("x"), contentType: "audio/webm" }),
      ).rejects.toThrow(/XAI_API_KEY/);
    } finally {
      if (prev !== undefined) process.env["XAI_API_KEY"] = prev;
    }
  });
});

// Read FormData fields back via a Request round-trip — vitest/node FormData has no introspection.
async function readFormFields(form: FormData): Promise<FormData> {
  const req = new Request("https://x.test", { method: "POST", body: form });
  return await req.formData();
}
