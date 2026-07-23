/**
 * Tests for the invite-delivery orchestrator (lib/deliver-invite · deliverInvite).
 *
 * Pure function: db + notifier in, best-effort delivery over requested channels, outcome recorded
 * on the invitation row (deliveredAt / deliveryError / deliveryAttempts). No Inngest, no Next — a
 * later task wires this into a worker + server action.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { invitations as invitationsTable } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addMembership, createInvitation } from "@chronicle/core";
import { MockNotifier } from "@chronicle/notifications";
import { deliverInvite } from "../lib/deliver-invite";
import { makeFamily, makePerson } from "../../../packages/core/test/helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** Steward + family with the steward as an active member (so they may invite). */
async function familyWithSteward(name = "Esposito") {
  const steward = await makePerson(db, "Rosa Esposito");
  const fam = await makeFamily(db, name, steward.id);
  await addMembership(db, {
    personId: steward.id,
    familyId: fam.id,
    role: "steward",
  });
  return { steward, fam };
}

describe("deliverInvite", () => {
  it("delivers over email + sms and records success", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });
    const notifier = new MockNotifier();
    const link = `https://app.test/join/${token}`;

    await deliverInvite({
      db,
      notifier,
      invitationId,
      channels: ["email", "sms"],
      link,
    });

    expect(notifier.sent).toHaveLength(2);
    const email = notifier.sent.find((m) => m.channel === "email");
    const sms = notifier.sent.find((m) => m.channel === "sms");
    expect(email).toBeDefined();
    expect(email && "subject" in email ? email.subject : undefined).toContain("Esposito");
    expect(email?.text).toContain(link);
    expect(sms).toBeDefined();
    expect(sms?.text).toContain(link);
    expect(sms?.text).toContain("STOP");
    expect(sms?.text).toContain("HELP");

    const [row] = await db
      .select({
        deliveredAt: invitationsTable.deliveredAt,
        deliveryAttempts: invitationsTable.deliveryAttempts,
      })
      .from(invitationsTable)
      .where(eq(invitationsTable.id, invitationId))
      .limit(1);
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.deliveryAttempts).toBe(1);
  });

  it("records partial failure: email succeeds, sms fails, link/token still delivered via email", async () => {
    const { steward, fam } = await familyWithSteward();
    const { invitationId, token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: steward.id,
      inviteeName: "Salvatore",
      inviteeEmail: "sal@example.com",
      inviteePhone: "+15551230000",
    });
    const notifier = new MockNotifier({ failChannels: ["sms"] });
    const link = `https://app.test/join/${token}`;

    await deliverInvite({
      db,
      notifier,
      invitationId,
      channels: ["email", "sms"],
      link,
    });

    const [row] = await db
      .select({
        deliveredAt: invitationsTable.deliveredAt,
        deliveryError: invitationsTable.deliveryError,
        deliveryAttempts: invitationsTable.deliveryAttempts,
      })
      .from(invitationsTable)
      .where(eq(invitationsTable.id, invitationId))
      .limit(1);
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.deliveryError).toContain("sms");
    expect(row?.deliveryAttempts).toBe(1);

    const email = notifier.sent.find((m) => m.channel === "email");
    expect(email?.text).toContain("/join/");
    expect(email?.text).toContain(token);
  });
});
