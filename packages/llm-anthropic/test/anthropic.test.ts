/**
 * Adapter tests — no live API calls. We inject a stubbed Anthropic client and
 * verify the seam shape: request translation (system split, messages forwarded,
 * model id, max_tokens, temperature) and response shape (text concatenation,
 * modelId echoed back).
 */
import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicLanguageModel } from "../src/index";

type CreateArgs = Parameters<Anthropic["messages"]["create"]>[0];

function stubClient(reply: Partial<Anthropic.Message> & { content: Anthropic.Message["content"] }) {
  const create = vi.fn(async (_args: CreateArgs) => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...reply,
  }) as Anthropic.Message);
  return {
    client: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
    create,
  };
}

describe("createAnthropicLanguageModel", () => {
  it("hoists system message into the top-level `system` field", async () => {
    const { client, create } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const llm = createAnthropicLanguageModel({ client });
    await llm.complete({
      messages: [
        { role: "system", content: "BE TERSE" },
        { role: "user", content: "hi" },
      ],
    });
    const args = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(args.system).toBe("BE TERSE");
    expect(args.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("concatenates multiple system blocks in order", async () => {
    const { client, create } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const llm = createAnthropicLanguageModel({ client });
    await llm.complete({
      messages: [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: "q" },
      ],
    });
    const args = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(args.system).toBe("A\n\nB");
  });

  it("forwards maxOutputTokens and temperature", async () => {
    const { client, create } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const llm = createAnthropicLanguageModel({ client });
    await llm.complete({
      messages: [{ role: "user", content: "q" }],
      maxOutputTokens: 123,
      temperature: 0.7,
    });
    const args = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(args.max_tokens).toBe(123);
    expect(args.temperature).toBe(0.7);
  });

  it("omits temperature when caller does not specify one", async () => {
    const { client, create } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const llm = createAnthropicLanguageModel({ client });
    await llm.complete({ messages: [{ role: "user", content: "q" }] });
    const args = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(args.temperature).toBeUndefined();
  });

  it("defaults max_tokens to 4000 when caller does not specify one", async () => {
    const { client, create } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    const llm = createAnthropicLanguageModel({ client });
    await llm.complete({ messages: [{ role: "user", content: "q" }] });
    const args = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(args.max_tokens).toBe(4000);
  });

  it("defaults model to claude-sonnet-4-6 and honors override", async () => {
    const { client: c1, create: create1 } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    await createAnthropicLanguageModel({ client: c1 }).complete({
      messages: [{ role: "user", content: "q" }],
    });
    expect((create1.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming).model).toBe(
      "claude-sonnet-4-6",
    );

    const { client: c2, create: create2 } = stubClient({
      content: [{ type: "text", text: "ok", citations: null }],
    });
    await createAnthropicLanguageModel({ client: c2, model: "claude-opus-4-7" }).complete({
      messages: [{ role: "user", content: "q" }],
    });
    expect((create2.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming).model).toBe(
      "claude-opus-4-7",
    );
  });

  it("concatenates multiple text content blocks in the response", async () => {
    const { client } = stubClient({
      model: "claude-sonnet-4-6",
      content: [
        { type: "text", text: "hello ", citations: null },
        { type: "text", text: "world", citations: null },
      ],
    });
    const llm = createAnthropicLanguageModel({ client });
    const out = await llm.complete({ messages: [{ role: "user", content: "q" }] });
    expect(out.text).toBe("hello world");
    expect(out.modelId).toBe("claude-sonnet-4-6");
  });

  it("skips non-text content blocks (thinking, tool_use, etc.) when extracting text", async () => {
    // If a future caller asks for thinking, we should not crash on non-text blocks. Adapter
    // returns only the text portion; thinking is not surfaced through the LanguageModel seam.
    const { client } = stubClient({
      content: [
        { type: "thinking", thinking: "internal", signature: "sig" },
        { type: "text", text: "final", citations: null },
      ],
    });
    const llm = createAnthropicLanguageModel({ client });
    const out = await llm.complete({ messages: [{ role: "user", content: "q" }] });
    expect(out.text).toBe("final");
  });
});
