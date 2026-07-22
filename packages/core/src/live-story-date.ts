/**
 * Live Story date update policy (ADR-0026 / issue #321).
 *
 * Owns the shared live-path rules used by the interviewer turn-loop and the hub answer
 * surface: Tier A stated-calendar resolve, monotonic precision ranking, and stated
 * life-event extraction. Pure — no DB, no LLM, no I/O. Callers persist through thin
 * StoryDateSink / LifeEventSink (or core write seams).
 *
 * Finish-time backstop stays in `@chronicle/pipeline` `derive-story-date.ts` (Tier B).
 * This module never runs Tier B and never invents a date from soft language.
 */
import type { OccurredKind } from "@chronicle/db";
import {
  extractStatedLifeEvents,
  resolveStatedStoryDate,
  type LifeEventAnchor,
  type StoryDateOccurrence,
  type StatedLifeEvent,
} from "./resolve-story-date";

/**
 * Precision rank of a Story date form (ADR-0026: date > period > circa). Live derivation
 * persists monotonically: a later take may REFINE the date (period → date) but never
 * downgrade it — the resolver never invents precision, so a less precise later resolution
 * adds nothing and is not persisted.
 */
export const OCCURRENCE_PRECISION_RANK: Record<OccurredKind, number> = {
  circa: 1,
  period: 2,
  date: 3,
};

/** Map an existing occurrence kind (or null/undefined = Undated) to a precision rank. */
export function occurrencePrecisionRank(kind: OccurredKind | null | undefined): number {
  return kind ? OCCURRENCE_PRECISION_RANK[kind] : 0;
}

export interface DeriveLiveStoryDateUpdateInput {
  /** Assembled telling text for Tier A story-date resolve. */
  storyText: string;
  /**
   * Text for stated life-event capture. Defaults to `storyText`. The turn-loop passes the
   * latest utterance so capture stays per-take; the answer surface passes the same assembled text.
   */
  lifeEventText?: string;
  /** The narrator's birth date (ISO YYYY-MM-DD). Malformed/absent = unknown. */
  birthDate?: string | null;
  /** Known life events — anchors for relative references (Tier A ignores soft language anyway). */
  lifeEvents?: readonly LifeEventAnchor[];
  /** Current persisted precision (0 = Undated). */
  existingRank: number;
}

export interface DeriveLiveStoryDateUpdateResult {
  /** Occurrence to persist when more precise than existing; otherwise null. */
  toPersist: StoryDateOccurrence | null;
  /** Rank after this pass (existing, or upgraded). */
  resultingRank: number;
  /** True when no date is known after this pass. */
  dateUnresolved: boolean;
  /** Stated life events extracted from `lifeEventText` (caller records via sink). */
  statedLifeEvents: StatedLifeEvent[];
}

/**
 * Derive the live Story date update for one capture turn / answer pass.
 *
 * Policy (ADR-0026 live path):
 *   - Tier A only — stated calendar auto-dates; soft language leaves the story Undated.
 *   - Persist only on a precision upgrade (`toPersist` is null otherwise).
 *   - Always surface stated life events for the caller to record independently.
 */
export function deriveLiveStoryDateUpdate(
  input: DeriveLiveStoryDateUpdateInput,
): DeriveLiveStoryDateUpdateResult {
  const statedLifeEvents = extractStatedLifeEvents({
    text: input.lifeEventText ?? input.storyText,
    birthDate: input.birthDate ?? null,
  });

  const resolution = resolveStatedStoryDate({
    text: input.storyText,
    birthDate: input.birthDate ?? null,
    lifeEvents: input.lifeEvents ? [...input.lifeEvents] : [],
  });

  if (resolution.status !== "resolved") {
    return {
      toPersist: null,
      resultingRank: input.existingRank,
      dateUnresolved: input.existingRank === 0,
      statedLifeEvents,
    };
  }

  const nextRank = OCCURRENCE_PRECISION_RANK[resolution.occurrence.kind];
  const upgrade = nextRank > input.existingRank;
  return {
    toPersist: upgrade ? resolution.occurrence : null,
    resultingRank: upgrade ? nextRank : input.existingRank,
    dateUnresolved: false,
    statedLifeEvents,
  };
}
