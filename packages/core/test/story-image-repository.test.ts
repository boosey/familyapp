/**
 * Story accompaniment (ADR-0009 Phase 2) — the guarded write + read seam for `story_images`. These
 * tests pin the presentation-layer rules: the FIRST attached photo is the cover; a photo attaches to
 * a story at most once; detaching the cover promotes the lowest-position survivor; exactly one cover
 * survives `setStoryCover`; `reorderStoryImages` rewrites positions and validates the id set; and the
 * reads (list / cover / batched covers) treat a soft-deleted photo as absent (delete-cascades-unattach).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos, storyImages } from "@chronicle/db/content";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  attachPhotoToStory,
  createAlbumPhoto,
  detachStoryImage,
  getStoryCoverPhotoId,
  listStoryImages,
  loadStoryCovers,
  loadStoryGalleryPhotoIds,
  reorderStoryImages,
  setStoryCover,
} from "../src/index";
import {
  addMembership,
  endMembership,
  makeFamily,
  makePerson,
  makeStory,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A contributor with a family + active membership, ready to contribute photos. */
async function world() {
  const contributor = await makePerson(db, "Rosa");
  const fam = await makeFamily(db, "Esposito", contributor.id);
  await addMembership(db, contributor.id, fam.id, "active");
  const { story } = await makeStory(db, {
    ownerPersonId: contributor.id,
    state: "draft",
  });
  return { contributor, fam, story };
}

async function makePhoto(contributorId: string, familyId: string, key: string) {
  return createAlbumPhoto(db, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: key,
  });
}

/** Soft-delete a photo the way the delete path does: set deleted_at. */
async function softDelete(photoId: string): Promise<void> {
  await db
    .update(familyPhotos)
    .set({ deletedAt: new Date() })
    .where(eq(familyPhotos.id, photoId));
}

describe("attachPhotoToStory", () => {
  it("makes the FIRST attached photo the cover at position 0; the second is not the cover", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/p1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/p2");

    const first = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    expect(first.isCover).toBe(true);
    expect(first.position).toBe(0);
    expect(first.provenance).toBe("family_photo");

    const second = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });
    expect(second.isCover).toBe(false);
    expect(second.position).toBe(1);
  });

  it("rejects a duplicate attach (same story + same photo) via the unique index", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/dup");
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    await expect(
      attachPhotoToStory(db, {
        storyId: story.id,
        familyPhotoId: p1.id,
        attachedByPersonId: contributor.id,
      }),
    ).rejects.toThrow();
  });

  it("rejects attaching a soft-deleted (or absent) photo", async () => {
    const { contributor, fam, story } = await world();
    const gone = await makePhoto(contributor.id, fam.id, "family-photos/gone");
    await softDelete(gone.id);
    await expect(
      attachPhotoToStory(db, {
        storyId: story.id,
        familyPhotoId: gone.id,
        attachedByPersonId: contributor.id,
      }),
    ).rejects.toThrow();
    await expect(
      attachPhotoToStory(db, {
        storyId: story.id,
        familyPhotoId: "00000000-0000-0000-0000-000000000000",
        attachedByPersonId: contributor.id,
      }),
    ).rejects.toThrow();
  });
});

describe("attachPhotoToStory — album-access gate (ADR-0009 lines 33-34)", () => {
  it("REJECTS an attacher with no album relationship to the photo, writing no row", async () => {
    // The photo lives in Rosa's family album; Rosa is its contributor + member.
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id, "active");
    const photo = await makePhoto(contributor.id, fam.id, "family-photos/gated");

    // An outsider — not the contributor, not a member of any placed-in family — tries to attach the
    // photo to their OWN story. Without the gate the broadened read would then leak the bytes to them.
    const outsider = await makePerson(db, "Outsider");
    const { story } = await makeStory(db, {
      ownerPersonId: outsider.id,
      state: "draft",
    });

    await expect(
      attachPhotoToStory(db, {
        storyId: story.id,
        familyPhotoId: photo.id,
        attachedByPersonId: outsider.id,
      }),
    ).rejects.toThrow();

    // No story_images row was written (the transaction rolled back).
    const rows = await db
      .select({ id: storyImages.id })
      .from(storyImages)
      .where(eq(storyImages.storyId, story.id));
    expect(rows).toEqual([]);
  });

  it("succeeds when the attacher is an ACTIVE member of a placed-in family (not the contributor)", async () => {
    const contributor = await makePerson(db, "Rosa");
    const member = await makePerson(db, "Sal");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id, "active");
    await addMembership(db, member.id, fam.id, "active");
    const photo = await makePhoto(contributor.id, fam.id, "family-photos/member-attach");

    const { story } = await makeStory(db, {
      ownerPersonId: member.id,
      state: "draft",
    });
    const attached = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: member.id,
    });
    expect(attached.familyPhotoId).toBe(photo.id);
  });

  it("succeeds when the attacher is the photo's CONTRIBUTOR even after leaving the family", async () => {
    const contributor = await makePerson(db, "Rosa");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    const membership = await addMembership(db, contributor.id, fam.id, "active");
    const photo = await makePhoto(contributor.id, fam.id, "family-photos/contrib-attach");

    // The contributor leaves the family — they hold no active membership anywhere the photo lives —
    // but a contributor may always attach their own artifact (mirrors decideAlbumPhotoManage).
    await endMembership(db, membership.id);
    const { story } = await makeStory(db, {
      ownerPersonId: contributor.id,
      state: "draft",
    });
    const attached = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: contributor.id,
    });
    expect(attached.familyPhotoId).toBe(photo.id);
  });
});

