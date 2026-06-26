import { media, stories } from "@chronicle/db/content";
import {
  consentRecords,
  families,
  memberships,
  persons,
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

/** Create a story in a chosen state/tier. If `shared`, also append an approval consent row. */
export async function makeStory(
  db: Database,
  opts: {
    ownerPersonId: string;
    state?: StoryState;
    audienceTier?: AudienceTier;
    withApprovalConsent?: boolean;
  },
) {
  const recording = await makeRecording(db, opts.ownerPersonId);
  const [story] = await db
    .insert(stories)
    .values({
      ownerPersonId: opts.ownerPersonId,
      recordingMediaId: recording.id,
      state: opts.state ?? "draft",
      audienceTier: opts.audienceTier ?? "private",
    })
    .returning();
  if (opts.withApprovalConsent) {
    await db.insert(consentRecords).values({
      personId: opts.ownerPersonId,
      actorPersonId: opts.ownerPersonId,
      storyId: story!.id,
      action: "approved_for_sharing",
      resultingState: "shared",
    });
  }
  return { story: story!, recording };
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
