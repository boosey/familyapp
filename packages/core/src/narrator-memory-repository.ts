/**
 * Narrator-memory store (#362, ADR-0014 §8/§9) — the persistent "picture of the person": a
 * fact-store of title/summary/tags mined from the narrator's consented tellings plus user-authored
 * facts. The table lives on the OPEN schema (`narrator_memory`), so this is a NON-content read/write
 * path — the same posture as `life-events.ts` and `narrator-profile.ts`. It reaches the table only
 * via the open `@chronicle/db/schema` subpath (never the guarded content subpath), so it needs no
 * architecture-allowlist entry.
 *
 * Append-only CONTENT, mutable LIFECYCLE (see the DB guard `chronicle_narrator_memory_guard`): a
 * correction is a NEW `active` row while the prior row flips to `superseded` (`superseded_by` → the
 * replacement); a removal flips a row to `dismissed`. The interviewer only ever reads `active` rows.
 * Because extraction NEVER mutates existing rows, a user-authored fact can never be overwritten by
 * extraction — the precedence rule is satisfied structurally.
 *
 * `listNarratorMemoryForInterviewer` MOVED here (#362) from the allowlisted `story-repository.ts`:
 * it is now a strict repoint that reads ONLY the store's `active` rows (no story-metadata fallback,
 * no backfill). Its return shape is unchanged so the interviewer adapter is a drop-in.
 */
import { and, desc, eq } from "drizzle-orm";
import { narratorMemory } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { InvariantViolation } from "./errors";

/**
 * A single extracted fact the LLM seam produced. Declared locally (not imported from
 * @chronicle/pipeline) so core does not depend on pipeline — the composition-root sink maps
 * pipeline's structurally-identical `ExtractedMemory` onto this shape. Shared contract (LOCKED):
 * `{ title, summary, tags[], confidence }`.
 */
export interface ExtractedMemoryFact {
  title: string;
  summary: string;
  tags: string[];
  confidence: number;
}

export interface RecordExtractedMemoriesInput {
  personId: string;
  /** Which consent moment produced these facts (audit/provenance breadcrumb). */
  source: "story" | "intake";
  /** The approved story the facts were mined from (story path); omitted for intake (no source). */
  sourceStoryId?: string;
  facts: ExtractedMemoryFact[];
}

/**
 * Insert one `active`, `origin='extracted'` row per fact — carrying `sourceStoryId` (story path) or
 * null (intake path) and the fact's `confidence`. Empty `facts` → no-op (no write). NEVER mutates an
 * existing row, so a user-authored fact can never be clobbered by extraction. Semantic dedup against
 * prior rows is out of scope (a later refinement).
 */
export async function recordExtractedMemories(
  db: Database,
  input: RecordExtractedMemoriesInput,
): Promise<void> {
  if (input.facts.length === 0) return;
  await db.insert(narratorMemory).values(
    input.facts.map((f) => ({
      personId: input.personId,
      title: f.title,
      summary: f.summary,
      tags: f.tags,
      origin: "extracted" as const,
      sourceStoryId: input.sourceStoryId ?? null,
      confidence: f.confidence,
    })),
  );
}

export interface AuthorNarratorMemoryInput {
  personId: string;
  title: string;
  summary: string;
  tags: string[];
}

/**
 * Insert an `active`, `origin='user'` row — a fact authored directly (the #357 "add a memory" write
 * path). No source story, no confidence. Returns the new row's id.
 */
export async function authorNarratorMemory(
  db: Database,
  input: AuthorNarratorMemoryInput,
): Promise<string> {
  const [row] = await db
    .insert(narratorMemory)
    .values({
      personId: input.personId,
      title: input.title,
      summary: input.summary,
      tags: input.tags,
      origin: "user",
    })
    .returning({ id: narratorMemory.id });
  return row!.id;
}

export interface SupersedeNarratorMemoryInput {
  /** The currently-`active` row being corrected. */
  memoryId: string;
  replacement: {
    title: string;
    summary: string;
    tags: string[];
  };
}

