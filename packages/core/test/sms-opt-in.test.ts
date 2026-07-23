/**
 * recordAccountSmsOptIn — welcome/signup SMS consent write (not an account_contacts match key).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import { accounts } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import {
  createAccountWithPerson,
  recordAccountSmsOptIn,
  InvariantViolation,
} from "../src/index";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("recordAccountSmsOptIn", () => {
  it("writes sms_phone + sms_opted_in_at on the person's account", async () => {
    const { personId, accountId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "usr_sms_1",
      email: "rosa@example.com",
      emailVerified: true,
      displayName: "Rosa Esposito",
    });
    const now = new Date("2026-07-23T12:00:00Z");
    await recordAccountSmsOptIn(db, personId, { phone: "+15551230000", now });

    const [row] = await db
      .select({ smsPhone: accounts.smsPhone, smsOptedInAt: accounts.smsOptedInAt })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);
    expect(row?.smsPhone).toBe("+15551230000");
    expect(row?.smsOptedInAt?.toISOString()).toBe(now.toISOString());
  });

  it("rejects an empty phone", async () => {
    const { personId } = await createAccountWithPerson(db, {
      provider: "clerk",
      authProviderUserId: "usr_sms_2",
      email: "sal@example.com",
      emailVerified: true,
      displayName: "Sal",
    });
    await expect(recordAccountSmsOptIn(db, personId, { phone: "  " })).rejects.toBeInstanceOf(
      InvariantViolation,
    );
  });
});
