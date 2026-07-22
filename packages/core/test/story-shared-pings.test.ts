/**
 * Loop-event pings (#270 / C13b): recipient resolution for "story landed" emails.
 * Metadata only — never returns story prose/media.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, accountContacts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  createAsk,
  listStorySharedPingRecipients,
  persistRecordingAndCreateDraft,
  setNotificationStreamFrequency,
  transitionStoryState,
  updateDerivedFields,
} from "../src/index";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
  revokeConsent,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

async function attachVerifiedEmail(personId: string, email: string) {
  const [acct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: `auth|${crypto.randomUUID()}`,
      email,
    })
    .returning();
  await db.update(persons).set({ accountId: acct!.id }).where(eq(persons.id, personId));
  await db.insert(accountContacts).values({
    accountId: acct!.id,
    kind: "email",
    value: email.toLowerCase(),
    verifiedAt: new Date(),
  });
  return acct!;
}

async function attachAccountEmailOnly(personId: string, email: string) {
  const [acct] = await db
    .insert(accounts)
    .values({
      authProviderUserId: `auth|${crypto.randomUUID()}`,
      email,
    })
    .returning();
  await db.update(persons).set({ accountId: acct!.id }).where(eq(persons.id, personId));
  return acct!;
}

describe("listStorySharedPingRecipients", () => {
  it("returns empty for a missing story", async () => {
    const result = await listStorySharedPingRecipients(
      db,
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toEqual({
      ownerPersonId: null,
      narratorDisplayName: null,
      storyTitleOrNull: null,
      askId: null,
      recipients: [],
    });
  });

  it("returns empty for an unshared draft", async () => {
    const owner = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "draft",
      audienceTier: "family",
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([]);
    expect(result.ownerPersonId).toBe(owner.id);
  });

  it("emails authorized co-members with verified email; excludes owner; skips no-email", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const marcus = await makePerson(db, "Marcus");
    const noEmail = await makePerson(db, "NoEmail");
    const fam = await makeFamily(db, "Boudreaux", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await addMembership(db, marcus.id, fam.id);
    await addMembership(db, noEmail.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");
    await attachVerifiedEmail(marcus.id, "marcus@example.com");
    // owner has email too — must still be excluded
    await attachVerifiedEmail(owner.id, "eleanor@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.ownerPersonId).toBe(owner.id);
    expect(result.narratorDisplayName).toBe("Eleanor");
    expect(result.storyTitleOrNull).toBe("Sunday dinner");
    expect(result.askId).toBeNull();
    expect(result.recipients).toHaveLength(2);
    const byEmail = Object.fromEntries(result.recipients.map((r) => [r.email, r]));
    expect(byEmail["sofia@example.com"]).toMatchObject({
      personId: sofia.id,
      kind: "family",
    });
    expect(byEmail["marcus@example.com"]).toMatchObject({
      personId: marcus.id,
      kind: "family",
    });
    expect(result.recipients.every((r) => r.personId !== owner.id)).toBe(true);
    expect(result.recipients.every((r) => r.personId !== noEmail.id)).toBe(true);
  });

  it("falls back to accounts.email when no verified contact exists", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await attachAccountEmailOnly(sofia.id, "sofia-fallback@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      {
        personId: sofia.id,
        email: "sofia-fallback@example.com",
        kind: "family",
      },
    ]);
  });

  it("excludes members of a different family (not targeted)", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const outsider = await makePerson(db, "Outsider");
    const famA = await makeFamily(db, "A", owner.id);
    const famB = await makeFamily(db, "B", outsider.id);
    await addMembership(db, owner.id, famA.id);
    await addMembership(db, sofia.id, famA.id);
    await addMembership(db, outsider.id, famB.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");
    await attachVerifiedEmail(outsider.id, "out@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [famA.id],
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients.map((r) => r.personId)).toEqual([sofia.id]);
  });

  it("tags the asker when the story answers an Ask", async () => {
    const owner = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const other = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, other.id, fam.id);
    await attachVerifiedEmail(asker.id, "sofia@example.com");
    await attachVerifiedEmail(other.id, "marcus@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: owner.id, questionText: "Tell me about Sunday dinner." },
    );
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: owner.id,
        storageKey: "r2://r.webm",
        contentType: "audio/webm",
        checksum: "sha256:r",
      },
      { askId: ask.id },
    );
    await updateDerivedFields(db, story.id, {
      transcript: "t",
      prose: "p",
      title: "Sunday",
      summary: "s",
      tags: [],
    });
    await transitionStoryState(db, story.id, "pending_approval");
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: owner.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.askId).toBe(ask.id);
    const askerRec = result.recipients.find((r) => r.personId === asker.id);
    const otherRec = result.recipients.find((r) => r.personId === other.id);
    expect(askerRec?.kind).toBe("asker");
    expect(otherRec?.kind).toBe("family");
  });

  it("for public stories with no targets, pings owner's active family members", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
      title: "Open story",
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      { personId: sofia.id, email: "sofia@example.com", kind: "family" },
    ]);
  });

  it("returns empty after consent revocation", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    await revokeConsent(db, story.id, owner.id);

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([]);
  });

  it("omits asker when answers_to_my_asks is off (no fall-through to family_activity)", async () => {
    const owner = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const other = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, other.id, fam.id);
    await attachVerifiedEmail(asker.id, "sofia@example.com");
    await attachVerifiedEmail(other.id, "marcus@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: owner.id, questionText: "Tell me about Sunday dinner." },
    );
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: owner.id,
        storageKey: "r2://r.webm",
        contentType: "audio/webm",
        checksum: "sha256:r",
      },
      { askId: ask.id },
    );
    await updateDerivedFields(db, story.id, {
      transcript: "t",
      prose: "p",
      title: "Sunday",
      summary: "s",
      tags: [],
    });
    await transitionStoryState(db, story.id, "pending_approval");
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: owner.id,
      audienceTier: "family",
      approvalAudio: {
        storageKey: "k",
        contentType: "audio/webm",
        checksum: "sha256:x",
      },
    });

    await setNotificationStreamFrequency(
      db,
      asker.id,
      "answers_to_my_asks",
      "off",
    );
    // Family activity stays every_item (default) — asker must still be omitted.
    await setNotificationStreamFrequency(
      db,
      other.id,
      "family_activity",
      "every_item",
    );

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients.map((r) => r.personId)).toEqual([other.id]);
    expect(result.recipients.find((r) => r.personId === asker.id)).toBeUndefined();
  });

  it("omits non-asker when family_activity is off; keeps every_item co-members", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const marcus = await makePerson(db, "Marcus");
    const fam = await makeFamily(db, "Boudreaux", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await addMembership(db, marcus.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");
    await attachVerifiedEmail(marcus.id, "marcus@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    await setNotificationStreamFrequency(db, sofia.id, "family_activity", "off");
    // marcus: no prefs row → every_item

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      {
        personId: marcus.id,
        email: "marcus@example.com",
        kind: "family",
      },
    ]);
  });

  it("preserves pre-prefs audience when no prefs rows exist", async () => {
    const owner = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, sofia.id, fam.id);
    await attachVerifiedEmail(sofia.id, "sofia@example.com");

    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
      title: "Sunday dinner",
    });

    const result = await listStorySharedPingRecipients(db, story.id);
    expect(result.recipients).toEqual([
      {
        personId: sofia.id,
        email: "sofia@example.com",
        kind: "family",
      },
    ]);
    expect(result.recipients.every((r) => r.personId !== owner.id)).toBe(true);
  });
});
