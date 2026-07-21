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
import { sql } from "drizzle-orm";
import {
  applyResolvedStoryDate,
  getNarratorBiographicalContext,
  listLifeEventsForPerson,
  listNarratorMemoryForInterviewer,
  listPendingAsksForNarrator,
  markAskRouted,
  recordStatedLifeEvent,
} from "@chronicle/core";
import type { BiographicalProfile, Database } from "@chronicle/db";
import type {
  AnchorSource,
  AskSource,
  BiographicalAnchors,
  LifeEventSink,
  MemorySource,
  PendingAsk,
  PersistResolvedStoryDateInput,
  PriorStoryMemory,
  RecordStatedLifeEventInput,
  StoryDateSink,
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
        sourceStoryId: r.ask.sourceStoryId,
      }));
    },
    async markRouted(askId: string): Promise<void> {
      await markAskRouted(db, askId);
    },
  };
}

/**
 * Build an `AnchorSource` over the narrator's `persons.biographical_anchors` JSONB. `loadForNarrator`
 * maps the stored bag into the typed `profile` (each unset field → null); `writeProfileField` sets a
 * SINGLE key via a JSONB merge that never touches the others. The `persons` row is on the OPEN schema
 * (identity, not expressive content), so these are non-content reads/writes — no story/media
 * front-door bypass and no architecture-allowlist entry is needed.
 */
export function createCoreAnchorSource(db: Database): AnchorSource {
  return {
    async loadForNarrator(personId: string): Promise<BiographicalAnchors | null> {
      const ctx = await getNarratorBiographicalContext(db, personId);
      if (!ctx) return null;
      const stored = (ctx.anchors ?? {}) as Partial<BiographicalProfile>;
      // The date-derivation anchors (ADR-0026) load with the rest of the inflow, once per
      // session: the full birth date (primary anchor) plus the narrator's known life events.
      const lifeEvents = await listLifeEventsForPerson(db, personId);
      return {
        personId: ctx.personId,
        spokenName: ctx.spokenName,
        birthYear: ctx.birthYear,
        birthDate: ctx.birthDate,
        lifeEvents,
        profile: {
          hometown: stored.hometown ?? null,
          siblingContext: stored.siblingContext ?? null,
          currentLocation: stored.currentLocation ?? null,
          occupationSummary: stored.occupationSummary ?? null,
          hasChildren: stored.hasChildren ?? null,
          hasGrandchildren: stored.hasGrandchildren ?? null,
        },
      };
    },
    async writeProfileField<K extends keyof BiographicalProfile>(
      personId: string,
      key: K,
      value: NonNullable<BiographicalProfile[K]>,
    ): Promise<void> {
      // JSONB merge — set ONE key, never touching the others. The bound parameter carries the
      // single-key patch as text and casts to jsonb, so `key`/`value` are never interpolated into
      // the SQL string.
      await db.execute(sql`
        UPDATE persons
        SET biographical_anchors = COALESCE(biographical_anchors, '{}'::jsonb) || ${JSON.stringify({ [key]: value })}::jsonb,
            updated_at = now()
        WHERE id = ${personId}`);
    },
  };
}

/**
 * Build a `StoryDateSink` over the audited story repository. Live derivation writes through the
 * SAME `updateDerivedFields` seam every other derivation path uses (backstop, migration) — the
 * interviewer never touches the `stories` table directly. `applyResolvedStoryDate` carries the
 * mapping (occurrence → the four `occurred_*` columns, provenance included) at the core
 * boundary, so this adapter is a pass-through like the memory/ask sources above.
 */
export function createCoreStoryDateSink(db: Database): StoryDateSink {
  return {
    async persistResolvedStoryDate(input: PersistResolvedStoryDateInput): Promise<void> {
      await applyResolvedStoryDate(db, input.storyId, input.occurrence);
    },
  };
}

/**
 * Build a `LifeEventSink` over the core life-events write side (issue #245). The idempotency
 * (person + kind + date) and the narrator-only attachment live in `recordStatedLifeEvent` at
 * the core boundary, so this adapter is a pass-through like the story-date sink above. The
 * `life_events` table is on the OPEN schema (person-adjacent biographical data, not expressive
 * content), so this is a non-content write — no architecture-allowlist entry is needed.
 */
export function createCoreLifeEventSink(db: Database): LifeEventSink {
  return {
    async recordStatedLifeEvent(input: RecordStatedLifeEventInput): Promise<void> {
      await recordStatedLifeEvent(db, input.personId, input.event);
    },
  };
}
