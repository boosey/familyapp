/**
 * questions-for-me outbound ping (#276) — resolve whether the askee should be emailed when an
 * Ask becomes actionable. Metadata only — never returns story prose/media.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts, accountContacts, persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAsk,
  resolveQuestionsForMePing,
  setNotificationStreamFrequency,
} from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";

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

describe("resolveQuestionsForMePing", () => {
  it("returns null for a missing ask", async () => {
    const result = await resolveQuestionsForMePing(
      db,
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result).toBeNull();
  });

  it("returns a recipient for an askee with a verified email and no prefs row (default every_item)", async () => {
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

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result).not.toBeNull();
    expect(result!.askId).toBe(ask.id);
    expect(result!.askeePersonId).toBe(askee.id);
    expect(result!.askerDisplayName).toBe("Sofia");
    expect(result!.questionText).toBe("Tell me about Sunday dinner.");
    expect(result!.recipient).toEqual({
      personId: askee.id,
      email: "eleanor@example.com",
    });
  });

  it("returns a recipient when questions_for_me is explicitly every_item", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(askee.id, "eleanor@example.com");
    await setNotificationStreamFrequency(db, askee.id, "questions_for_me", "every_item");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result!.recipient).toEqual({
      personId: askee.id,
      email: "eleanor@example.com",
    });
  });

  it("returns null recipient when questions_for_me is off", async () => {
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

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result).not.toBeNull();
    expect(result!.recipient).toBeNull();
  });

  it("returns null recipient when the askee has no reachable email", async () => {
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

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result).not.toBeNull();
    expect(result!.recipient).toBeNull();
  });

  it("never returns the asker as recipient — the recipient is always the askee (targetPersonId)", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(asker.id, "sofia@example.com");
    await attachVerifiedEmail(askee.id, "eleanor@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result!.recipient?.personId).toBe(askee.id);
    expect(result!.recipient?.personId).not.toBe(asker.id);
  });

  it("returns null recipient when the askee is also the asker (self-ask safety)", async () => {
    const person = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", person.id);
    await addMembership(db, person.id, fam.id);
    await attachVerifiedEmail(person.id, "eleanor@example.com");

    const ask = await createAsk(
      db,
      { kind: "account", personId: person.id },
      { targetPersonId: person.id, questionText: "Q?" },
    );

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result).not.toBeNull();
    expect(result!.recipient).toBeNull();
  });

  it("still returns a recipient for digest frequencies (only off suppresses, per #279)", async () => {
    const asker = await makePerson(db, "Sofia");
    const askee = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "B", asker.id);
    await addMembership(db, asker.id, fam.id);
    await addMembership(db, askee.id, fam.id);
    await attachVerifiedEmail(askee.id, "eleanor@example.com");
    await setNotificationStreamFrequency(db, askee.id, "questions_for_me", "daily_digest");

    const ask = await createAsk(
      db,
      { kind: "account", personId: asker.id },
      { targetPersonId: askee.id, questionText: "Q?" },
    );

    const result = await resolveQuestionsForMePing(db, ask.id);
    expect(result!.recipient).toEqual({
      personId: askee.id,
      email: "eleanor@example.com",
    });
  });
});
