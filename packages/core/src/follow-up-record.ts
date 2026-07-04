/**
 * Append-only follow-up decision ledger (ADR-0013). Operational tier — stores only derived seeds
 * and tags, never transcript, so it lives outside the story front door (open @chronicle/db/schema).
 * Two row kinds: `decision` (written at decision time) and `outcome` (written by the NEXT action,
 * referencing the decision it resolves). Never updated or deleted (DB trigger enforces).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { followUpDecisions } from "@chronicle/db/schema";
import type {
  Database,
  FollowUpCandidate,
  CandidateDisposition,
  FollowUpOutcome,
  FollowUpPolicy,
  FollowUpDecisionRow,
} from "@chronicle/db";

export async function appendFollowUpDecision(
  db: Database,
  input: {
    storyId: string;
    threadPosition: number;
    evaluatorModelId: string;
    candidates: FollowUpCandidate[];
    dispositions: CandidateDisposition[];
    selectedSeed: string | null;
    phrasedLine: string | null;
    policy: FollowUpPolicy;
  },
): Promise<{ decisionId: string }> {
  const [row] = await db
    .insert(followUpDecisions)
    .values({
      storyId: input.storyId,
      threadPosition: input.threadPosition,
      recordKind: "decision",
      evaluatorModelId: input.evaluatorModelId,
      candidates: input.candidates,
      dispositions: input.dispositions,
      selectedSeed: input.selectedSeed,
      phrasedLine: input.phrasedLine,
      policy: input.policy,
    })
    .returning({ id: followUpDecisions.id });
  return { decisionId: row!.id };
}

export async function appendFollowUpOutcome(
  db: Database,
  input: { storyId: string; decisionId: string; threadPosition: number; outcome: FollowUpOutcome },
): Promise<void> {
  await db.insert(followUpDecisions).values({
    storyId: input.storyId,
    threadPosition: input.threadPosition,
    recordKind: "outcome",
    decisionId: input.decisionId,
    outcome: input.outcome,
  });
}

/**
 * The latest ASKED `decision` row for a story that has NO `outcome` row referencing it — i.e. the
 * follow-up the narrator is currently responding to. The next action attaches its outcome here.
 * Returns null when every asked decision already has an outcome (or none exist).
 *
 * ONLY selected (`selectedSeed IS NOT NULL`) decisions are eligible: a null-seed "none" decision
 * (written by runFollowUpStep when it proposes nothing) is NOT an asked follow-up. Under the append
 * model (ADR-0014 Inc 3) the story stays `draft` after a none-decision, so that row would otherwise
 * linger forever as "unresolved" and a later answered/skipped outcome would be attached to a
 * follow-up that was never asked — polluting the append-only ledger.
 */
export async function latestUnresolvedDecision(
  db: Database,
  storyId: string,
): Promise<FollowUpDecisionRow | null> {
  const [row] = await db
    .select()
    .from(followUpDecisions)
    .where(
      and(
        eq(followUpDecisions.storyId, storyId),
        eq(followUpDecisions.recordKind, "decision"),
        sql`${followUpDecisions.selectedSeed} is not null`,
        sql`not exists (
          select 1 from ${followUpDecisions} o
          where o.record_kind = 'outcome' and o.decision_id = ${followUpDecisions.id}
        )`,
      ),
    )
    .orderBy(desc(followUpDecisions.seq))
    .limit(1);
  return row ?? null;
}

/** Full audit read for a story, in ledger order. */
export async function listFollowUpDecisionsForStory(
  db: Database,
  storyId: string,
): Promise<FollowUpDecisionRow[]> {
  return db
    .select()
    .from(followUpDecisions)
    .where(eq(followUpDecisions.storyId, storyId))
    .orderBy(followUpDecisions.seq);
}
