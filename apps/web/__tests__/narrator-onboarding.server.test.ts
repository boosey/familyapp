/**
 * Web-side regression test for issue #79 — a logged-in relative designates a narrator and hands off
 * the login-free capture link. Covers the deliverable the AC names explicitly:
 *   - link generation      : designate → a link_sessions row exists + the raw token is returned once
 *   - designate (role)     : the narrator's active membership role becomes `narrator` (idempotent)
 *   - token-is-identity    : resolveLinkSession(token) → the right personId + familyId (no account)
 *   - attribution          : ingestRecording via that token → story owned by narrator + originating family
 *   - membership gate       : a non-active member cannot be designated (AuthorizationError; nothing minted)
 *
 * Exercises `designateAndCreateNarratorLink` (the extracted, testable core of InviteTab's createInvite
 * action) against a real PGlite DB + in-memory storage. No mocks of the domain — only the runtime seam
 * is unneeded here because the helper takes db explicitly (the InviteTab action wires getRuntime()).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  AuthorizationError,
  getStoryForViewer,
  listMembersOfFamily,
} from "@chronicle/core";
import { ingestRecording, resolveLinkSession } from "@chronicle/capture";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { designateAndCreateNarratorLink } from "@/lib/narrator-onboarding";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function rowCount(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function makeNarratorAndInviter() {
  const [narrator] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor" })
    .returning();
  const [inviter] = await db
    .insert(persons)
    .values({ displayName: "Sofia", spokenName: "Sofia" })
    .returning();
  const [fam] = await db
    .insert(families)
    .values({ name: "Boudreaux", creatorPersonId: inviter!.id, stewardPersonId: inviter!.id })
    .returning();
  // Both start as plain active members — designation is what promotes the narrator's role.
  await db.insert(memberships).values([
    { personId: narrator!.id, familyId: fam!.id, role: "member", status: "active" },
    { personId: inviter!.id, familyId: fam!.id, role: "member", status: "active" },
  ]);
  return { narrator: narrator!, inviter: inviter!, family: fam! };
}

describe("designateAndCreateNarratorLink (#79 narrator onboarding)", () => {
  it("designates the narrator role AND mints a link session, returning the raw token once", async () => {
    const { narrator, inviter, family } = await makeNarratorAndInviter();

    const { token } = await designateAndCreateNarratorLink(db, {
      inviterPersonId: inviter.id,
      narratorPersonId: narrator.id,
      familyId: family.id,
    });

    // link generation: exactly one session row, and the raw token is returned (never stored raw).
    expect(token).toBeTruthy();
    expect(await rowCount("link_sessions")).toBe(1);

    // designate: the narrator's active membership is now role=narrator.
    const members = await listMembersOfFamily(db, family.id);
    expect(members.find((m) => m.personId === narrator.id)?.role).toBe("narrator");
    // The inviter is untouched.
    expect(members.find((m) => m.personId === inviter.id)?.role).toBe("member");
  });

  it("token-is-identity: the returned token resolves to the narrator + family with NO account", async () => {
    const { narrator, inviter, family } = await makeNarratorAndInviter();
    const { token } = await designateAndCreateNarratorLink(db, {
      inviterPersonId: inviter.id,
      narratorPersonId: narrator.id,
      familyId: family.id,
    });

    const resolved = await resolveLinkSession(db, token);
    expect(resolved?.personId).toBe(narrator.id);
    expect(resolved?.familyId).toBe(family.id);
  });

  it("attribution: a recording captured via the token is owned by the narrator + originating family", async () => {
    const { narrator, inviter, family } = await makeNarratorAndInviter();
    const { token } = await designateAndCreateNarratorLink(db, {
      inviterPersonId: inviter.id,
      narratorPersonId: narrator.id,
      familyId: family.id,
    });

    const { storyId } = await ingestRecording(db, storage, {
      actor: { kind: "link_session", token },
      audio: { bytes: new Uint8Array([9, 8, 7]), contentType: "audio/webm" },
    });

    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      storyId,
    );
    expect(story?.ownerPersonId).toBe(narrator.id);
    expect(story?.originatingFamilyId).toBe(family.id);
  });

  it("is idempotent — designating an already-narrator member still mints a link, no error", async () => {
    const { narrator, inviter, family } = await makeNarratorAndInviter();
    // Promote once.
    await designateAndCreateNarratorLink(db, {
      inviterPersonId: inviter.id,
      narratorPersonId: narrator.id,
      familyId: family.id,
    });
    // Second designation must succeed and mint a second link.
    const { token } = await designateAndCreateNarratorLink(db, {
      inviterPersonId: inviter.id,
      narratorPersonId: narrator.id,
      familyId: family.id,
    });
    expect(token).toBeTruthy();
    expect(await rowCount("link_sessions")).toBe(2);
    const members = await listMembersOfFamily(db, family.id);
    expect(members.find((m) => m.personId === narrator.id)?.role).toBe("narrator");
  });

  it("membership gate: cannot designate a non-active member — throws and mints NOTHING", async () => {
    const { inviter, family } = await makeNarratorAndInviter();
    // An outsider with no membership in the family.
    const [outsider] = await db
      .insert(persons)
      .values({ displayName: "Outsider", spokenName: "Outsider" })
      .returning();

    await expect(
      designateAndCreateNarratorLink(db, {
        inviterPersonId: inviter.id,
        narratorPersonId: outsider!.id,
        familyId: family.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // No link session was created (designation is rejected before minting).
    expect(await rowCount("link_sessions")).toBe(0);
  });

  it("membership gate: cannot designate when the INVITER is not an active member — nothing minted", async () => {
    const { narrator, family } = await makeNarratorAndInviter();
    const [stranger] = await db
      .insert(persons)
      .values({ displayName: "Stranger", spokenName: "Stranger" })
      .returning();

    await expect(
      designateAndCreateNarratorLink(db, {
        inviterPersonId: stranger!.id,
        narratorPersonId: narrator.id,
        familyId: family.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(await rowCount("link_sessions")).toBe(0);
  });
});
