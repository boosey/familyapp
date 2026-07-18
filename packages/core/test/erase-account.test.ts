import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "@chronicle/db";
import {
  familyPhotoFamilies,
  familyPhotos,
  media,
  photoPlaces,
  places,
  stories,
  storyRecordings,
} from "@chronicle/db/content";
import { kinshipAssertions } from "@chronicle/db/kinship";
import {
  accountContacts,
  accountIdentities,
  accounts,
  askFamilies,
  asks,
  consentRecords,
  families,
  googlePhotosConnections,
  memberships,
  persons,
  storyFamilies,
  voiceCaptions,
} from "@chronicle/db/schema";
import { eraseAccount } from "../src/erasure-repository";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A person WITH an account attached (the real account-erasure scenario). */
async function makeAccountPerson(name = "Eleanor") {
  const [acct] = await db
    .insert(accounts)
    .values({ authProviderUserId: `auth|${crypto.randomUUID()}`, email: `${name}@x.test` })
    .returning();
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name, accountId: acct!.id })
    .returning();
  return { person: p!, account: acct! };
}

/** A bare account-less person (a tree node / mention). */
async function makePerson(name = "Someone") {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!;
}

/** A family stewarded+created by `stewardPersonId`, with the steward as an active member. */
async function makeFamily(stewardPersonId: string, name = "Test") {
  const [f] = await db
    .insert(families)
    .values({ name, stewardPersonId, creatorPersonId: stewardPersonId })
    .returning();
  await db
    .insert(memberships)
    .values({ personId: stewardPersonId, familyId: f!.id, role: "steward", status: "active" });
  return f!;
}

/** A consented, family-shared voice story: recording media + consent (with approval audio) + share. */
async function makeSharedStory(ownerPersonId: string, familyId: string) {
  const [rec] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "story_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const [approval] = await db
    .insert(media)
    .values({
      ownerPersonId,
      kind: "approval_audio",
      storageKey: `s3://b/${crypto.randomUUID()}.wav`,
      contentType: "audio/wav",
      checksum: crypto.randomUUID(),
    })
    .returning();
  const story = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(stories)
      .values({ ownerPersonId, recordingMediaId: rec!.id, state: "shared", audienceTier: "family" })
      .returning();
    await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
    return s!;
  });
  await db.insert(storyFamilies).values({ storyId: story.id, familyId });
  await db.insert(consentRecords).values({
    personId: ownerPersonId,
    actorPersonId: ownerPersonId,
    storyId: story.id,
    action: "approved_for_sharing",
    resultingState: "shared",
    approvalAudioMediaId: approval!.id,
  });
  return { story, recStorageKey: rec!.storageKey, recMediaId: rec!.id };
}

