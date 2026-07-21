/**
 * FINISH-TIME STORY DATE backstop (ADR-0026, issue #246), tiered-hybrid edition. Stories that
 * finish still Undated — the temporal follow-up was skipped or answered "I don't know", or the
 * story never went through an interview at all (an import) — get ONE silent second chance:
 *
 *   1. **Tier A (deterministic, no LLM):** the same `resolveStatedStoryDate` parse the live path
 *      uses, run over the final text. If the narrator STATED a calendar form anywhere in the
 *      assembled telling ("...that was 1958"), it is honoured immediately — no model call.
 *   2. **Tier B (LLM recognizer → pure calculator):** only if Tier A misses AND a `LanguageModel`
 *      is supplied. The model RECOGNIZES soft temporal language and emits a structured
 *      `TemporalProposal`; `parseTemporalProposal` validates it against closed allowlists and the
 *      pure `resolveTemporalRef` calculator does ALL the date math against the narrator's birthDate
 *      + life events. The model's own ISO guess (`hintedOccurrence`) is never trusted. We persist
 *      ONLY when the model is confident (high/medium) AND the calculator actually resolves.
 *
 * This pass NEVER asks the narrator anything and NEVER invents a date: anything the text does not
 * support (or a low-confidence / ambiguous model reply) leaves the story honestly Undated.
 *
 * Shaped like the metadata-derivation seam (derive-metadata.ts): a pure-ish (input) → output pass
 * with NO DB I/O — persistence is the caller's job through the core `applyResolvedStoryDate` write
 * seam, so live and backstop paths write the same four `occurred_*` fields. The only difference the
 * backstop makes is the user-visible provenance note: it gains the `BACKSTOP_PROVENANCE_SUFFIX`
 * marker so a reader can tell WHICH path derived the value (ADR-0026: "record which path derived
 * the value in the provenance note").
 */
import {
  parseTemporalProposal,
  resolveStatedStoryDate,
  resolveTemporalRef,
  type LifeEventAnchor,
  type StoryDateResolution,
  type TemporalProposal,
} from "@chronicle/core";
import type { LanguageModel, LanguageModelMessage } from "./contracts";
import {
  STORY_RENDER_LLM_TEMPERATURE,
  STORY_RENDER_MAX_OUTPUT_TOKENS,
} from "./constants";

export interface DeriveStoryDateInput {
  /** The final text the story finished with (the assembled transcript for a voice story, the
   *  sealed prose for a composed one). */
  fullText: string;
  /** The narrator's birth date (ISO YYYY-MM-DD) — the primary anchor. Malformed/absent = unknown. */
  birthDate?: string | null;
  /** The narrator's known life events — the reusable anchors for relative references. */
  lifeEvents?: LifeEventAnchor[];
  /**
   * OPTIONAL Tier B recognizer. When present, soft temporal language that Tier A cannot parse is
   * offered to the model for structured recognition. When absent, the backstop is Tier A only
   * (deterministic) — used where no model is available, and by the pure calculator tests.
   */
  languageModel?: LanguageModel;
}

/** The resolver's verdict: a resolved occurrence (with the backstop-marked note) or unresolvable. */
export type DeriveStoryDateOutput = StoryDateResolution;

/**
 * Marks a provenance note as backstop-derived ("age 8 at Christmas, from birthdate (finish-time
 * backstop)"). Exported so the wiring layers and tests assert the marker rather than
 * re-spelling it.
 */
export const BACKSTOP_PROVENANCE_SUFFIX = "(finish-time backstop)";

/**
 * The Tier B recognizer's system prompt. It asks the model ONLY to recognize temporal language and
 * emit a structured reference from a CLOSED catalog — never to compute or assert a date. The
 * calculator owns all arithmetic; a value outside the catalog is dropped by `parseTemporalProposal`.
 */
