/**
 * Adapter tests — no live API calls. We inject a stubbed `fetch` and verify the seam shape:
 * request translation (endpoint, auth header, model, messages, max_tokens, temperature,
 * json mode) and response shape (content extraction, modelId echo), plus error paths.
 */
import { describe, expect, it, vi } from "vitest";
import { createGroqLanguageModel, GroqLanguageModelError } from "../src/index";

function jsonResponse(payload: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const fetchImpl = vi.fn(async (_url: unknown, _init: unknown) => response);
  return { fetchImpl: fetchImpl as unknown as typeof fetch, fetchSpy: fetchImpl };
}

const OK = { model: "llama-3.3-70b-versatile", choices: [{ message: { content: "hello" } }] };

function parseBody(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchSpy.mock.calls[0]![1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("createGroqLanguageModel", () => {
  it("POSTs to the chat-completions endpoint with a bearer token and JSON content-type", async () => {
    const { fetchImpl, fetchSpy } = stubFetch(jsonResponse(OK));
    const llm = createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl });
    await llm.complete({ messages: [{ role: "user", content: "hi" }] });
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer k");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("forwards messages, model, and max_tokens; defaults model and max_tokens", async () => {
    const { fetchImpl, fetchSpy } = stubFetch(jsonResponse(OK));
    const llm = createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl });
    await llm.complete({
      messages: [
        { role: "system", content: "BE TERSE" },
        { role: "user", content: "q" },
      ],
    });
    const body = parseBody(fetchSpy);
    expect(body["model"]).toBe("llama-3.3-70b-versatile");
    expect(body["max_tokens"]).toBe(4000);
    expect(body["messages"]).toEqual([
      { role: "system", content: "BE TERSE" },
      { role: "user", content: "q" },
    ]);
  });

  it("honors model and max_tokens overrides", async () => {
    const { fetchImpl, fetchSpy } = stubFetch(jsonResponse(OK));
    const llm = createGroqLanguageModel({
      apiKey: "k",
      fetch: fetchImpl,
      model: "llama-3.1-8b-instant",
    });
    await llm.complete({ messages: [{ role: "user", content: "q" }], maxOutputTokens: 200 });
    const body = parseBody(fetchSpy);
    expect(body["model"]).toBe("llama-3.1-8b-instant");
    expect(body["max_tokens"]).toBe(200);
  });

  it("forwards temperature when set and omits it when undefined", async () => {
    const { fetchImpl: f1, fetchSpy: s1 } = stubFetch(jsonResponse(OK));
    await createGroqLanguageModel({ apiKey: "k", fetch: f1 }).complete({
      messages: [{ role: "user", content: "q" }],
      temperature: 0.7,
    });
    expect(parseBody(s1)["temperature"]).toBe(0.7);

    const { fetchImpl: f2, fetchSpy: s2 } = stubFetch(jsonResponse(OK));
    await createGroqLanguageModel({ apiKey: "k", fetch: f2 }).complete({
      messages: [{ role: "user", content: "q" }],
    });
    expect("temperature" in parseBody(s2)).toBe(false);
  });

  it("forwards temperature: 0 (falsy but defined — the extraction call sites rely on this)", async () => {
    // Regression guard: `temperature: 0` is the deterministic value used by biographical/intake
    // extraction. A naive `if (req.temperature)` would silently drop it; `!== undefined` keeps it.
    const { fetchImpl, fetchSpy } = stubFetch(jsonResponse(OK));
    await createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl }).complete({
      messages: [{ role: "user", content: "q" }],
      temperature: 0,
    });
    expect(parseBody(fetchSpy)["temperature"]).toBe(0);
  });

  it("sets response_format json_object only when responseFormat is json", async () => {
    const { fetchImpl: f1, fetchSpy: s1 } = stubFetch(jsonResponse(OK));
    await createGroqLanguageModel({ apiKey: "k", fetch: f1 }).complete({
      // Must contain the word "json" — Groq's json_object mode requires it (see adapter guard).
      messages: [{ role: "system", content: "Return JSON." }, { role: "user", content: "q" }],
      responseFormat: "json",
    });
    expect(parseBody(s1)["response_format"]).toEqual({ type: "json_object" });

    const { fetchImpl: f2, fetchSpy: s2 } = stubFetch(jsonResponse(OK));
    await createGroqLanguageModel({ apiKey: "k", fetch: f2 }).complete({
      messages: [{ role: "user", content: "q" }],
      responseFormat: "text",
    });
    expect("response_format" in parseBody(s2)).toBe(false);
  });

  it("throws (fail fast) when json mode is requested but no message contains the word 'json'", async () => {
    // Surfaces Groq's json_object prompt requirement at the caller's layer instead of as a
    // cryptic vendor HTTP 400. No fetch should even be attempted.
    const { fetchImpl, fetchSpy } = stubFetch(jsonResponse(OK));
    const llm = createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl });
    await expect(
      llm.complete({
        messages: [{ role: "user", content: "no marker here" }],
        responseFormat: "json",
      }),
    ).rejects.toThrow(/requires the word 'json'/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts the assistant content and echoes the served model id", async () => {
    const { fetchImpl } = stubFetch(
      jsonResponse({ model: "llama-3.3-70b-versatile", choices: [{ message: { content: "the prose" } }] }),
    );
    const out = await createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl }).complete({
      messages: [{ role: "user", content: "q" }],
    });
    expect(out.text).toBe("the prose");
    expect(out.modelId).toBe("llama-3.3-70b-versatile");
  });

  it("returns empty text when the response has no choices (defensive parse upstream handles it)", async () => {
    const { fetchImpl } = stubFetch(jsonResponse({ model: "m", choices: [] }));
    const out = await createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl }).complete({
      messages: [{ role: "user", content: "q" }],
    });
    expect(out.text).toBe("");
    expect(out.modelId).toBe("m");
  });

  it("falls back to the requested model id when the vendor omits `model`", async () => {
    const { fetchImpl } = stubFetch(jsonResponse({ choices: [{ message: { content: "x" } }] }));
    const out = await createGroqLanguageModel({
      apiKey: "k",
      fetch: fetchImpl,
      model: "llama-3.1-8b-instant",
    }).complete({ messages: [{ role: "user", content: "q" }] });
    expect(out.modelId).toBe("llama-3.1-8b-instant");
  });

  it("throws GroqLanguageModelError on a non-2xx response, capturing status and body", async () => {
    const { fetchImpl } = stubFetch(
      jsonResponse({ error: "rate limited" }, { status: 429, ok: false }),
    );
    const llm = createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl });
    await expect(llm.complete({ messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject(
      { name: "GroqLanguageModelError", status: 429 },
    );
  });

  it("throws GroqLanguageModelError on a non-JSON success body", async () => {
    const badResponse = {
      ok: true,
      status: 200,
      text: async () => "<html>gateway</html>",
    } as unknown as Response;
    const { fetchImpl } = stubFetch(badResponse);
    const llm = createGroqLanguageModel({ apiKey: "k", fetch: fetchImpl });
    await expect(
      llm.complete({ messages: [{ role: "user", content: "q" }] }),
    ).rejects.toBeInstanceOf(GroqLanguageModelError);
  });

  it("throws a clear error when no API key is available", async () => {
    const original = process.env["GROQ_API_KEY"];
    delete process.env["GROQ_API_KEY"];
    try {
      const { fetchImpl } = stubFetch(jsonResponse(OK));
      const llm = createGroqLanguageModel({ fetch: fetchImpl });
      await expect(
        llm.complete({ messages: [{ role: "user", content: "q" }] }),
      ).rejects.toThrow(/no API key/);
    } finally {
      if (original !== undefined) process.env["GROQ_API_KEY"] = original;
    }
  });
});