describe("eraseAccount — deleted outcome (solely-owned family, own shared story)", () => {
  it("hard-deletes the person, account, family, story, media, consent when nothing else references them", async () => {
    const { person, account } = await makeAccountPerson();
    const family = await makeFamily(person.id);
    const { story, recStorageKey, recMediaId } = await makeSharedStory(person.id, family.id);

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    expect(result.storageKeys).toContain(recStorageKey);

    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(0);
    expect(await db.select().from(accounts).where(eq(accounts.id, account.id))).toHaveLength(0);
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, recMediaId))).toHaveLength(0);
    expect(
      await db.select().from(consentRecords).where(eq(consentRecords.storyId, story.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(memberships).where(eq(memberships.personId, person.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — demoted outcome (person embedded in the tree via a kinship edge)", () => {
  it("keeps the person as an account-less node, leaves the kinship edge intact, deletes the account + private content", async () => {
    const { person, account } = await makeAccountPerson("Rosa");
    const relative = await makePerson("Salvatore");
    // A kinship edge referencing the erased person as an endpoint (family context needed for the FK).
    const family = await makeFamily(person.id);
    await db.insert(kinshipAssertions).values({
      familyId: family.id,
      edgeType: "parent_of",
      personAId: relative.id,
      personBId: person.id,
      nature: "biological",
      actorPersonId: person.id,
    });
    // Some of the erased person's own private content that MUST still be torn down.
    const [rec] = await db
      .insert(media)
      .values({
        ownerPersonId: person.id,
        kind: "story_audio",
        storageKey: `s3://b/${crypto.randomUUID()}.wav`,
        contentType: "audio/wav",
        checksum: crypto.randomUUID(),
      })
      .returning();
    const draft = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(stories)
        .values({ ownerPersonId: person.id, recordingMediaId: rec!.id, state: "draft" })
        .returning();
      await tx.insert(storyRecordings).values({ storyId: s!.id, position: 0, mediaId: rec!.id });
      return s!;
    });

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("demoted");

    // The person row SURVIVES, demoted to an account-less tree node.
    const [survivor] = await db.select().from(persons).where(eq(persons.id, person.id));
    expect(survivor).toBeDefined();
    expect(survivor!.accountId).toBeNull();

    // Account gone; kinship edge intact (append-only, no erasure carve-out).
    expect(await db.select().from(accounts).where(eq(accounts.id, account.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(kinshipAssertions)
        .where(eq(kinshipAssertions.personBId, person.id)),
    ).toHaveLength(1);

    // Their private content + memberships are gone.
    expect(await db.select().from(stories).where(eq(stories.id, draft.id))).toHaveLength(0);
    expect(await db.select().from(media).where(eq(media.id, rec!.id))).toHaveLength(0);
    expect(
      await db.select().from(memberships).where(eq(memberships.personId, person.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — blocker: stewarded family has other active members", () => {
  it("refuses and changes nothing", async () => {
    const { person, account } = await makeAccountPerson("Steward");
    const family = await makeFamily(person.id);
    const other = await makePerson("OtherMember");
    await db
      .insert(memberships)
      .values({ personId: other.id, familyId: family.id, role: "member", status: "active" });

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((b) => b.includes(family.id))).toBe(true);

    // Nothing changed.
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(1);
    expect(await db.select().from(accounts).where(eq(accounts.id, account.id))).toHaveLength(1);
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(1);
  });
});

describe("eraseAccount — blocker: story shared to a family with other members", () => {
  it("refuses and changes nothing", async () => {
    // The erased person owns a story shared into a family they do NOT solely occupy.
    const { person } = await makeAccountPerson("Author");
    // Family stewarded by someone else, with another active member besides the author.
    const steward = await makePerson("Steward");
    const family = await makeFamily(steward.id);
    await db
      .insert(memberships)
      .values({ personId: person.id, familyId: family.id, role: "member", status: "active" });
    const { story } = await makeSharedStory(person.id, family.id);

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((b) => b.includes(story.id))).toBe(true);

    // Nothing changed — the story and its owner still stand.
    expect(await db.select().from(stories).where(eq(stories.id, story.id))).toHaveLength(1);
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(1);
  });
});

describe("eraseAccount — severs account_identities + account_contacts (PR #99 identity model)", () => {
  it("clears the account's identity + contact rows so the accounts DELETE does not FK-fail", async () => {
    const { person, account } = await makeAccountPerson("Vera");
    // The provider-agnostic identity children that FK accounts.id (NOT NULL) — both must be torn
    // down before the accounts row or the delete FK-fails. This is the gap a stale-base build missed.
    const [ident] = await db
      .insert(accountIdentities)
      .values({
        accountId: account.id,
        provider: "clerk",
        providerUserId: `user_${crypto.randomUUID()}`,
      })
      .returning();
    const [contact] = await db
      .insert(accountContacts)
      .values({ accountId: account.id, kind: "email", value: `vera-${crypto.randomUUID()}@x.test` })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");

    // Account and BOTH identity/contact children are gone.
    expect(await db.select().from(accounts).where(eq(accounts.id, account.id))).toHaveLength(0);
    expect(
      await db.select().from(accountIdentities).where(eq(accountIdentities.id, ident!.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(accountContacts).where(eq(accountContacts.id, contact!.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — tears down the Google Photos connection (OAuth secret + hard-delete)", () => {
  it("deletes the google_photos_connections row so the person hard-deletes and no OAuth token survives", async () => {
    const { person } = await makeAccountPerson("Photog");
    // A live connect-once OAuth vault row (encrypted refresh token). It is 1:1 with the person (PK)
    // and is BOTH a retained reference (would force demote) AND a live secret if left behind.
    await db
      .insert(googlePhotosConnections)
      .values({ personId: person.id, encryptedRefreshToken: "ciphertext-should-not-survive" });

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // With the connection torn down, nothing references the person → hard-delete, not demote.
    expect(result.outcome).toBe("deleted");
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(googlePhotosConnections)
        .where(eq(googlePhotosConnections.personId, person.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — blocker: an owned ask is addressed to a family with other members", () => {
  it("refuses and changes nothing", async () => {
    const { person } = await makeAccountPerson("Asker");
    const other = await makePerson("Listener");
    const family = await makeFamily(other.id); // `other` is an active member of this family
    const [ask] = await db
      .insert(asks)
      .values({ askerPersonId: person.id, targetPersonId: other.id, questionText: "Tell me about X?" })
      .returning();
    await db.insert(askFamilies).values({ askId: ask!.id, familyId: family.id });

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((b) => b.includes(ask!.id))).toBe(true);
    // Nothing changed — the ask and its asker still stand.
    expect(await db.select().from(asks).where(eq(asks.id, ask!.id))).toHaveLength(1);
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(1);
  });
});

describe("eraseAccount — blocker: an owned voice caption is on a photo shared to a family with others", () => {
  it("refuses and changes nothing", async () => {
    const { person } = await makeAccountPerson("Captioner");
    const other = await makePerson("Viewer");
    const family = await makeFamily(other.id);
    const [photo] = await db
      .insert(familyPhotos)
      .values({
        contributorPersonId: other.id,
        source: "upload",
        storageKey: `family-photos/${crypto.randomUUID()}`,
      })
      .returning();
    await db.insert(familyPhotoFamilies).values({ photoId: photo!.id, familyId: family.id });
    const [capMedia] = await db
      .insert(media)
      .values({
        ownerPersonId: person.id,
        kind: "caption_audio",
        storageKey: `s3://b/${crypto.randomUUID()}.wav`,
        contentType: "audio/wav",
        checksum: crypto.randomUUID(),
      })
      .returning();
    const [cap] = await db
      .insert(voiceCaptions)
      .values({ photoId: photo!.id, mediaId: capMedia!.id, ownerPersonId: person.id })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.some((b) => b.includes(cap!.id))).toBe(true);
    expect(await db.select().from(voiceCaptions).where(eq(voiceCaptions.id, cap!.id))).toHaveLength(1);
    expect(await db.select().from(persons).where(eq(persons.id, person.id))).toHaveLength(1);
  });
});

describe("eraseAccount — sole-family teardown: places + photo_places (FK, no cascade)", () => {
  it("deletes the family's places (and their photo_places tags) so DELETE families succeeds", async () => {
    const { person } = await makeAccountPerson("Cartographer");
    const family = await makeFamily(person.id);
    // A photo contributed by ANOTHER retained person (so it never forces the erasing person to
    // demote), placed into the doomed family and place-tagged. The place lives in the doomed family.
    const contributor = await makePerson("Contributor");
    const [photo] = await db
      .insert(familyPhotos)
      .values({
        contributorPersonId: contributor.id,
        source: "upload",
        storageKey: `family-photos/${crypto.randomUUID()}`,
      })
      .returning();
    await db.insert(familyPhotoFamilies).values({ photoId: photo!.id, familyId: family.id });
    const [place] = await db
      .insert(places)
      .values({ familyId: family.id, name: "Cherry Street", createdByPersonId: contributor.id })
      .returning();
    const [pp] = await db
      .insert(photoPlaces)
      .values({ photoId: photo!.id, placeId: place!.id, taggedByPersonId: contributor.id })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    // Family + place + photo_places tag are all gone (no FK violation on DELETE families).
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    expect(await db.select().from(places).where(eq(places.id, place!.id))).toHaveLength(0);
    expect(await db.select().from(photoPlaces).where(eq(photoPlaces.id, pp!.id))).toHaveLength(0);
  });
});

describe("eraseAccount — sole-family teardown: family_photo_families placement (FK, no cascade)", () => {
  it("deletes the family↔photo link so DELETE families succeeds", async () => {
    const { person } = await makeAccountPerson("Placer");
    const family = await makeFamily(person.id);
    // Photo contributed by ANOTHER retained person so the erasing person hard-deletes; the placement
    // link into the doomed family is the FK under test.
    const contributor = await makePerson("Contributor");
    const [photo] = await db
      .insert(familyPhotos)
      .values({
        contributorPersonId: contributor.id,
        source: "upload",
        storageKey: `family-photos/${crypto.randomUUID()}`,
      })
      .returning();
    await db.insert(familyPhotoFamilies).values({ photoId: photo!.id, familyId: family.id });

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(familyPhotoFamilies)
        .where(eq(familyPhotoFamilies.familyId, family.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — sole-family teardown: another person's story originating_family_id", () => {
  it("NULLs originating_family_id on a SURVIVING foreign story (never deletes it) and succeeds", async () => {
    const { person } = await makeAccountPerson("Founder");
    const family = await makeFamily(person.id);
    // ANOTHER person's PRIVATE story whose capture context (originating_family_id) is the doomed
    // family, but which is NOT shared to it (so it survives and must not be deleted).
    const other = await makePerson("Chronicler");
    const [foreignStory] = await db
      .insert(stories)
      .values({
        ownerPersonId: other.id,
        kind: "text",
        state: "draft",
        audienceTier: "private",
        originatingFamilyId: family.id,
      })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    // The doomed family is gone.
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    // The foreign story SURVIVES, with originating_family_id nulled out.
    const [survivor] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, foreignStory!.id));
    expect(survivor).toBeDefined();
    expect(survivor!.originatingFamilyId).toBeNull();
  });
});

describe("eraseAccount — sole-family teardown: another person's story shared via story_families", () => {
  it("detaches a foreign SURVIVING story from the doomed family (deletes its story_families row) and succeeds", async () => {
    const { person } = await makeAccountPerson("Host");
    const family = await makeFamily(person.id);
    // ANOTHER retained person owns a story that is SHARED INTO the doomed family (story_families).
    // The owner is NOT an active member of the family (sharing ≠ membership), so blocker #1 does not
    // fire; blocker #2 only inspects the ERASING person's own stories, so it does not fire either.
    const other = await makePerson("Guest");
    const [foreignStory] = await db
      .insert(stories)
      .values({ ownerPersonId: other.id, kind: "text", state: "shared", audienceTier: "family" })
      .returning();
    const [sf] = await db
      .insert(storyFamilies)
      .values({ storyId: foreignStory!.id, familyId: family.id })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    // The doomed family is gone (no story_families FK violation).
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    // The foreign story SURVIVES, detached from the doomed family (its story_families row is gone).
    expect(await db.select().from(stories).where(eq(stories.id, foreignStory!.id))).toHaveLength(1);
    expect(
      await db.select().from(storyFamilies).where(eq(storyFamilies.id, sf!.id)),
    ).toHaveLength(0);
  });
});

describe("eraseAccount — sole-family teardown: another person's non-active membership", () => {
  it("deletes a paused OTHER member's membership with the family, leaving that person untouched", async () => {
    const { person } = await makeAccountPerson("Steward");
    const family = await makeFamily(person.id);
    // Another person whose membership in the doomed family is PAUSED (so it is NOT a blocker), but
    // whose NOT-NULL membership row would still FK-block DELETE families if left behind.
    const other = await makePerson("PausedMember");
    const [pausedMembership] = await db
      .insert(memberships)
      .values({ personId: other.id, familyId: family.id, role: "member", status: "paused" })
      .returning();

    const result = await eraseAccount(db, { personId: person.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("deleted");
    // Family gone, the paused membership gone with it...
    expect(await db.select().from(families).where(eq(families.id, family.id))).toHaveLength(0);
    expect(
      await db.select().from(memberships).where(eq(memberships.id, pausedMembership!.id)),
    ).toHaveLength(0);
    // ...but the OTHER person themselves is untouched.
    expect(await db.select().from(persons).where(eq(persons.id, other.id))).toHaveLength(1);
  });
});

describe("eraseAccount — not found", () => {
  it("returns a not-found blocker and changes nothing", async () => {
    const bogus = crypto.randomUUID();
    const result = await eraseAccount(db, { personId: bogus });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toEqual([`person ${bogus} not found`]);
  });
});

describe("eraseAccount — append-only consent ledger is satisfied via the cascade token", () => {
  it("succeeds erasing a consented story's consent ledger (proving the token gate was set)", async () => {
    const { person } = await makeAccountPerson("Nonna");
    const family = await makeFamily(person.id);
    const { story } = await makeSharedStory(person.id, family.id);
    // Precondition: the consent row exists and (without the token) is undeletable.
    await expect(
      db.delete(consentRecords).where(eq(consentRecords.storyId, story.id)),
    ).rejects.toThrow(/append-only\/immutable/);

    const result = await eraseAccount(db, { personId: person.id });
    expect(result.ok).toBe(true);
    // The consent ledger for the erased story is gone (only possible inside the token'd cascade).
    expect(
      await db.select().from(consentRecords).where(eq(consentRecords.storyId, story.id)),
    ).toHaveLength(0);
  });
});
