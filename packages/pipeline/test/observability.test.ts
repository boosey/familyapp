/**
 * The logging wrappers are wired in permanently (in the web runtime), so their ONE invariant is
 * transparency: pass the request through unchanged, return the inner result unchanged, call the
 * inner adapter exactly once, and re-throw on error. These tests guard that — a wrapper that
 * mutated payloads or swallowed errors would silently corrupt the pipeline.
 *
 * (Logging output itself is gated off under Vitest — see logger.ts — so these run quietly.)
 */
import { describe, expect, it, vi } from "vitest";
import {
  withLanguageModelLogging,
  withTranscriberLogging,
  pipelineLogEnabled,
  newCorrelationId,
  withLogContext,
} from "../src/index";
import type {
  LanguageModel,
  LanguageModelRequest,
  Transcriber,
  TranscribeInput,
} from "../src/index";

describe("logging is suppressed under test", () => {
  it("pipelineLogEnabled is false when VITEST is set", () => {
    expect(process.env["VITEST"]).toBeTruthy();
    expect(pipelineLogEnabled).toBe(false);
  });
});

describe("correlation context", () => {
  it("newCorrelationId returns short, distinct ids", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).toHaveLength(8);
    expect(a).not.toBe(b);
  });

  it("withLogContext runs the callback and returns its result", async () => {
    const out = await withLogContext(newCorrelationId(), async () => 42);
    expect(out).toBe(42);
  });
});

describe("withTranscriberLogging", () => {
  const input: TranscribeInput = { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" };

  it("passes the input through and returns the inner result unchanged", async () => {
    const result = { text: "hello", words: [{ word: "hello", startMs: 0, endMs: 100 }], modelId: "m" };
    const inner: Transcriber = { transcribe: vi.fn(async () => result) };
    const wrapped = withTranscriberLogging(inner, "test");

    const out = await wrapped.transcribe(input);

    expect(out).toBe(result); // same reference — not a copy
    expect(inner.transcribe).toHaveBeenCalledTimes(1);
    expect(inner.transcribe).toHaveBeenCalledWith(input);
  });

  it("re-throws the inner error unchanged", async () => {
    const boom = new Error("vendor down");
    const inner: Transcriber = { transcribe: vi.fn(async () => { throw boom; }) };
    const wrapped = withTranscriberLogging(inner);

    await expect(wrapped.transcribe(input)).rejects.toBe(boom);
  });
});

describe("withLanguageModelLogging", () => {
  const req: LanguageModelRequest = {
    messages: [{ role: "user", content: "hi" }],
    responseFormat: "json",
    temperature: 0.2,
  };

  it("passes the request through and returns the inner result unchanged", async () => {
    const result = { text: "{}", modelId: "llm" };
    const inner: LanguageModel = { complete: vi.fn(async () => result) };
    const wrapped = withLanguageModelLogging(inner, "test");

    const out = await wrapped.complete(req);

    expect(out).toBe(result);
    expect(inner.complete).toHaveBeenCalledTimes(1);
    expect(inner.complete).toHaveBeenCalledWith(req);
  });

  it("re-throws the inner error unchanged", async () => {
    const boom = new Error("rate limited");
    const inner: LanguageModel = { complete: vi.fn(async () => { throw boom; }) };
    const wrapped = withLanguageModelLogging(inner);

    await expect(wrapped.complete(req)).rejects.toBe(boom);
  });
});
