/**
 * Post-approval biographical extraction. Runs after a story is approved and has a transcript.
 *
 * `extractBiographicalProfile` returns a `Partial<BiographicalProfile>` — only the fields the LLM
 * could confidently extract. `augmentProfileFromStory` is the write orchestration: it writes only
 * non-null results, and only to fields currently null in the store — it NEVER overwrites a value
 * the narrator already gave directly during the intake pass. Story-inferred facts are strictly
 * weaker than direct answers (spec: "Story extraction never overwrites a non-null value.").
 *
 * Parsing is defensive in the same spirit as render-story: the LLM is asked for raw JSON, but an
 * unparseable response yields `{}` (no writes) rather than throwing — a failed inference must
 * never corrupt the profile or block the approval flow.
 */
import type { LanguageModel } from "./contracts";
import type { BiographicalProfile } from "@chronicle/db";
import {
  BIOGRAPHY_EXTRACT_LLM_TEMPERATURE,
  BIOGRAPHY_EXTRACT_MAX_OUTPUT_TOKENS,
} from "./constants";

const SYSTEM_PROMPT = `You extract structured biographical facts from a transcript of someone talking about their life.
Return ONLY raw JSON with exactly these keys: hometown, siblingContext, currentLocation, occupationSummary, hasChildren, hasGrandchildren.
Set any key to null if the fact is absent or uncertain. hometown/siblingContext/currentLocation/occupationSummary are strings or null. hasChildren/hasGrandchildren are booleans or null. No markdown, no prose.`;

const KEYS: Array<keyof BiographicalProfile> = [
  "hometown",
  "siblingContext",
  "currentLocation",
  "occupationSummary",
  "hasChildren",
  "hasGrandchildren",
];

export async function extractBiographicalProfile(
  transcript: string,
  llm: LanguageModel,
): Promise<Partial<BiographicalProfile>> {
  const res = await llm.complete({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `TRANSCRIPT:\n${transcript}` },
    ],
    responseFormat: "text",
    temperature: BIOGRAPHY_EXTRACT_LLM_TEMPERATURE,
    maxOutputTokens: BIOGRAPHY_EXTRACT_MAX_OUTPUT_TOKENS,
  });
  try {
    const parsed = JSON.parse(res.text.trim()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const safe: Partial<BiographicalProfile> = {};
    for (const k of KEYS) {
      if (k in parsed) (safe as Record<string, unknown>)[k] = parsed[k];
    }
    return safe;
  } catch {
    return {};
  }
}

/**
 * Minimal write seam (structurally a subset of interviewer's `AnchorSource`, so the app layer can
 * pass `createCoreAnchorSource(db)` directly — but we declare it locally to avoid a
 * pipeline -> interviewer dependency cycle: interviewer already depends on pipeline).
 */
export interface BiographicalProfileStore {
  loadForNarrator(personId: string): Promise<{ profile: BiographicalProfile } | null>;
  writeProfileField<K extends keyof BiographicalProfile>(
    personId: string,
    key: K,
    value: NonNullable<BiographicalProfile[K]>,
  ): Promise<void>;
}

export async function augmentProfileFromStory(
  transcript: string,
  ownerPersonId: string,
  llm: LanguageModel,
  store: BiographicalProfileStore,
): Promise<void> {
  if (!transcript) return;
  const extracted = await extractBiographicalProfile(transcript, llm);
  const existing = await store.loadForNarrator(ownerPersonId);
  for (const [k, v] of Object.entries(extracted) as Array<[keyof BiographicalProfile, unknown]>) {
    if (v === null || v === undefined) continue;
    if (existing && existing.profile[k] !== null) continue; // never overwrite a known field
    await store.writeProfileField(ownerPersonId, k, v as never);
  }
}