describe("detachStoryImage", () => {
  it("promotes the lowest-position survivor to cover when the cover is detached", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/d1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/d2");
    const p3 = await makePhoto(contributor.id, fam.id, "family-photos/d3");
    const cover = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p3.id,
      attachedByPersonId: contributor.id,
    });

    await detachStoryImage(db, { storyId: story.id, storyImageId: cover.id });

    const remaining = await listStoryImages(db, story.id);
    expect(remaining.map((r) => r.familyPhotoId)).toEqual([p2.id, p3.id]);
    // The lowest-position survivor (p2) is the new cover — and it is the ONLY cover.
    expect(remaining.filter((r) => r.isCover).map((r) => r.familyPhotoId)).toEqual([p2.id]);
  });

  it("leaves the cover intact when a NON-cover image is detached", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/n1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/n2");
    const cover = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    const other = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });

    await detachStoryImage(db, { storyId: story.id, storyImageId: other.id });

    const remaining = await listStoryImages(db, story.id);
    expect(remaining.map((r) => r.id)).toEqual([cover.id]);
    expect(remaining[0]!.isCover).toBe(true);
  });

  it("is a no-op for an id that isn't attached to the story", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/noop");
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    await detachStoryImage(db, {
      storyId: story.id,
      storyImageId: "00000000-0000-0000-0000-000000000000",
    });
    expect((await listStoryImages(db, story.id)).length).toBe(1);
  });
});

describe("setStoryCover", () => {
  it("moves the cover, leaving EXACTLY one cover", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/c1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/c2");
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    const second = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });

    await setStoryCover(db, { storyId: story.id, storyImageId: second.id });

    const rows = await listStoryImages(db, story.id);
    const covers = rows.filter((r) => r.isCover);
    expect(covers.map((r) => r.familyPhotoId)).toEqual([p2.id]);
    // DB-level backstop: never more than one is_cover row for a story.
    const dbCovers = await db
      .select({ id: storyImages.id })
      .from(storyImages)
      .where(and(eq(storyImages.storyId, story.id), eq(storyImages.isCover, true)));
    expect(dbCovers.length).toBe(1);
  });

  it("is no-op-safe when the target is already the cover", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/same");
    const only = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    await setStoryCover(db, { storyId: story.id, storyImageId: only.id });
    expect((await listStoryImages(db, story.id))[0]!.isCover).toBe(true);
  });

  it("throws when the target is not attached to the story", async () => {
    const { story } = await world();
    await expect(
      setStoryCover(db, {
        storyId: story.id,
        storyImageId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow();
  });
});

describe("reorderStoryImages", () => {
  it("rewrites positions to the requested order", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/r1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/r2");
    const p3 = await makePhoto(contributor.id, fam.id, "family-photos/r3");
    const a = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    const b = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });
    const c = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p3.id,
      attachedByPersonId: contributor.id,
    });

    // Reverse the order.
    await reorderStoryImages(db, {
      storyId: story.id,
      orderedStoryImageIds: [c.id, b.id, a.id],
    });

    const rows = await listStoryImages(db, story.id);
    expect(rows.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    // Cover is order-independent: p1 was the first attach → still the cover after reorder.
    expect(rows.filter((r) => r.isCover).map((r) => r.familyPhotoId)).toEqual([p1.id]);
  });

  it("rejects an id set that doesn't exactly match the story's current images", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/v1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/v2");
    const a = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    const b = await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });

    // Missing one id.
    await expect(
      reorderStoryImages(db, { storyId: story.id, orderedStoryImageIds: [a.id] }),
    ).rejects.toThrow();
    // Extra/unknown id.
    await expect(
      reorderStoryImages(db, {
        storyId: story.id,
        orderedStoryImageIds: [a.id, b.id, "00000000-0000-0000-0000-000000000000"],
      }),
    ).rejects.toThrow();
    // Duplicate id.
    await expect(
      reorderStoryImages(db, {
        storyId: story.id,
        orderedStoryImageIds: [a.id, a.id],
      }),
    ).rejects.toThrow();
  });
});

