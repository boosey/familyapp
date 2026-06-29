/**
 * Structured intake questions — asked once per narrator to populate BiographicalProfile.
 * EPHEMERAL: intake answers are NOT stories. They populate the profile and are discarded.
 *
 * DRAFTING RULES (same as bank.ts — load-bearing):
 *   - Open-ended ("Tell me about…"). NEVER yes/no. Booleans are INFERRED by extraction.
 *   - One question per item; no compound asks.
 *   - Concrete, warm, non-judgmental.
 */
import type { BiographicalProfile } from "@chronicle/db";

export interface IntakeQuestion {
  key: keyof BiographicalProfile;
  /** Topic seed — re-rendered warm by the phraser; not read verbatim. Open-ended. */
  text: string;
  /** Extraction hint: tells the per-turn extractor what structured value to return. */
  extractionHint: string;
}

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  {
    key: "hometown",
    text: "Tell me about where you grew up — the town, the neighborhood, the place it was.",
    extractionHint:
      "Extract the town/city/region where the narrator grew up, as a short string (e.g. 'New Orleans, Louisiana' or 'a farm outside Shreveport'). Return null if not stated.",
  },
  {
    key: "siblingContext",
    text: "Tell me about your brothers and sisters, if you had any growing up.",
    extractionHint:
      "Summarize the sibling situation in 1–2 sentences (e.g. 'Oldest of four' or 'Only child'). Return null if not stated.",
  },
  {
    key: "currentLocation",
    text: "Where has life taken you since — where do you call home these days?",
    extractionHint:
      "Extract the narrator's current city/region; note relocation if mentioned (e.g. 'Houston — moved from New Orleans in 1985'). Return null if not stated.",
  },
  {
    key: "occupationSummary",
    text: "Tell me about the work you've done over the years.",
    extractionHint:
      "Summarize the primary occupation/career in 1–2 sentences (e.g. 'Schoolteacher for 30 years'). Return null if not stated.",
  },
  {
    key: "hasChildren",
    text: "Tell me about your children, if you have any.",
    extractionHint:
      "Infer a boolean: true if the narrator indicates they have children, false if they indicate they do not, null if unclear.",
  },
  {
    key: "hasGrandchildren",
    text: "And your grandchildren — tell me about them.",
    extractionHint:
      "Infer a boolean: true if the narrator indicates they have grandchildren, false if not, null if unclear. Only asked when hasChildren is true.",
  },
];

/**
 * Next intake question not yet asked this session and whose profile field is still null.
 * Returns null when all applicable questions are complete.
 */
export function nextIntakeQuestion(
  profile: Partial<BiographicalProfile>,
  askedKeys: ReadonlySet<keyof BiographicalProfile>,
): IntakeQuestion | null {
  for (const q of INTAKE_QUESTIONS) {
    if (askedKeys.has(q.key)) continue;
    const value = profile[q.key];
    if (value !== undefined && value !== null) continue;
    if (q.key === "hasGrandchildren" && profile.hasChildren !== true) continue;
    return q;
  }
  return null;
}
