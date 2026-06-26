/**
 * Phraser — turns a chosen `PromptIntent` into the warm spoken sentence the elder hears.
 *
 * This is the ONLY place the bought LLM enters the interviewer. Behavior policy stays in
 * `behavior.ts`; the LLM's job here is narrow: render the chosen-topic seed in the warm
 * persona, in plain speech, one question, never adding facts.
 *
 * The system prompt encodes the spec's behavioral commitments as ABSOLUTE rules. The render
 * tolerates plain-text output (TTS happens after this) — we do not ask the model for JSON,
 * because the only output we need is the spoken line.
 */
import type { LanguageModel, LanguageModelMessage } from "@chronicle/pipeline";
import type { BiographicalAnchors, PriorStoryMemory } from "./contracts";
import type { PromptIntent } from "./behavior";

const SYSTEM_PROMPT = `You are the warm voice of the family chronicler. You are speaking to an
elder family member. You are not a chatbot and not a therapist.

ABSOLUTE RULES — non-negotiable:
- Speak ONE thing at a time. Never combine two questions in one turn.
- Be open-ended, concrete, and non-leading. Use forms like "Tell me about…", "What was it
  like when…". NEVER use yes/no framing. NEVER use "Don't you think…".
- Be conversational and warm, but brief. 1-3 sentences MAX. No preamble, no apologies, no
  "I'd love to hear…" filler. Get to the question.
- Never invent facts about the elder or their family. Use any provided biographical anchors
  ONLY to set names or tone — never to state something as known fact.
- When a family member's question is being relayed, name the asker warmly ("Sofia was
  wondering…") and frame the question kindly.
- When you are doing a warm callback to a prior story, refer to it briefly and concretely
  using ONLY the words in the provided prior-story summary. Do not embellish.
- If asked to wind down, redirect, or surface human support, do so gently and stop asking
  questions for this turn.
- Never moralize. Never soften difficult content the elder brought up themselves. Never
  push the elder into a sensitive topic.

You will be told the elder's name to use and the topic seed for THIS turn. Render the
spoken line — no JSON, no labels, just the words you want the elder to hear.`;

export interface PhraseInput {
  intent: PromptIntent;
  anchors: BiographicalAnchors | null;
  /** Recent prior stories — used only when the intent is a `callback` (the model gets the
   * specific summary to refer to). */
  priorStories: ReadonlyArray<PriorStoryMemory>;
}

export interface PhraseResult {
  /** The line the elder hears (also handed to the Voice seam for TTS). */
  spokenText: string;
  modelId: string;
}

export async function phraseIntent(
  llm: LanguageModel,
  input: PhraseInput,
): Promise<PhraseResult> {
  const messages = buildMessages(input);
  const res = await llm.complete({
    messages,
    responseFormat: "text",
    temperature: 0.4,
    maxOutputTokens: 250,
  });
  return { spokenText: res.text.trim(), modelId: res.modelId };
}

function buildMessages(input: PhraseInput): LanguageModelMessage[] {
  const ctxBlock = renderContextBlock(input.anchors);
  const userContent = `${ctxBlock}TURN:\n${renderIntentBlock(input.intent, input.priorStories)}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

function renderContextBlock(anchors: BiographicalAnchors | null): string {
  if (!anchors) return "";
  const lines: string[] = [];
  lines.push(`Elder's spoken name: ${anchors.spokenName}`);
  if (anchors.birthYear !== null) lines.push(`Approximate birth year: ${anchors.birthYear}`);
  for (const [k, v] of Object.entries(anchors.anchors ?? {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      lines.push(`${k}: ${v}`);
    }
  }
  return `CONTEXT (hints only — do not state any of these as fact unless the elder confirms):\n${lines.join("\n")}\n\n`;
}

function renderIntentBlock(
  intent: PromptIntent,
  priorStories: ReadonlyArray<PriorStoryMemory>,
): string {
  switch (intent.kind) {
    case "callback": {
      const prior =
        priorStories.find((s) => s.storyId === intent.priorStoryId) ?? null;
      const title = intent.priorTitle ?? prior?.title ?? "the story you started telling";
      const summary = intent.priorSummary ?? prior?.summary ?? "";
      return `Type: WARM CALLBACK (this is the FIRST turn of a returning session).
Refer briefly and concretely to a prior story, then offer ONE gentle next step (continue
that thread, or pick up where it left off).
Prior story title: ${title}
Prior story summary: ${summary || "(no summary available — refer only to the title)"}`;
    }
    case "ask":
      return `Type: FAMILY MEMBER QUESTION (relay).
Asker's name: ${intent.askerName}
The asker's actual question (paraphrase warmly; name the asker explicitly): ${intent.questionText}`;
    case "follow_up":
      return `Type: FOLLOW-UP on what the elder just said.
The elder's last words (reflect using THEIR phrasing where possible, then ask ONE follow-up):
"""${intent.threadSeed}"""`;
    case "base":
      return `Type: BASE QUESTION.
Category: ${intent.question.category}
Topic seed (re-render in your warm voice — do NOT read this verbatim):
"""${intent.question.text}"""`;
    case "wind_down":
      return `Type: GENTLE WIND-DOWN.
Reason: ${intent.reason}
${intent.surfaceHumanSupport
  ? "Surface (briefly, warmly) that this is not therapy and that the family — and human support — is here. Do NOT ask another question this turn."
  : "Acknowledge the elder's wish to pause or change subject. Offer to come back another time. Do NOT ask another question this turn."}`;
  }
}
