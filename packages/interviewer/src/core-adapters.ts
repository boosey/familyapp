/**
 * Adapters that bridge `@chronicle/core`'s audited read API to the interviewer's seams.
 *
 * Cross-session memory is a content read: title/summary/tags from the narrator's prior stories.
 * It goes through `listNarratorMemoryForInterviewer` — an audited read on the already-allowlisted
 * `story-repository.ts`. The projection is in SQL (no transcript, no prose, no storage key
 * are ever selected), so the safe-metadata-only contract is structural rather than a
 * convention in this adapter file.
 *
 * Biographical anchors are non-content (the persons table is on the open schema), so a thin
 * pass-through to `getNarratorBiographicalContext` is the whole adapter.
 */
import {
  getNarratorBiographicalContext,
  listNarratorMemoryForInterviewer,
  listPendingAsksForNarrator,
  markAskRouted,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  MemorySource,
  PendingAsk,
  PriorStoryMemory,
} from "./contracts";

/**
 * Build a `MemorySource` backed by the audited core read `listNarratorMemoryForInterviewer`. The
 * core function projects in SQL — it cannot leak transcript/prose/audio keys because it never
 * selects them. The adapter here is a thin pass-through; the contract (safe metadata only)
 * lives at the audited boundary, not in the consumer.
 */
export function createCoreMemorySource(db: Database): MemorySource {
  return {
    async recentStoriesForNarrator(personId: string, limit: number): Promise<PriorStoryMemory[]> {
      const rows = await listNarratorMemoryForInterviewer(db, personId, limit);
      return rows.map((r) => ({
        storyId: r.storyId,
        title: r.title,
        summary: r.summary,
        tags: r.tags,
        promptQuestion: r.promptQuestion,
        createdAt: r.createdAt,
      }));
    },
  };
}

/**
 * Build an `AskSource` backed by the core Ask repository. `pendingForNarrator` calls
 * `listPendingAsksForNarrator` (returns queued/routed asks with the asker's spoken name);
 * `markRouted` calls the audited `markAskRouted` write (queued → routed). The interviewer never
 * touches the `asks` table directly — same "single boundary" pattern as the memory source.
 */
export function createCoreAskSource(db: Database): AskSource {
  return {
    async pendingForNarrator(personId: string): Promise<PendingAsk[]> {
      const rows = await listPendingAsksForNarrator(db, personId);
      return rows.map((r) => ({
        askId: r.ask.id,
        askerName: r.askerSpokenName,
        questionText: r.ask.questionText,
      }));
    },
    async markRouted(askId: string): Promise<void> {
      await markAskRouted(db, askId);
    },
  };
}

export function createCoreAnchorSource(db: Database): AnchorSource {
  return {
    async loadForNarrator(personId: string): Promise<BiographicalAnchors | null> {
      const ctx = await getNarratorBiographicalContext(db, personId);
      if (!ctx) return null;
      return {
        personId: ctx.personId,
        spokenName: ctx.spokenName,
        birthYear: ctx.birthYear,
        anchors: ctx.anchors,
      };
    },
  };
}
