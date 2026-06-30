/**
 * Groq adapter for the `LanguageModel` seam.
 *
 * Lives outside the IP packages on purpose — the vendor guard in
 * `packages/pipeline/test/pipeline.test.ts` scans `@chronicle/{core,db,storage,capture,
 * pipeline,interviewer}`; this package is intentionally outside that set. The render/phraser/
 * extraction prompts still live in the IP packages; this adapter just translates the assembled
 * messages onto Groq's OpenAI-compatible chat-completions API and the model id back off.
 *
 * Talks to Groq via `fetch` (no SDK dep) so the adapter stays a thin shell — mirrors
 * `@chronicle/transcribe-groq`. `fetch` and `apiKey` are injectable; no live calls in CI.
 *
 * Default model: `llama-3.3-70b-versatile`. For the Phase-1 verification pass we run EVERY LLM
 * task on one Groq model to minimize new surface; individual call sites can later be split onto
 * cheaper/faster models (e.g. `llama-3.1-8b-instant` for the single-field extractions) by
 * constructing a second adapter instance — the seam fixes one model per instance.
 */
import type {
  LanguageModel,
  LanguageModelMessage,
  LanguageModelRequest,
  LanguageModelResponse,
} from "@chronicle/pipeline";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 4000;

export interface GroqLanguageModelOptions {
  /** Reads from `GROQ_API_KEY` if omitted. Throws on first `.complete()` if neither is set. */
  apiKey?: string;
  /** Override the model id. Default: `llama-3.3-70b-versatile`. */
  model?: string;
  /** Override the chat-completions endpoint (for self-hosted / proxy / tests). */
  endpoint?: string;
  /** Injectable HTTP transport — tests stub this; prod uses global `fetch`. */
  fetch?: typeof fetch;
}

interface GroqChatCompletion {
  /** The model that actually served the request — echoed back as `modelId`. */
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
}

export class GroqLanguageModelError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "GroqLanguageModelError";
  }
}

export function createGroqLanguageModel(
  opts: GroqLanguageModelOptions = {},
): LanguageModel {
  const model = opts.model ?? DEFAULT_MODEL;
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = opts.fetch ?? fetch;
  // Resolve apiKey lazily so adapter construction at module load doesn't throw when env is unset
  // (the runtime builds the adapter eagerly; only `.complete()` requires a key).
  const resolveApiKey = (): string => {
    const key = opts.apiKey ?? process.env["GROQ_API_KEY"];
    if (!key) {
      throw new Error(
        "GroqLanguageModel: no API key. Pass `apiKey` or set GROQ_API_KEY.",
      );
    }
    return key;
  };

  return {
    async complete(req: LanguageModelRequest): Promise<LanguageModelResponse> {
      const apiKey = resolveApiKey();
      const body: Record<string, unknown> = {
        model,
        // OpenAI message roles map 1:1 onto our seam's roles (system/user/assistant).
        messages: req.messages.map((m: LanguageModelMessage) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      };
      // Omit temperature entirely when unspecified so the vendor default applies (mirrors the
      // Anthropic adapter; some Groq models reject explicit values they don't support).
      if (req.temperature !== undefined) body["temperature"] = req.temperature;
      // JSON mode: Groq's `json_object` mode rejects (HTTP 400) any request whose prompt does not
      // contain the literal word "json". Fail fast HERE with a clear message rather than letting a
      // future call site discover that constraint as a mysterious vendor 400. The current json call
      // site (render-story.ts) already satisfies it ("Return STRICT JSON"); extract-biography.ts
      // asks for JSON via `responseFormat: "text"` and is intentionally unaffected.
      if (req.responseFormat === "json") {
        const promptText = req.messages.map((m) => m.content).join(" ").toLowerCase();
        if (!promptText.includes("json")) {
          throw new Error(
            "GroqLanguageModel: json_object mode requires the word 'json' to appear somewhere in " +
              "the prompt (Groq API requirement). Add it to the system or user message.",
          );
        }
        body["response_format"] = { type: "json_object" };
      }

      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await safeReadBody(res);
        throw new GroqLanguageModelError(
          `Groq chat completion failed: HTTP ${res.status}`,
          res.status,
          errBody,
        );
      }

      const rawBody = await res.text();
      let json: GroqChatCompletion;
      try {
        json = JSON.parse(rawBody) as GroqChatCompletion;
      } catch {
        const preview = rawBody.slice(0, 200);
        throw new GroqLanguageModelError(
          `Groq chat completion returned non-JSON body (HTTP ${res.status}): ${preview}`,
          res.status,
          rawBody,
        );
      }

      const text = json.choices?.[0]?.message?.content ?? "";
      // Echo the model the vendor reports if present, else the requested id — the pipeline records
      // this as render/transcribe provenance.
      return { text, modelId: json.model ?? model };
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
