/** DEFERRED (ADR-0014 §8/§9): the narrator-memory model ("picture of the person") is not built. This is the
 * consent-gated WRITE seam — the call-sites (post-approval Story, intake Save) invoke it so extraction lands
 * here when the model arrives. Retention (audio+transcript+prose) already preserves the raw material. */
export interface NarratorMemoryInput {
  personId: string;
  /** Which consent moment produced this text. */
  source: "story" | "intake";
  /** The consented text mined for memory (an APPROVED story's prose, or a saved intake answer). */
  text: string;
}
export interface NarratorMemorySink {
  record(input: NarratorMemoryInput): Promise<void>;
}
/** No-op sink — the deferred model's placeholder. Wired at the consent points now; does nothing yet. */
export const noopNarratorMemorySink: NarratorMemorySink = { async record() {} };
