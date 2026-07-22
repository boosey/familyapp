/**
 * Loop-event pings (#270 / C13b) — resolve who should get a "story landed" email.
 *
 * Metadata only: never returns story prose, transcript, or media. Reads the stories table
 * (allowlisted) solely for identity/teaser fields needed to address the outbound ping.
 */
import { and, eq, inArray } from "drizzle-orm";
import { stories } from "@chronicle/db/content";
import { asks, memberships, persons, storyFamilies } from "@chronicle/db/schema";
import type { Database } from "@chronicle/db";
import { decideStoryRead, type AuthContext } from "./authorization";
import { isCurrentlyShared } from "./consent";
import { shouldDeliverImmediately } from "./notification-immediate";
import { resolvePersonEmails } from "./person-emails";

export type StorySharedPingKind = "asker" | "family";

export interface StorySharedPingRecipient {
  personId: string;
  email: string;
  kind: StorySharedPingKind;
}

export interface StorySharedPingContext {
  ownerPersonId: string | null;
  narratorDisplayName: string | null;
  storyTitleOrNull: string | null;
  askId: string | null;
  recipients: StorySharedPingRecipient[];
}

const EMPTY: StorySharedPingContext = {
  ownerPersonId: null,
  narratorDisplayName: null,
  storyTitleOrNull: null,
  askId: null,
  recipients: [],
};

/**
 * Recipients for a post-share email ping. Empty when the story is missing, not currently
 * shared, private, or has no emailable authorized co-members. Owner is never included.
 * Stream prefs are honored via `shouldDeliverImmediately` (`off` omits; absent prefs
 * default to every_item). Asker → `answers_to_my_asks`; family → `family_activity`.
 */
export async function listStorySharedPingRecipients(
  db: Database,
  storyId: string,
): Promise<StorySharedPingContext> {
  const [story] = await db
    .select({
      id: stories.id,
      ownerPersonId: stories.ownerPersonId,
      state: stories.state,
      audienceTier: stories.audienceTier,
      title: stories.title,
      askId: stories.askId,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);

  if (!story) return EMPTY;

  const [owner] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
    })
    .from(persons)
    .where(eq(persons.id, story.ownerPersonId))
    .limit(1);

  const narratorDisplayName =
    owner?.spokenName ?? owner?.displayName ?? null;

  const base: StorySharedPingContext = {
    ownerPersonId: story.ownerPersonId,
    narratorDisplayName,
    storyTitleOrNull: story.title,
    askId: story.askId,
    recipients: [],
  };

  if (story.audienceTier === "private") return base;
  if (!(await isCurrentlyShared(db, storyId))) return base;

  const candidateIds = await resolveCandidatePersonIds(db, story);
  const withoutOwner = candidateIds.filter((id) => id !== story.ownerPersonId);
  if (withoutOwner.length === 0) return base;

  const authorized: string[] = [];
  for (const personId of withoutOwner) {
    const ctx: AuthContext = { kind: "account", personId };
    const decision = await decideStoryRead(db, ctx, story);
    if (decision.allowed) authorized.push(personId);
  }
  if (authorized.length === 0) return base;

  let askerPersonId: string | null = null;
  if (story.askId) {
    const [ask] = await db
      .select({ askerPersonId: asks.askerPersonId })
      .from(asks)
      .where(eq(asks.id, story.askId))
      .limit(1);
    askerPersonId = ask?.askerPersonId ?? null;
  }

  const emailsByPerson = await resolvePersonEmails(db, authorized);
  const recipients: StorySharedPingRecipient[] = [];
  for (const personId of authorized) {
    const email = emailsByPerson.get(personId);
    if (!email) continue;
    const kind: StorySharedPingKind =
      askerPersonId !== null && personId === askerPersonId ? "asker" : "family";
    const stream =
      kind === "asker" ? "answers_to_my_asks" : "family_activity";
    if (!(await shouldDeliverImmediately(db, personId, stream))) continue;
    recipients.push({ personId, email, kind });
  }

  return { ...base, recipients };
}

async function resolveCandidatePersonIds(
  db: Database,
  story: {
    id: string;
    ownerPersonId: string;
    audienceTier: string;
  },
): Promise<string[]> {
  const targetRows = await db
    .select({ familyId: storyFamilies.familyId })
    .from(storyFamilies)
    .where(eq(storyFamilies.storyId, story.id));
  let familyIds = targetRows.map((r) => r.familyId);

  if (familyIds.length === 0 && story.audienceTier === "public") {
    const ownerFams = await db
      .select({ familyId: memberships.familyId })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, story.ownerPersonId),
          eq(memberships.status, "active"),
        ),
      );
    familyIds = ownerFams.map((r) => r.familyId);
  }

  if (familyIds.length === 0) return [];

  const members = await db
    .select({ personId: memberships.personId })
    .from(memberships)
    .where(
      and(
        inArray(memberships.familyId, familyIds),
        eq(memberships.status, "active"),
      ),
    );
  return [...new Set(members.map((m) => m.personId))];
}
