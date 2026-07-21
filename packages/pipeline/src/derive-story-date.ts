/**
 * FINISH-TIME STORY DATE backstop (ADR-0026, issue #246). Stories that finish still Undated —
 * the temporal follow-up was skipped or answered "I don't know", or the story never went through
 * an interview at all (an import) — get ONE silent second chance: the same `resolveStoryDate`
 * resolver (#242) the interviewer's live pass uses, run over the final text against the
 * narrator's birthDate + known life events. It derives what the text supports or leaves the
 * story Undated; it NEVER asks the narrator anything.
 *
 * Shaped like the metadata-derivation seam (derive-metadata.ts): a pure (input) → output pass
 * with NO DB I/O — persistence is the caller's job and goes through the core
 * `applyResolvedStoryDate` write seam, so live and backstop paths write the same four
 * `occurred_*` fields. The only difference the backstop makes is in the user-visible provenance
 * note: the resolver's note gains the `BACKSTOP_PROVENANCE_SUFFIX` marker so a reader can tell
 * WHICH path derived the value (ADR-0026: "record which path derived the value in the
 * provenance note"). The resolver is deterministic and never throws, so — unlike
 * `deriveMetadata` — this pass spends no LLM call; the date either IS in the telling's own
 * words or the story stays honestly Undated.
 */
import {
  resolveStoryDate,
  type LifeEventAnchor,
  type StoryDateResolution,
} from "@chronicle/core";

export interface DeriveStoryDateInput {
  /** The final text the story finished with (the assembled transcript for a voice story, the
   *  sealed prose for a composed one). */
  fullText: string;
  /** The narrator's birth date (ISO YYYY-MM-DD) — the primary anchor. Malformed/absent = unknown. */
  birthDate?: string | null;
  /** The narrator's known life events — the reusable anchors for relative references. */
  lifeEvents?: LifeEventAnchor[];
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
 * Run the finish-time backstop derivation. Pure: no DB, no LLM, no clock, never throws. A
 * resolved occurrence comes back with its provenance note carrying the backstop marker; an
 * underivable text comes back `unresolvable` and the story stays Undated.
 */
export function deriveStoryDate(input: DeriveStoryDateInput): DeriveStoryDateOutput {
  const resolution = resolveStoryDate({
    text: input.fullText,
    birthDate: input.birthDate ?? null,
    lifeEvents: input.lifeEvents ?? [],
  });
  if (resolution.status !== "resolved") return resolution;
  return {
    status: "resolved",
    occurrence: {
      ...resolution.occurrence,
      provenance: `${resolution.occurrence.provenance} ${BACKSTOP_PROVENANCE_SUFFIX}`,
    },
  };
}
