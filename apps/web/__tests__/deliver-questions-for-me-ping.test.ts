/**
 * Tests for deliverQuestionsForMePing (#276) — MockNotifier asserts email shape + deeplink + prefs.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, accountContacts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsk, setNotificationStreamFrequency } from "@chronicle/core";
import { MockNotifier } from "@chronicle/notifications";
import { deliverQuestionsForMePing } from "../lib/deliver-questions-for-me-ping";
import { addMembership, makeFamily, makePerson } from "../../../packages/core/test/helpers";

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

describe("deliverQuestionsForMePing", () => {
  it("sends one email to the askee with a hub answer deeplink when every_item (default)", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(askee.id, "eleanor@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Tell me about Sunday dinner." },
    );

    const notifier = new MockNotifier();
    await deliverQuestionsForMePing({
      db,
      notifier,
      askId: ask.id,
      origin: "https://app.test",
    });

    expect(notifier.sent).toHaveLength(1);
    const msg = notifier.sent[0]!;
    expect(msg.channel).toBe("email");
    expect(msg.to).toBe("eleanor@example.com");
    expect(msg.text).toContain(`https://app.test/hub/answer/${ask.id}`);
    if (msg.channel === "email") {
      expect(msg.subject).toContain("Sofia");
    }
  });

  it("normalizes a trailing slash on origin", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(askee.id, "eleanor@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const notifier = new MockNotifier();
    await deliverQuestionsForMePing({
      db,
      notifier,
      askId: ask.id,
      origin: "https://app.test/",
    });

    expect(notifier.sent[0]!.text).toContain(`https://app.test/hub/answer/${ask.id}`);
    expect(notifier.sent[0]!.text).not.toContain("app.test//hub");
  });

  it("sends zero emails when questions_for_me is off", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(askee.id, "eleanor@example.com");
    await setNotificationStreamFrequency(db, askee.id, "questions_for_me", "off");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const notifier = new MockNotifier();
    await deliverQuestionsForMePing({
      db,
      notifier,
      askId: ask.id,
      origin: "https://app.test",
    });

    expect(notifier.sent).toHaveLength(0);
  });

  it("no-ops when the askee has no reachable email", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const notifier = new MockNotifier();
    await deliverQuestionsForMePing({
      db,
      notifier,
      askId: ask.id,
      origin: "https://app.test",
    });

    expect(notifier.sent).toHaveLength(0);
  });

  it("no-ops for a missing ask", async () => {
    const notifier = new MockNotifier();
    await deliverQuestionsForMePing({
      db,
      notifier,
      askId: "00000000-0000-0000-0000-000000000001",
      origin: "https://app.test",
    });
    expect(notifier.sent).toHaveLength(0);
  });
});
