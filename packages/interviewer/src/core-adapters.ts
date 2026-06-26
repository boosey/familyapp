/**
 * Adapters that bridge `@chronicle/core`'s audited read API to the interviewer's seams.
 *
 * Cross-session memory is a content read: title/summary/tags from the elder's prior stories.
 * It goes through `listElderMemoryForInterviewer` — an audited read on the already-allowlisted
 * `story-repository.ts`. The projection is in SQL (no transcript, no prose, no storage key
 * are ever selected), so the safe-metadata-only contract is structural rather than a
 * convention in this adapter file.
 *
 * Biographical anchors are non-content (the persons table is on the open schema), so a thin
 * pass-through to `getElderBiographicalContext` is the whole adapter.
 */
import {
  getElderBiographicalContext,
  listElderMemoryForInterviewer,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";
import type {
  AnchorSource,
  BiographicalAnchors,
  MemorySource,
  PriorStoryMemory,
} from "./contracts";

/**
 * Build a `MemorySource` backed by the audited core read `listElderMemoryForInterviewer`. The
 * core function projects in SQL — it cannot leak transcript/prose/audio keys because it never
 * selects them. The adapter here is a thin pass-through; the contract (safe metadata only)
 * lives at the audited boundary, not in the consumer.
 */
export function createCoreMemorySource(db: Database): MemorySource {
  return {
    async recentStoriesForElder(personId: string, limit: number): Promise<PriorStoryMemory[]> {
      const rows = await listElderMemoryForInterviewer(db, personId, limit);
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

export function createCoreAnchorSource(db: Database): AnchorSource {
  return {
    async loadForElder(personId: string): Promise<BiographicalAnchors | null> {
      const ctx = await getElderBiographicalContext(db, personId);
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