/**
 * Correct a fact: in ONE transaction, insert a new `active`, `origin='user'` row and flip the prior
 * row to `status='superseded', superseded_by = new.id`. Guards that the prior row is currently
 * `active` (throws InvariantViolation otherwise — you cannot supersede a superseded/dismissed row).
 * A correction is thus always a NEW row, never an in-place edit. Returns the new row's id.
 */
export async function supersedeNarratorMemory(
  db: Database,
  input: SupersedeNarratorMemoryInput,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [prior] = await tx
      .select({ id: narratorMemory.id, personId: narratorMemory.personId, status: narratorMemory.status })
      .from(narratorMemory)
      .where(eq(narratorMemory.id, input.memoryId))
      .limit(1);
    if (!prior) {
      throw new InvariantViolation(`narrator_memory ${input.memoryId} not found`);
    }
    if (prior.status !== "active") {
      throw new InvariantViolation(
        `narrator_memory ${input.memoryId} is ${prior.status}, not active — cannot supersede`,
      );
    }
    const [replacement] = await tx
      .insert(narratorMemory)
      .values({
        personId: prior.personId,
        title: input.replacement.title,
        summary: input.replacement.summary,
        tags: input.replacement.tags,
        origin: "user",
      })
      .returning({ id: narratorMemory.id });
    await tx
      .update(narratorMemory)
      .set({ status: "superseded", supersededBy: replacement!.id })
      .where(eq(narratorMemory.id, input.memoryId));
    return replacement!.id;
  });
}

/**
 * Remove a fact: flip an `active` row to `status='dismissed'`. Guards that the row is currently
 * `active` (throws InvariantViolation otherwise). Never deletes — a dismissal is a lifecycle move,
 * and erasure (account/story) is the only thing that DELETEs rows.
 */
export async function dismissNarratorMemory(
  db: Database,
  input: { memoryId: string },
): Promise<void> {
  const [prior] = await db
    .select({ status: narratorMemory.status })
    .from(narratorMemory)
    .where(eq(narratorMemory.id, input.memoryId))
    .limit(1);
  if (!prior) {
    throw new InvariantViolation(`narrator_memory ${input.memoryId} not found`);
  }
  if (prior.status !== "active") {
    throw new InvariantViolation(
      `narrator_memory ${input.memoryId} is ${prior.status}, not active — cannot dismiss`,
    );
  }
  await db
    .update(narratorMemory)
    .set({ status: "dismissed" })
    .where(eq(narratorMemory.id, input.memoryId));
}

/**
 * Cross-session memory for the interviewer — the narrow read that returns ONLY safe metadata. The
 * projection at the SQL layer (not in the consumer) is the point: this function structurally cannot
 * leak transcript/prose/audio, because it never selects them and the table holds none.
 *
 * #362 repoint: reads ONLY the store's `status='active'` rows for the person, most-recent-first,
 * capped at `limit`. NO cold-start fallback to story metadata — the store starts empty and fills as
 * stories are approved. The return shape is kept identical to the pre-#362 story-metadata read so the
 * interviewer adapter is a drop-in: `storyId = source_story_id ?? id`, `promptQuestion = null`.
 */
export interface InterviewerStoryMemory {
  storyId: string;
  title: string | null;
  summary: string | null;
  tags: string[];
  promptQuestion: string | null;
  createdAt: Date;
}

export async function listNarratorMemoryForInterviewer(
  db: Database,
  narratorPersonId: string,
  limit: number,
): Promise<InterviewerStoryMemory[]> {
  const rows = await db
    .select({
      id: narratorMemory.id,
      sourceStoryId: narratorMemory.sourceStoryId,
      title: narratorMemory.title,
      summary: narratorMemory.summary,
      tags: narratorMemory.tags,
      createdAt: narratorMemory.createdAt,
    })
    .from(narratorMemory)
    .where(
      and(
        eq(narratorMemory.personId, narratorPersonId),
        eq(narratorMemory.status, "active"),
      ),
    )
    // `seq` is the monotonic total order (deterministic even under equal timestamps); newest first.
    .orderBy(desc(narratorMemory.seq))
    .limit(limit);
  return rows.map((r) => ({
    storyId: r.sourceStoryId ?? r.id,
    title: r.title,
    summary: r.summary,
    tags: r.tags ?? [],
    promptQuestion: null,
    createdAt: r.createdAt,
  }));
}
