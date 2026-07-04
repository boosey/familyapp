/**
 * Story-from-a-photo (ADR-0009 Phase 3 "subject"). A story can be ABOUT an album photo: at creation
 * the story is stamped with `subject_photo_id` AND — in the SAME transaction — that photo is inserted
 * as the story's FIRST `story_images` cover row (position 0). The consolidated album-access gate is
 * the single choke point: a story-from-a-photo the owner cannot SEE is rejected with NO story written.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { stories, storyImages } from "@chronicle/db/content";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAlbumPhoto,
  createTextDraft,
  listStoryImages,
  persistRecordingAndCreateDraft,
} from "../src/index";
import { addMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** An owner with a family + active membership, plus one album photo they contributed to it. */
async function ownerWithPhoto() {
  const owner = await makePerson(db, "Rosa");
  const fam = await makeFamily(db, "Esposito", owner.id);
  await addMembership(db, owner.id, fam.id, "active");
  const photo = await createAlbumPhoto(db, {
    contributorPersonId: owner.id,
    familyIds: [fam.id],
    source: "upload",
    storageKey: `family-photos/${Math.random()}`,
  });
  return { owner, fam, photo };
}

describe("createTextDraft with a subject photo", () => {
  it("stamps subject_photo_id AND inserts the photo as the first cover image (atomic)", async () => {
    const { owner, photo } = await ownerWithPhoto();
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "The summer we drove to the coast.",
      subjectPhotoId: photo.id,
    });

    // The story row carries the thin "about" pointer.
    expect(story.subjectPhotoId).toBe(photo.id);

    // And the same photo is the story's FIRST cover image (position 0), rendered by listStoryImages.
    const images = await listStoryImages(db, story.id);
    expect(images).toHaveLength(1);
    expect(images[0]!.familyPhotoId).toBe(photo.id);
    expect(images[0]!.isCover).toBe(true);
    expect(images[0]!.position).toBe(0);
    expect(images[0]!.provenance).toBe("family_photo");
  });

  it("leaves subject_photo_id null and creates no cover when omitted", async () => {
    const owner = await makePerson(db, "Nobody");
    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "A story about nothing in particular.",
    });
    expect(story.subjectPhotoId).toBeNull();
    expect(await listStoryImages(db, story.id)).toHaveLength(0);
  });

  it("REJECTS a story-from-a-photo the owner cannot see — with NO story written", async () => {
    // A photo contributed by a stranger to a family the owner is NOT in.
    const stranger = await makePerson(db, "Stranger");
    const otherFam = await makeFamily(db, "Carney", stranger.id);
    await addMembership(db, stranger.id, otherFam.id, "active");
    const unseeable = await createAlbumPhoto(db, {
      contributorPersonId: stranger.id,
      familyIds: [otherFam.id],
      source: "upload",
      storageKey: "family-photos/secret",
    });

    const owner = await makePerson(db, "Rosa");
    const fam = await makeFamily(db, "Esposito", owner.id);
    await addMembership(db, owner.id, fam.id, "active");

    await expect(
      createTextDraft(db, {
        ownerPersonId: owner.id,
        text: "I should not be able to reference this photo.",
        subjectPhotoId: unseeable.id,
      }),
    ).rejects.toThrow();

    // The whole tx rolled back — no story exists for the would-be owner.
    const rows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.ownerPersonId, owner.id));
    expect(rows).toHaveLength(0);
  });

  it("ALLOWS a photo the owner can see via active membership (non-contributor)", async () => {
    // Contributor and owner are co-members of one family; the owner is not the contributor.
    const contributor = await makePerson(db, "Aunt");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id, "active");
    const owner = await makePerson(db, "Niece");
    await addMembership(db, owner.id, fam.id, "active");
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/shared",
    });

    const { story } = await createTextDraft(db, {
      ownerPersonId: owner.id,
      text: "Aunt's photo, my story.",
      subjectPhotoId: photo.id,
    });
    expect(story.subjectPhotoId).toBe(photo.id);
    const images = await listStoryImages(db, story.id);
    expect(images.map((i) => i.familyPhotoId)).toEqual([photo.id]);
  });
});

describe("persistRecordingAndCreateDraft with a subject photo", () => {
  it("stamps subject_photo_id AND inserts the photo as the first cover image", async () => {
    const { owner, photo } = await ownerWithPhoto();
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: owner.id,
        storageKey: `story-audio/${Math.random()}.webm`,
        contentType: "audio/webm",
        durationSeconds: 42,
        checksum: "sha256:abc",
      },
      { subjectPhotoId: photo.id },
    );

    expect(story.subjectPhotoId).toBe(photo.id);
    const images = await listStoryImages(db, story.id);
    expect(images).toHaveLength(1);
    expect(images[0]!.familyPhotoId).toBe(photo.id);
    expect(images[0]!.isCover).toBe(true);
    expect(images[0]!.position).toBe(0);
  });

  it("REJECTS an unseeable subject photo — no story and no take rows written", async () => {
    const stranger = await makePerson(db, "Stranger");
    const otherFam = await makeFamily(db, "Carney", stranger.id);
    await addMembership(db, stranger.id, otherFam.id, "active");
    const unseeable = await createAlbumPhoto(db, {
      contributorPersonId: stranger.id,
      familyIds: [otherFam.id],
      source: "upload",
      storageKey: "family-photos/secret2",
    });
    const owner = await makePerson(db, "Rosa");

    await expect(
      persistRecordingAndCreateDraft(
        db,
        {
          ownerPersonId: owner.id,
          storageKey: `story-audio/${Math.random()}.webm`,
          contentType: "audio/webm",
          checksum: "sha256:def",
        },
        { subjectPhotoId: unseeable.id },
      ),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.ownerPersonId, owner.id));
    expect(rows).toHaveLength(0);
    // The cover-image insert never landed either (whole tx rolled back).
    const imgs = await db.select({ id: storyImages.id }).from(storyImages);
    expect(imgs).toHaveLength(0);
  });
});
