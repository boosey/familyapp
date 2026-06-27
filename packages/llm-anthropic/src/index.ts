/**
 * Anthropic adapter for the `LanguageModel` seam.
 *
 * Lives outside the IP packages on purpose — the vendor-SDK guard in
 * `packages/pipeline/test/pipeline.test.ts` only scans `@chronicle/{core,db,storage,
 * capture,pipeline,interviewer}`. This file is the only place `@anthropic-ai/sdk` may
 * be imported. The render/phraser prompts still live in the IP packages; the adapter
 * just translates messages on and modelId off.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
} from "@chronicle/pipeline";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4000;

export interface AnthropicLanguageModelOptions {
  /** Reads from `ANTHROPIC_API_KEY` if omitted. */
  apiKey?: string;
  /** Override the model id. Default: `claude-sonnet-4-6`. */
  model?: string;
  /** For tests: inject a pre-built SDK client. */
  client?: Pick<Anthropic, "messages">;
}

export function createAnthropicLanguageModel(
  opts: AnthropicLanguageModelOptions = {},
): LanguageModel {
  const model = opts.model ?? DEFAULT_MODEL;
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  return {
    async complete(req: LanguageModelRequest): Promise<LanguageModelResponse> {
      const { system, messages } = splitSystem(req.messages);
      const res = await client.messages.create({
        model,
        max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(system ? { system } : {}),
        messages,
      });
      return { text: extractText(res), modelId: res.model };
    },
  };
}

function splitSystem(
  msgs: LanguageModelRequest["messages"],
): { system: string | undefined; messages: Anthropic.MessageParam[] } {
  // Anthropic puts the system prompt in its own top-level field, not in `messages`.
  // Concatenate any/all system messages in order so an upstream layer that uses multiple
  // system blocks still works.
  const systemParts: string[] = [];
  const rest: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      rest.push({ role: m.role, content: m.content });
    }
  }
  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: rest,
  };
}

function extractText(res: Anthropic.Message): string {
  // We only ever send text. The response may contain multiple content blocks (e.g. thinking
  // + text) — concatenate every text block in order so partial responses still come through.
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
}
