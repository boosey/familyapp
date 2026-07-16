/**
 * Phraser — turns a chosen `PromptIntent` into the warm spoken sentence the narrator hears.
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
import {
  INTERVIEWER_PHRASE_LLM_TEMPERATURE,
  INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS,
} from "./constants";

const SYSTEM_PROMPT = `You are the warm voice of the family chronicler. You are speaking to a
family member who is sharing their life stories. You are not a chatbot and not a therapist.

ABSOLUTE RULES — non-negotiable:
- Speak ONE thing at a time. Never combine two questions in one turn.
- Be open-ended, concrete, and non-leading. Use forms like "Tell me about…", "What was it
  like when…". NEVER use yes/no framing. NEVER use "Don't you think…".
- Be conversational and warm, but brief. 1-3 sentences MAX. No preamble, no apologies, no
  "I'd love to hear…" filler. Get to the question.
- Never invent facts about the narrator or their family. Use any provided biographical anchors
  ONLY to set names or tone — never to state something as known fact.
- When a family member's question is being relayed, name the asker warmly ("Sofia was
  wondering…") and frame the question kindly.
- When you are doing a warm callback to a prior story, refer to it briefly and concretely
  using ONLY the words in the provided prior-story summary. Do not embellish.
- If asked to wind down, redirect, or surface human support, do so gently and stop asking
  questions for this turn.
- Never moralize. Never soften difficult content the narrator brought up themselves. Never
  push the narrator into a sensitive topic.

You will be told the narrator's name to use and the topic seed for THIS turn. Render the
spoken line — no JSON, no labels, just the words you want the narrator to hear.`;

export interface PhraseInput {
  intent: PromptIntent;
  anchors: BiographicalAnchors | null;
  /** Recent prior stories — used only when the intent is a `callback` (the model gets the
   * specific summary to refer to). */
  priorStories: ReadonlyArray<PriorStoryMemory>;
  /** True on the narrator's very first session — gates the one-time welcome opener. */
  isFirstSession: boolean;
}

export interface PhraseResult {
  /** The line the narrator hears (also handed to the Voice seam for TTS). */
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
    temperature: INTERVIEWER_PHRASE_LLM_TEMPERATURE,
    maxOutputTokens: INTERVIEWER_PHRASE_MAX_OUTPUT_TOKENS,
  });
  return { spokenText: res.text.trim(), modelId: res.modelId };
}

function buildMessages(input: PhraseInput): LanguageModelMessage[] {
  const ctxBlock = renderContextBlock(input.anchors);
  const welcomeBlock =
    input.isFirstSession && input.intent.kind === "intake"
      ? `FIRST SESSION: Before the question, add a warm 1–2 sentence welcome that conveys: you'll ask about their life one question at a time; their own words and voice are what's preserved; there are no wrong answers and they can skip anything or stop whenever they like. Then flow straight into the question — no "here we go" filler.\n\n`
      : "";
  const userContent = `${ctxBlock}${welcomeBlock}TURN:\n${renderIntentBlock(input.intent, input.priorStories)}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

function renderContextBlock(anchors: BiographicalAnchors | null): string {
  if (!anchors) return "";
  const lines: string[] = [`Narrator's spoken name: ${anchors.spokenName}`];
  if (anchors.birthYear !== null) lines.push(`Approximate birth year: ${anchors.birthYear}`);
  const p = anchors.profile;
  if (p.hometown) lines.push(`Hometown: ${p.hometown}`);
  if (p.currentLocation) lines.push(`Current location: ${p.currentLocation}`);
  if (p.occupationSummary) lines.push(`Occupation: ${p.occupationSummary}`);
  if (p.siblingContext) lines.push(`Sibling context: ${p.siblingContext}`);
  if (p.hasChildren != null) lines.push(`Has children: ${p.hasChildren ? "yes" : "no"}`);
  if (p.hasGrandchildren != null) lines.push(`Has grandchildren: ${p.hasGrandchildren ? "yes" : "no"}`);
  return `CONTEXT (hints only — do not state any of these as fact unless the narrator confirms):\n${lines.join("\n")}\n\n`;
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
    case "intake":
      return `Type: INTAKE QUESTION — you are warmly building a biographical portrait of this narrator.
Field being collected: ${intent.questionKey}
Ask this in your warm voice (re-render naturally — do NOT read verbatim, keep it open-ended, 1–2 sentences):
"""${intent.questionText}"""
Curious and warm, never clinical or form-like. Never yes/no.`;
    case "follow_up":
      if (intent.origin === "gap") {
        // Gap-driven follow-up (issue #80): the seed names a SPECIFIC missing fact the narrator
        // did not supply. Still ONE warm question, still non-leading — we ask about the gap, we do
        // NOT assert the missing fact exists. The gapKind hints the angle (when/who/where/why/what).
        return `Type: FOLLOW-UP that gently fills in a detail the narrator did not mention.
The missing detail to ask about (a ${intent.gapKind ?? "factual"} gap — do NOT assume the answer,
just invite it): """${intent.threadSeed}"""
Ask ONE short, open-ended question that draws out this detail. Reflect their own words where you can.`;
      }
      return `Type: FOLLOW-UP on what the narrator just said.
The narrator's last words (reflect using THEIR phrasing where possible, then ask ONE follow-up):
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
  : "Acknowledge the narrator's wish to pause or change subject. Offer to come back another time. Do NOT ask another question this turn."}`;
  }
}
