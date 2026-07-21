/**
 * Tests for deliverStorySharedPings — MockNotifier asserts email shape + hub link.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, accountContacts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  approveAndShareStory,
  createAsk,
  persistRecordingAndCreateDraft,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
import { MockNotifier } from "@chronicle/notifications";
import { deliverStorySharedPings } from "../lib/deliver-story-shared-pings";
import {
  addMembership,
  makeFamily,
  makePerson,
  makeStory,
} from "../../../packages/core/test/helpers";

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
}

describe("deliverStorySharedPings", () => {
  it("sends one family email per recipient with hub story link", async () => {
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

    const notifier = new MockNotifier();
    await deliverStorySharedPings({
      db,
      notifier,
      storyId: story.id,
      origin: "https://app.test",
    });

    expect(notifier.sent).toHaveLength(1);
    const msg = notifier.sent[0]!;
    expect(msg.channel).toBe("email");
    expect(msg.to).toBe("sofia@example.com");
    expect(msg.text).toContain("https://app.test/hub/stories/" + story.id);
    expect(msg.text).toContain("Sunday dinner");
    if (msg.channel === "email") {
      expect(msg.subject).toContain("Eleanor");
      expect(msg.subject.toLowerCase()).toContain("story landed");
    }
  });

  it("uses asker copy when the recipient is the asker", async () => {
    const owner = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, asker.id, fam.id);
    await attachVerifiedEmail(asker.id, "sofia@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: owner.id, questionText: "Q?" },
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
      title: "Answer",
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

    const notifier = new MockNotifier();
    await deliverStorySharedPings({
      db,
      notifier,
      storyId: story.id,
      origin: "https://app.test/",
    });

    expect(notifier.sent).toHaveLength(1);
    const msg = notifier.sent[0]!;
    if (msg.channel === "email") {
      expect(msg.subject.toLowerCase()).toContain("answered");
    }
    expect(msg.text).toContain(`/hub/stories/${story.id}`);
    // No prose / ask text leakage.
    expect(msg.text).not.toContain("Q?");
    expect(msg.text).not.toContain("prose");
  });

  it("no-ops when there are no recipients", async () => {
    const owner = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "draft",
    });
    const notifier = new MockNotifier();
    await deliverStorySharedPings({
      db,
      notifier,
      storyId: story.id,
      origin: "https://app.test",
    });
    expect(notifier.sent).toHaveLength(0);
  });
});
