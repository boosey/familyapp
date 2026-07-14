/**
 * Server-side integration test for the Phase-C bulk soft-delete action (mirrors
 * album-tag-actions.test.ts's harness): `@/lib/runtime` is mocked so importing the module doesn't boot
 * the real DEV runtime; getRuntime() reads settable module-level bindings. `next/cache`'s revalidatePath
 * is a no-op. The REAL core runs against a fresh PGlite db per test.
 *
 * Coverage: a contributor deletes several of their own photos (deleted count, rows gone); a plain
 * member's targets come back as `failed` (partial success, NOT an error) with the photos still visible;
 * an anonymous caller and an empty id set are the only whole-request `{ error }` cases.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: AuthContext;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: undefined,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  createAlbumPhoto,
  getAlbumPhotoForViewer,
  type AuthContext,
} from "@chronicle/core";
import { bulkSoftDeleteAlbumPhotosAction } from "@/app/hub/album/actions";
import { hub } from "@/app/_copy";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function makePerson(name: string): Promise<string> {
  const [p] = await runtimeDb
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

async function makeFamily(name: string, creatorId: string): Promise<string> {
  const [f] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!.id;
}

async function addMember(personId: string, familyId: string): Promise<void> {
  await runtimeDb.insert(memberships).values({ personId, familyId, status: "active" });
}

async function photo(familyId: string, contributorId: string, key: string): Promise<string> {
  const p = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: key,
    caption: null,
  });
  return p.id;
}

function idsForm(...photoIds: string[]): FormData {
  const fd = new FormData();
  for (const id of photoIds) fd.append("photoIds", id);
  return fd;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  authCtx = { kind: "anonymous" };
});

describe("bulkSoftDeleteAlbumPhotosAction", () => {
  it("a contributor deletes several of their own photos", async () => {
    const steward = await makePerson("Nonna");
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", steward);
    await addMember(steward, familyId);
    await addMember(contributor, familyId);
    const p1 = await photo(familyId, contributor, "k/1");
    const p2 = await photo(familyId, contributor, "k/2");
    const p3 = await photo(familyId, contributor, "k/3");

    authCtx = account(contributor);
    const result = await bulkSoftDeleteAlbumPhotosAction(idsForm(p1, p2, p3));
    expect(result).toEqual({ deleted: 3, failed: 0 });

    // All three are gone from the read front door.
    for (const id of [p1, p2, p3]) {
      expect(await getAlbumPhotoForViewer(runtimeDb, account(contributor), id)).toBeNull();
    }
  });

  it("a plain member's targets are `failed`, not deleted (partial success, not an error)", async () => {
    const steward = await makePerson("Nonna");
    const contributor = await makePerson("Rosa");
    const plainMember = await makePerson("Sal");
    const familyId = await makeFamily("Esposito", steward);
    await addMember(steward, familyId);
    await addMember(contributor, familyId);
    await addMember(plainMember, familyId);
    const p1 = await photo(familyId, contributor, "k/a");
    const p2 = await photo(familyId, contributor, "k/b");

    authCtx = account(plainMember); // can SEE but not MANAGE (not contributor, not steward)
    const result = await bulkSoftDeleteAlbumPhotosAction(idsForm(p1, p2));
    expect(result).toEqual({ deleted: 0, failed: 2 });

    // Photos untouched — still visible to a member.
    expect(await getAlbumPhotoForViewer(runtimeDb, account(contributor), p1)).not.toBeNull();
    expect(await getAlbumPhotoForViewer(runtimeDb, account(contributor), p2)).not.toBeNull();
  });

  it("mixes deleted + failed across ids the caller can and cannot manage", async () => {
    const steward = await makePerson("Nonna");
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", steward);
    await addMember(steward, familyId);
    await addMember(contributor, familyId);
    const mine = await photo(familyId, contributor, "k/mine");
    const stewards = await photo(familyId, steward, "k/steward");

    authCtx = account(contributor); // contributor of `mine`, not of `stewards`, not a steward
    const result = await bulkSoftDeleteAlbumPhotosAction(idsForm(mine, stewards));
    expect(result).toEqual({ deleted: 1, failed: 1 });
    expect(await getAlbumPhotoForViewer(runtimeDb, account(steward), mine)).toBeNull();
    expect(await getAlbumPhotoForViewer(runtimeDb, account(steward), stewards)).not.toBeNull();
  });

  it("an anonymous caller gets { error }", async () => {
    authCtx = { kind: "anonymous" };
    const result = await bulkSoftDeleteAlbumPhotosAction(idsForm("some-id"));
    expect(result).toEqual({ error: hub.actions.notSignedIn });
  });

  it("an empty id set gets { error } (no-op request)", async () => {
    const contributor = await makePerson("Rosa");
    authCtx = account(contributor);
    const result = await bulkSoftDeleteAlbumPhotosAction(idsForm());
    expect(result).toEqual({ error: hub.album.noPhotosSelected });
  });
});