export const TEMPORAL_REF_SYSTEM_PROMPT = `You are a careful oral-history date analyst. You are given the FINAL text of a family member's story. Your ONLY job is to recognize how the text refers to WHEN it happened and describe that reference in a fixed structured form. You do NOT compute or state any calendar date yourself — a downstream calculator does the arithmetic from the narrator's birthdate and known life events.

Return STRICT JSON:
{
  "dateStatus": "resolved" | "ambiguous" | "unresolvable",
  "confidence": "high" | "medium" | "low",
  "ref": { "type": <one of the types below>, ...slots }   // omit ref unless dateStatus is "resolved"
}

Use "resolved" only when the text points at ONE time using one of these ref types (use EXACTLY these strings):
- "stated_full_date"  slots: year, month (1-12), day
- "stated_month_year" slots: year, month (1-12)
- "stated_year"       slots: year
- "stated_decade"     slots: decadeStartYear (e.g. 1950)
- "holiday_in_year"   slots: holiday, year
- "holiday_at_age"    slots: holiday, age
- "month_at_age"      slots: month (1-12), age
- "age"               slots: age
- "grade"             slots: grade (1-12)
- "life_stage"        slots: lifeStage
- "years_from_anchor" slots: anchorKind, offsetYears (negative = before)
- "named_era"         slots: era
- "season_in_year"    slots: season, year
- "season_at_age"     slots: season, age

Closed vocabularies (any other value = do not use):
- holiday: christmas_eve, christmas, new_years_eve, new_years_day, halloween, valentines_day, fourth_of_july, thanksgiving
- lifeStage: elementary_school, middle_school, high_school, college
- era: wwi, wwii, korea, vietnam        (ONLY when the text names the war/era itself)
- season: spring, summer, fall, winter
- anchorKind: wedding, graduation, military_service, move, other

Rules:
- Add "hedge": true when the text hedges ("about", "around", "I think", "or so").
- If the text gives no usable time reference, or is ambiguous between two, set dateStatus "unresolvable" or "ambiguous" and OMIT ref.
- NEVER guess an era or holiday that is not explicitly in the text. A bare place name is NOT an era.
- Return ONLY the JSON object.`;

function buildMessages(fullText: string): LanguageModelMessage[] {
  return [
    { role: "system", content: TEMPORAL_REF_SYSTEM_PROMPT },
    { role: "user", content: `Story text:\n"""\n${fullText}\n"""` },
  ];
}

/**
 * Ask the model to recognize the telling's temporal reference and return a validated proposal.
 * Any transport/parse failure degrades to `unresolvable` (the backstop then leaves the story
 * Undated) — the recognizer never throws into the finish path.
 */
export async function proposeTemporalRef(
  llm: LanguageModel,
  fullText: string,
): Promise<TemporalProposal> {
  try {
    const res = await llm.complete({
      messages: buildMessages(fullText),
      responseFormat: "json",
      temperature: STORY_RENDER_LLM_TEMPERATURE,
      maxOutputTokens: STORY_RENDER_MAX_OUTPUT_TOKENS,
    });
    return parseTemporalProposal(res.text);
  } catch {
    return { dateStatus: "unresolvable", confidence: "low" };
  }
}

function withBackstopMarker(resolution: StoryDateResolution): DeriveStoryDateOutput {
  if (resolution.status !== "resolved") return resolution;
  return {
    status: "resolved",
    occurrence: {
      ...resolution.occurrence,
      provenance: `${resolution.occurrence.provenance} ${BACKSTOP_PROVENANCE_SUFFIX}`,
    },
  };
}

/**
 * Run the finish-time backstop. Tier A is deterministic; Tier B runs only when a `languageModel`
 * is supplied and Tier A missed. Never throws; a resolved occurrence comes back with the backstop
 * marker on its provenance note, everything else comes back `unresolvable` (the story stays
 * Undated).
 */
export async function deriveStoryDate(input: DeriveStoryDateInput): Promise<DeriveStoryDateOutput> {
  const birthDate = input.birthDate ?? null;
  const lifeEvents = input.lifeEvents ?? [];

  // Tier A — the narrator's own stated calendar, no model call.
  const stated = resolveStatedStoryDate({ text: input.fullText, birthDate, lifeEvents });
  if (stated.status === "resolved") return withBackstopMarker(stated);

  // Tier B — only with a recognizer available.
  if (!input.languageModel) return { status: "unresolvable" };

  const proposal = await proposeTemporalRef(input.languageModel, input.fullText);
  // Persist ONLY on a confident, resolved recognition WITH a ref the calculator can compute.
  if (proposal.dateStatus !== "resolved" || proposal.confidence === "low" || !proposal.ref) {
    return { status: "unresolvable" };
  }
  const calculated = resolveTemporalRef({ ref: proposal.ref, birthDate, lifeEvents });
  return withBackstopMarker(calculated);
}
