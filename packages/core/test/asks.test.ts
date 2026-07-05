/**
 * Tests for the Ask repository (Increment 6 / wedge of Increment 7).
 *
 * Authorization rule: the asker must share an ACTIVE family membership with the target narrator —
 * mirrors the family-tier read rule in the authorization function. The interviewer's
 * system-actor read (`listPendingAsksForNarrator`) is separately covered for ordering and inclusion.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { askFamilies, askSubjectPhotos, asks, memberships } from "@chronicle/db/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  acceptInvitation,
  createAlbumPhoto,
  createAsk,
  createInvitation,
  listAskSubjectPhotos,
  listAsksByAsker,
  listPendingAsksForNarrator,
} from "../src/index";
import { addMembership, endMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("createAsk — co-membership authorization", () => {
  it("allows a co-member of any shared family to ask", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        familyIds: [fam.id],
        questionText: "What was your wedding day like?",
      },
    );
    expect(ask.status).toBe("queued");
    expect(ask.askerPersonId).toBe(cousin.id);
    expect(ask.targetPersonId).toBe(narrator.id);
    // The family context now lives in the ask_families M2M join, not on the ask row.
    const famRows = await db
      .select({ familyId: askFamilies.familyId })
      .from(askFamilies)
      .where(eq(askFamilies.askId, ask.id));
    expect(famRows.map((r) => r.familyId)).toEqual([fam.id]);
  });

  it("targets MULTIPLE families supplied on one ask", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const famA = await makeFamily(db, "A", narrator.id);
    const famB = await makeFamily(db, "B", narrator.id);
    await addMembership(db, narrator.id, famA.id);
    await addMembership(db, narrator.id, famB.id);
    await addMembership(db, cousin.id, famA.id);
    await addMembership(db, cousin.id, famB.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        familyIds: [famA.id, famB.id],
        questionText: "Q for both families",
      },
    );
    const famRows = await db
      .select({ familyId: askFamilies.familyId })
      .from(askFamilies)
      .where(eq(askFamilies.askId, ask.id));
    expect(new Set(famRows.map((r) => r.familyId))).toEqual(
      new Set([famA.id, famB.id]),
    );
  });

  it("rejects a stranger (no shared family)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: stranger.id },
        { targetPersonId: narrator.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a former co-member whose membership has ENDED (divorce semantics)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const exSpouse = await makePerson(db, "Ex");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    const m = await addMembership(db, exSpouse.id, fam.id);
    await endMembership(db, m.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: exSpouse.id },
        { targetPersonId: narrator.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects anonymous askers", async () => {
    const narrator = await makePerson(db, "Eleanor");
    await expect(
      createAsk(
        db,
        { kind: "anonymous" },
        { targetPersonId: narrator.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects an empty question (trims whitespace)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        { targetPersonId: narrator.id, questionText: "   \n  " },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a supplied familyId the asker is not actually in (form-spoof defense)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const shared = await makeFamily(db, "Shared", narrator.id);
    const other = await makeFamily(db, "Other", narrator.id);
    await addMembership(db, narrator.id, shared.id);
    await addMembership(db, cousin.id, shared.id);
    // cousin is NOT in `other`, but tries to claim that family context
    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        {
          targetPersonId: narrator.id,
          familyIds: [other.id],
          questionText: "Q",
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("createAsk with subject photos (ADR-0009 Phase 3)", () => {
  it("returns photos in DETERMINISTIC insertion order (by seq) even when every row shares one added_at", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    // Five photos so a reshuffle is highly likely to be observable if ordering were unstable.
    const photos = [];
    for (let i = 0; i < 5; i++) {
      photos.push(
        await createAlbumPhoto(db, {
          contributorPersonId: cousin.id,
          familyIds: [fam.id],
          source: "upload",
          storageKey: `family-photos/ask-ord-${i}`,
        }),
      );
    }
    // Insertion order deliberately NOT sorted by photo id, so passing can't come from an incidental
    // id-order: reverse the album order.
    const requested = [...photos].reverse().map((p) => p.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        familyIds: [fam.id],
        questionText: "Tell the story of these photos",
        subjectPhotoIds: requested,
      },
    );
    expect(ask.status).toBe("queued");

    // TEETH: createAsk writes all five rows in ONE bulk INSERT inside ONE transaction, so Postgres
    // stamps every `added_at` with the identical transaction-start timestamp. Assert that tie is real
    // — the OLD `ORDER BY added_at` had NOTHING left to disambiguate, so it could return any
    // permutation; only the monotonic `seq` yields the insertion-consistent order asserted below.
    const rows = await db
      .select({ addedAt: askSubjectPhotos.addedAt, seq: askSubjectPhotos.seq })
      .from(askSubjectPhotos)
      .where(eq(askSubjectPhotos.askId, ask.id));
    const distinctAddedAt = new Set(rows.map((r) => r.addedAt.getTime()));
    expect(distinctAddedAt.size).toBe(1); // all rows tie on added_at
    expect(rows).toHaveLength(5);

    // The exact insertion order is preserved, ordered strictly by seq.
    expect(await listAskSubjectPhotos(db, ask.id)).toEqual(requested);
  });

  it("dedupes repeated photo ids", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    const p1 = await createAlbumPhoto(db, {
      contributorPersonId: cousin.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/ask-dup",
    });
    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        questionText: "Q",
        subjectPhotoIds: [p1.id, p1.id, p1.id],
      },
    );
    expect(await listAskSubjectPhotos(db, ask.id)).toEqual([p1.id]);
  });

  it("REJECTS a photo the asker cannot see — with NO ask written", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    // A photo in a DIFFERENT family the asker is not a member of.
    const stranger = await makePerson(db, "Stranger");
    const otherFam = await makeFamily(db, "Carney", stranger.id);
    await addMembership(db, stranger.id, otherFam.id);
    const unseeable = await createAlbumPhoto(db, {
      contributorPersonId: stranger.id,
      familyIds: [otherFam.id],
      source: "upload",
      storageKey: "family-photos/ask-secret",
    });

    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        {
          targetPersonId: narrator.id,
          questionText: "Sneaky",
          subjectPhotoIds: [unseeable.id],
        },
      ),
    ).rejects.toThrow();

    // The co-membership check passed, but the photo gate rolled the whole tx back — no ask exists.
    expect(await listPendingAsksForNarrator(db, narrator.id)).toHaveLength(0);
  });

  it("REJECTS a photo the TARGET cannot see (asker can) — with NO ask written", async () => {
    // The asker and target share family `fam`. The asker ALSO belongs to a second family `askerOnly`
    // the target is not in, and attaches a photo from THERE. The asker can see it, but the target
    // (the future answerer) cannot — so carrying it forward on the answer path would make the ask
    // unanswerable. createAsk must reject it against the TARGET too, leaving no ask behind.
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    // A second family the asker (cousin) is in but the target (narrator) is NOT.
    const askerOnly = await makeFamily(db, "Carney", cousin.id);
    await addMembership(db, cousin.id, askerOnly.id);
    const askerVisibleTargetInvisible = await createAlbumPhoto(db, {
      contributorPersonId: cousin.id,
      familyIds: [askerOnly.id],
      source: "upload",
      storageKey: "family-photos/ask-target-blind",
    });

    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        {
          targetPersonId: narrator.id,
          familyIds: [fam.id],
          questionText: "Tell me about this",
          subjectPhotoIds: [askerVisibleTargetInvisible.id],
        },
      ),
    ).rejects.toThrow();

    // The target-gate rolled the whole tx back — no ask row, no subject-photo row.
    expect(await listPendingAsksForNarrator(db, narrator.id)).toHaveLength(0);
    const askRows = await db.select().from(asks);
    expect(askRows).toHaveLength(0);
    const photoRows = await db.select().from(askSubjectPhotos);
    expect(photoRows).toHaveLength(0);
  });

  it("still enforces the co-membership gate even with valid-looking photos", async () => {
    // A stranger with their own family + photo cannot ask a narrator they share no family with,
    // regardless of subject photos.
    const narrator = await makePerson(db, "Eleanor");
    await makeFamily(db, "Boudreaux", narrator.id);
    const stranger = await makePerson(db, "Stranger");
    const strangerFam = await makeFamily(db, "Carney", stranger.id);
    await addMembership(db, stranger.id, strangerFam.id);
    const p = await createAlbumPhoto(db, {
      contributorPersonId: stranger.id,
      familyIds: [strangerFam.id],
      source: "upload",
      storageKey: "family-photos/ask-nocomember",
    });
    await expect(
      createAsk(
        db,
        { kind: "account", personId: stranger.id },
        {
          targetPersonId: narrator.id,
          questionText: "Q",
          subjectPhotoIds: [p.id],
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("createAsk — ADR-0006 invitation floor", () => {
  it("lets an active member ask a PENDING invitee of their family (before the invitee joins)", async () => {
    const inviter = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", inviter.id);
    await addMembership(db, inviter.id, fam.id);
    // Sofia invites her grandmother; the provisional Person is the ask target.
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: inviter.id,
      inviteeName: "Eleanor",
    });

    const ask = await createAsk(
      db,
      { kind: "account", personId: inviter.id },
      {
        targetPersonId: inviteePersonId,
        familyIds: [fam.id],
        questionText: "What was your wedding day like?",
      },
    );
    expect(ask.status).toBe("queued");
    expect(ask.targetPersonId).toBe(inviteePersonId);
  });

  it("stops granting ask rights once an accepted invitee's membership has ENDED (no perpetual floor)", async () => {
    // Sofia invites Eleanor, Eleanor accepts (becomes a member), then leaves the family. The accepted
    // invitation must NOT keep Eleanor askable — divorce/leave semantics revoke it, same as a plain
    // co-member. Only PENDING invitations extend the floor.
    const inviter = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", inviter.id);
    await addMembership(db, inviter.id, fam.id);
    const { token } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: inviter.id,
      inviteeName: "Eleanor",
    });
    const eleanor = await makePerson(db, "Eleanor Boudreaux");
    await acceptInvitation(db, { token, acceptedPersonId: eleanor.id });
    // Eleanor is now an active member — askable via co-membership. End her membership.
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, eleanor.id),
          eq(memberships.familyId, fam.id),
        ),
      );
    await endMembership(db, m!.id);

    await expect(
      createAsk(
        db,
        { kind: "account", personId: inviter.id },
        { targetPersonId: eleanor.id, questionText: "Q" },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects asking an invitee of a family the asker is NOT a member of", async () => {
    // Inviter runs their own family and invites someone into it.
    const inviter = await makePerson(db, "Inviter");
    const fam = await makeFamily(db, "TheirFamily", inviter.id);
    await addMembership(db, inviter.id, fam.id);
    const { inviteePersonId } = await createInvitation(db, {
      familyId: fam.id,
      inviterPersonId: inviter.id,
      inviteeName: "Their Invitee",
    });
    // An outsider with no membership in that family cannot ask the invitee.
    const outsider = await makePerson(db, "Outsider");
    await expect(
      createAsk(
        db,
        { kind: "account", personId: outsider.id },
        { targetPersonId: inviteePersonId, questionText: "Q" },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("listAsksByAsker — family scope filter (Increment 4A)", () => {
  it("with { familyId } returns ONLY asks linked to that family; no-arg returns all", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const famA = await makeFamily(db, "A", narrator.id);
    const famB = await makeFamily(db, "B", narrator.id);
    await addMembership(db, narrator.id, famA.id);
    await addMembership(db, narrator.id, famB.id);
    await addMembership(db, asker.id, famA.id);
    await addMembership(db, asker.id, famB.id);
    const ctx = { kind: "account", personId: asker.id } as const;

    const askA = await createAsk(db, ctx, {
      targetPersonId: narrator.id,
      familyIds: [famA.id],
      questionText: "Q for A",
    });
    const askB = await createAsk(db, ctx, {
      targetPersonId: narrator.id,
      familyIds: [famB.id],
      questionText: "Q for B",
    });

    const scopedA = await listAsksByAsker(db, ctx, { familyId: famA.id });
    expect(scopedA.map((m) => m.ask.id)).toEqual([askA.id]);

    const scopedB = await listAsksByAsker(db, ctx, { familyId: famB.id });
    expect(scopedB.map((m) => m.ask.id)).toEqual([askB.id]);

    const all = await listAsksByAsker(db, ctx);
    expect(new Set(all.map((m) => m.ask.id))).toEqual(new Set([askA.id, askB.id]));
  });

  it("returns an ask linked to MULTIPLE families exactly once per family scope (distinct by ask id)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const asker = await makePerson(db, "Sofia");
    const famA = await makeFamily(db, "A", narrator.id);
    const famB = await makeFamily(db, "B", narrator.id);
    await addMembership(db, narrator.id, famA.id);
    await addMembership(db, narrator.id, famB.id);
    await addMembership(db, asker.id, famA.id);
    await addMembership(db, asker.id, famB.id);
    const ctx = { kind: "account", personId: asker.id } as const;

    const ask = await createAsk(db, ctx, {
      targetPersonId: narrator.id,
      familyIds: [famA.id, famB.id],
      questionText: "Q for both",
    });

    // The ask carries two ask_families rows; scoping to either family must return it exactly once.
    expect((await listAsksByAsker(db, ctx, { familyId: famA.id })).map((m) => m.ask.id)).toEqual([
      ask.id,
    ]);
    expect((await listAsksByAsker(db, ctx, { familyId: famB.id })).map((m) => m.ask.id)).toEqual([
      ask.id,
    ]);
    // And in the unscoped list it appears once (not once per family row).
    expect((await listAsksByAsker(db, ctx)).map((m) => m.ask.id)).toEqual([ask.id]);
  });
});

describe("listPendingAsksForNarrator", () => {
  it("returns queued/routed asks in arrival order, with asker's spoken name", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const a = await makePerson(db, "Sofia");
    const b = await makePerson(db, "Marco");
    const fam = await makeFamily(db, "B", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, a.id, fam.id);
    await addMembership(db, b.id, fam.id);

    const askA = await createAsk(
      db,
      { kind: "account", personId: a.id },
      { targetPersonId: narrator.id, questionText: "Q-A" },
    );
    // tiny delay so createdAt ordering is deterministic
    await new Promise((r) => setTimeout(r, 5));
    const askB = await createAsk(
      db,
      { kind: "account", personId: b.id },
      { targetPersonId: narrator.id, questionText: "Q-B" },
    );

    const pending = await listPendingAsksForNarrator(db, narrator.id);
    expect(pending.map((p) => p.ask.id)).toEqual([askA.id, askB.id]);
    expect(pending.map((p) => p.askerSpokenName)).toEqual(["Sofia", "Marco"]);
  });
});
