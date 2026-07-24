/** The consent-gated narrator-memory WRITE seam (ADR-0014 §8/§9). The two call-sites (post-approval
 * Story, intake Save) invoke `record` with the consented text; the real sink (#362,
 * apps/web/lib/narrator-memory-sink.ts) runs LLM extraction and writes `narrator_memory` rows.
 * Retention (audio+transcript+prose) already preserves the raw material independently. */
export interface NarratorMemoryInput {
  personId: string;
  /** Which consent moment produced this text. */
  source: "story" | "intake";
  /** The consented text mined for memory (an APPROVED story's prose, or a saved intake answer). */
  text: string;
  /** #362: the approved story the text came from (story path) — recorded as provenance on extracted
   * rows. Omitted for the intake path (a saved intake answer has no source story). */
  sourceStoryId?: string;
}
export interface NarratorMemorySink {
  record(input: NarratorMemoryInput): Promise<void>;
}
/** No-op sink — used by tests that don't exercise the memory write. Does nothing. */
export const noopNarratorMemorySink: NarratorMemorySink = { async record() {} };
