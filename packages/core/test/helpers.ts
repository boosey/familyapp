import { media, stories, storyRecordings } from "@chronicle/db/content";
import {
  consentRecords,
  families,
  memberships,
  persons,
  storyFamilies,
} from "@chronicle/db/schema";
import type {
  AudienceTier,
  Database,
  MembershipStatus,
  StoryState,
} from "@chronicle/db";
import { eq } from "drizzle-orm";

export async function makePerson(db: Database, displayName: string) {
  const [p] = await db
    .insert(persons)
    .values({ displayName, spokenName: displayName })
    .returning();
  return p!;
}

export async function makeFamily(db: Database, name: string, creatorId: string) {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!;
}

export async function addMembership(
  db: Database,
  personId: string,
  familyId: string,
  status: MembershipStatus = "active",
) {
  const [m] = await db
    .insert(memberships)
    .values({ personId, familyId, status })
    .returning();
  return m!;
}

export async function makeRecording(db: Database, ownerPersonId: string) {
  const [m] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://bucket/${ownerPersonId}-${Math.random()}.wav`,
      contentType: "audio/wav",
      durationSeconds: 90,
      checksum: "chk",
    })
    .returning();
  return m!;
}

export async function makeApprovalAudio(db: Database, ownerPersonId: string) {
  const [m] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "approval_audio",
      storageKey: `s3://bucket/approval-${Math.random()}.wav`,
      contentType: "audio/wav",
      durationSeconds: 3,
      checksum: "chk",
    })
    .returning();
  return m!;
}

/**
 * Create a story in a chosen state/tier. If `withApprovalConsent`, also append an approval consent
 * row. If `targetFamilyIds` is given, surface the story into those families (story_families rows) —
 * required for a `family`/`branch`-tier story to be visible to any non-owner (ADR-0010).
 */
export async function makeStory(
  db: Database,
  opts: {
    ownerPersonId: string;
    state?: StoryState;
    audienceTier?: AudienceTier;
    withApprovalConsent?: boolean;
    targetFamilyIds?: string[];
    /** The originating family context (ADR-0010) — what a link-session capture stamps on the draft. */
    originatingFamilyId?: string;
    askId?: string;
    /** Derived receipt-experience content (subordinate to the audio). Optional; null when omitted. */
    transcript?: string;
    prose?: string;
    summary?: string;
    title?: string;
  },
) {
  const recording = await makeRecording(db, opts.ownerPersonId);
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({
        ownerPersonId: opts.ownerPersonId,
        recordingMediaId: recording.id,
        state: opts.state ?? "draft",
        audienceTier: opts.audienceTier ?? "private",
        originatingFamilyId: opts.originatingFamilyId ?? null,
        askId: opts.askId ?? null,
        transcript: opts.transcript ?? null,
        prose: opts.prose ?? null,
        summary: opts.summary ?? null,
        title: opts.title ?? null,
      })
      .returning();
    // Seed take-0 so the story satisfies the ADR-0014 kind⇔recording biconditional (Task 3).
    await tx.insert(storyRecordings).values({
      storyId: s!.id,
      position: 0,
      mediaId: recording.id,
    });
    return s!;
  });
  if (opts.withApprovalConsent) {
    await db.insert(consentRecords).values({
      personId: opts.ownerPersonId,
      actorPersonId: opts.ownerPersonId,
      storyId: story.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
  }
  if (opts.targetFamilyIds && opts.targetFamilyIds.length > 0) {
    for (const familyId of opts.targetFamilyIds) {
      await targetStoryToFamily(db, story.id, familyId);
    }
  }
  return { story, recording };
}

/** Surface a story into a family (insert a story_families targeting row). */
export async function targetStoryToFamily(
  db: Database,
  storyId: string,
  familyId: string,
) {
  const [row] = await db
    .insert(storyFamilies)
    .values({ storyId, familyId })
    .returning();
  return row!;
}

export async function revokeConsent(
  db: Database,
  storyId: string,
  personId: string,
) {
  await db.insert(consentRecords).values({
    personId,
    actorPersonId: personId,
    storyId,
    action: "revoked",
    resultingState: "private",
  });
}

export async function endMembership(db: Database, membershipId: string) {
  await db
    .update(memberships)
    .set({ status: "ended" })
    .where(eq(memberships.id, membershipId));
}