describe("reads exclude soft-deleted photos", () => {
  it("listStoryImages / getStoryCoverPhotoId / loadStoryCovers all drop a soft-deleted photo", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/keep");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/del");
    // p1 is the cover (first attach); p2 is second.
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p1.id,
      attachedByPersonId: contributor.id,
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: p2.id,
      attachedByPersonId: contributor.id,
    });

    // Baseline.
    expect((await listStoryImages(db, story.id)).map((r) => r.familyPhotoId)).toEqual([
      p1.id,
      p2.id,
    ]);
    expect(await getStoryCoverPhotoId(db, story.id)).toBe(p1.id);
    expect((await loadStoryCovers(db, [story.id])).get(story.id)).toBe(p1.id);

    // Soft-delete the COVER photo → it vanishes; the next image becomes the effective cover.
    await softDelete(p1.id);
    expect((await listStoryImages(db, story.id)).map((r) => r.familyPhotoId)).toEqual([p2.id]);
    expect(await getStoryCoverPhotoId(db, story.id)).toBe(p2.id);
    expect((await loadStoryCovers(db, [story.id])).get(story.id)).toBe(p2.id);

    // Soft-delete the remaining photo too → the story now has no renderable image.
    await softDelete(p2.id);
    expect(await listStoryImages(db, story.id)).toEqual([]);
    expect(await getStoryCoverPhotoId(db, story.id)).toBeNull();
    expect((await loadStoryCovers(db, [story.id])).has(story.id)).toBe(false);
  });

  it("loadStoryGalleryPhotoIds drops a soft-deleted photo from the per-story list", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/g-keep");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/g-del");
    await attachPhotoToStory(db, { storyId: story.id, familyPhotoId: p1.id, attachedByPersonId: contributor.id });
    await attachPhotoToStory(db, { storyId: story.id, familyPhotoId: p2.id, attachedByPersonId: contributor.id });

    // All renderable photos, cover first.
    expect((await loadStoryGalleryPhotoIds(db, [story.id])).get(story.id)).toEqual([p1.id, p2.id]);

    // Soft-delete the cover → it drops out; the survivor remains.
    await softDelete(p1.id);
    expect((await loadStoryGalleryPhotoIds(db, [story.id])).get(story.id)).toEqual([p2.id]);

    // Soft-delete the rest → the story has no entry at all.
    await softDelete(p2.id);
    expect((await loadStoryGalleryPhotoIds(db, [story.id])).has(story.id)).toBe(false);
  });

  it("loadStoryGalleryPhotoIds lists the cover FIRST even when it isn't the lowest position", async () => {
    const { contributor, fam, story } = await world();
    const p1 = await makePhoto(contributor.id, fam.id, "family-photos/g-order-1");
    const p2 = await makePhoto(contributor.id, fam.id, "family-photos/g-order-2");
    const p3 = await makePhoto(contributor.id, fam.id, "family-photos/g-order-3");
    await attachPhotoToStory(db, { storyId: story.id, familyPhotoId: p1.id, attachedByPersonId: contributor.id });
    const second = await attachPhotoToStory(db, { storyId: story.id, familyPhotoId: p2.id, attachedByPersonId: contributor.id });
    await attachPhotoToStory(db, { storyId: story.id, familyPhotoId: p3.id, attachedByPersonId: contributor.id });

    // Promote the middle photo (position 1) to cover.
    await setStoryCover(db, { storyId: story.id, storyImageId: second.id });

    // Cover (p2) leads; the rest follow in position order (p1, p3).
    expect((await loadStoryGalleryPhotoIds(db, [story.id])).get(story.id)).toEqual([p2.id, p1.id, p3.id]);
  });

  it("listStoryImages surfaces the family photo's caption as alt text", async () => {
    const { contributor, fam, story } = await world();
    const photo = await createAlbumPhoto(db, {
      contributorPersonId: contributor.id,
      familyIds: [fam.id],
      source: "upload",
      storageKey: "family-photos/captioned",
      caption: "Wedding, 1961",
    });
    await attachPhotoToStory(db, {
      storyId: story.id,
      familyPhotoId: photo.id,
      attachedByPersonId: contributor.id,
    });
    expect((await listStoryImages(db, story.id))[0]!.caption).toBe("Wedding, 1961");
  });
});
