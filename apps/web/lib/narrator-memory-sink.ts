/**
 * The real narrator-memory sink (#362, ADR-0014 §8/§9). Lives in the composition root — the ONE
 * place that already imports both @chronicle/core and @chronicle/pipeline — so wiring extraction to
 * the store adds no new cross-package dependency (core does not depend on pipeline).
 *
 * `record` runs the LLM extraction seam over the consented text and, if it yields any facts, writes
 * them as `active`, `origin='extracted'` rows carrying the story provenance (story path) or none
 * (intake path). Extraction is defensive (a failed inference returns `[]`, never throws), so an empty
 * yield is a clean no-op. The call-sites additionally wrap `record` in their own try/catch so a
 * memory-feed failure can never fail the share/save — see shareAnswerAction / saveIntakeAnswer.
 */
import "server-only";
import { recordExtractedMemories, type NarratorMemorySink } from "@chronicle/core";
import { extractNarratorMemory, type LanguageModel } from "@chronicle/pipeline";
import type { Database } from "@chronicle/db";

export function createNarratorMemorySink(
  db: Database,
  languageModel: LanguageModel,
): NarratorMemorySink {
  return {
    async record({ personId, source, text, sourceStoryId }) {
      const facts = await extractNarratorMemory(text, languageModel);
      if (facts.length === 0) return;
      await recordExtractedMemories(db, {
        personId,
        source,
        ...(sourceStoryId ? { sourceStoryId } : {}),
        facts,
      });
    },
  };
}
