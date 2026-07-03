/**
 * Server-side integration tests for the album surface (ADR-0009 · #15):
 *   - `uploadAlbumPhotoAction` — happy path (bytes land in storage, row + album membership written,
 *     resolves the target family from the CONTRIBUTOR's own active memberships), plus the
 *     not-signed-in and no-family guards.
 *   - the `/api/album-photo/[photoId]` bytes route — ALLOW (200 + bytes) for a family member, DENY
 *     (404, no leak) for a stranger and for anonymous.
 *
 * Harness mirrors compose-story-action.server.test.ts: `@/lib/runtime` is mocked so importing the
 * modules doesn't boot the real DEV runtime; getRuntime() reads settable module-level bindings.
 * `next/cache`'s revalidatePath is a no-op in the test (no Next request scope).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let authCtx: AuthContext;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  listAlbumPhotos,
  createAlbumPhoto,
  getAlbumPhotoForViewer,
  type AuthContext,
} from "@chronicle/core";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { uploadAlbumPhotoAction } from "@/app/hub/album/actions";
import { GET as albumPhotoGet } from "@/app/api/album-photo/[photoId]/route";
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

// A 1x1 PNG's leading magic bytes — enough for the route's content-type sniff.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// A hand-built minimal JPEG carrying an EXIF APP1 segment with DateTimeOriginal "2015:06:15 14:30:00"
// and GPS 37°48'30"N 122°25'09"W (lat +37.808333, lng -122.419167). Verified to round-trip through
// exifr; see apps/web/__tests__/exif.test.ts for the full fixture notes. Used to prove #17 persists
// EXIF end-to-end through the upload action.
const JPEG_WITH_EXIF = new Uint8Array(
  Buffer.from(
    "/9j/4QC6RXhpZgAASUkqAAgAAAACAGmHBAABAAAAJgAAACWIBAABAAAATAAAAAAAAAABAAOQAgAUAAAAOAAAAAAAAAAyMDE1OjA2OjE1IDE0OjMwOjAwAAQAAQACAAIAAABOAAAAAgAFAAMAAACCAAAAAwACAAIAAABXAAAABAAFAAMAAACaAAAAAAAAACUAAAABAAAAMAAAAAEAAAAeAAAAAQAAAHoAAAABAAAAGQAAAAEAAAAJAAAAAQAAAP/Z",
    "base64",
  ),
);

function photoForm(bytes: Uint8Array, type = "image/png"): FormData {
  const fd = new FormData();
  fd.append("photo", new Blob([bytes as BlobPart], { type }), "photo.png");
  return fd;
}

function photoFormWithFamilies(
  bytes: Uint8Array,
  familyIds: string[],
  type = "image/png",
): FormData {
  const fd = photoForm(bytes, type);
  for (const id of familyIds) fd.append("familyIds", id);
  return fd;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = { kind: "anonymous" };
});

describe("uploadAlbumPhotoAction", () => {
  it("stores the bytes, writes the row + album membership, resolves the contributor's family", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadAlbumPhotoAction(photoForm(PNG_BYTES));
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    // The photo is visible in the contributor's family album...
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album.map((p) => p.id)).toEqual([result.photoId]);
    const key = album[0]!.storageKey;
    expect(key.startsWith("family-photos/")).toBe(true);
    expect(album[0]!.source).toBe("upload");
    // ...and its bytes are in storage under that write-once key.
    expect(await runtimeStorage.getBytes(key)).toEqual(PNG_BYTES);
    expect(runtimeStorage.size).toBe(1);
  });

  it("rejects an unauthenticated caller and writes nothing", async () => {
    authCtx = { kind: "anonymous" };
    const result = await uploadAlbumPhotoAction(photoForm(PNG_BYTES));
    expect(result).toEqual({ error: "Not signed in." });
    expect(runtimeStorage.size).toBe(0);
  });

  it("rejects a signed-in caller with no family", async () => {
    const orphan = await makePerson("Orphan");
    authCtx = account(orphan);
    const result = await uploadAlbumPhotoAction(photoForm(PNG_BYTES));
    expect("error" in result).toBe(true);
    expect(runtimeStorage.size).toBe(0);
  });

  it("populates exif capture-date + gps from an uploaded photo that carries EXIF (#17)", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadAlbumPhotoAction(photoForm(JPEG_WITH_EXIF, "image/jpeg"));
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    // exifCapturedAt is surfaced on the grid view; the tz-naive EXIF stamp is stored as a
    // deterministic UTC instant (host-TZ-independent), so pin the absolute ISO value.
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    const captured = album[0]!.exifCapturedAt;
    expect(captured).toBeInstanceOf(Date);
    expect(captured!.toISOString()).toBe("2015-06-15T14:30:00.000Z");

    // exifGps is NOT on the grid view — read it through the audited full-row seam.
    const full = await getAlbumPhotoForViewer(runtimeDb, account(contributor), result.photoId);
    expect(full!.exifGps).not.toBeNull();
    expect(full!.exifGps!.lat).toBeCloseTo(37.808333, 5);
    expect(full!.exifGps!.lng).toBeCloseTo(-122.419167, 5);
  });

  it("leaves exif columns null for a photo with no readable EXIF (#17)", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadAlbumPhotoAction(photoForm(PNG_BYTES));
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album[0]!.exifCapturedAt).toBeNull();
    const full = await getAlbumPhotoForViewer(runtimeDb, account(contributor), result.photoId);
    expect(full!.exifGps).toBeNull();
  });

  it("rejects an empty file", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadAlbumPhotoAction(photoForm(new Uint8Array([])));
    expect("error" in result).toBe(true);
    expect(runtimeStorage.size).toBe(0);
  });

  // #16 — multi-family placement: the target set is the client's picker choice, re-validated on the
  // server against the CONTRIBUTOR's own active memberships. A family they didn't pick can't see it;
  // a family they don't belong to is dropped.
  it("places a photo in BOTH families the contributor selects", async () => {
    const contributor = await makePerson("Rosa");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    authCtx = account(contributor);

    const result = await uploadAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famA, famB]),
    );
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    expect(albumA.map((p) => p.id)).toEqual([result.photoId]);
    expect(albumB.map((p) => p.id)).toEqual([result.photoId]);
    // One upload → one storage object, regardless of how many albums it is placed in.
    expect(runtimeStorage.size).toBe(1);
  });

  it("a family the contributor did NOT select cannot see the photo, even though the contributor belongs to it", async () => {
    const contributor = await makePerson("Rosa");
    const bMember = await makePerson("Sal");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    await addMember(bMember, famB);
    authCtx = account(contributor);

    // Contributor is in A and B but selects ONLY A.
    const result = await uploadAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famA]),
    );
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    // Visible in A...
    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA.map((p) => p.id)).toEqual([result.photoId]);
    // ...but NOT in B, for the contributor or a co-member of B.
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    expect(albumB).toEqual([]);
    const asBMember = await getAlbumPhotoForViewer(
      runtimeDb,
      account(bMember),
      result.photoId,
    );
    expect(asBMember).toBeNull();
  });

  it("drops a spoofed family id the contributor is NOT a member of", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    // Contributor is only in A but tries to also place into X (not theirs).
    const result = await uploadAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famA, famX]),
    );
    if (!("ok" in result)) throw new Error(`expected ok, got ${JSON.stringify(result)}`);

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA.map((p) => p.id)).toEqual([result.photoId]);
    // X's own member does not see the spoofed placement — it was never written.
    const albumX = await listAlbumPhotos(runtimeDb, account(outsider), famX);
    expect(albumX).toEqual([]);
    expect(runtimeStorage.size).toBe(1);
  });

  it("rejects a submission of ONLY foreign family ids (nothing valid to place into)", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    // Multi-family contributor submits only a family they don't belong to.
    const result = await uploadAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famX]),
    );
    expect(result).toEqual({ error: hub.actions.noAlbumChosen });
    expect(runtimeStorage.size).toBe(0);
  });
});

describe("/api/album-photo/[photoId] bytes route", () => {
  async function seedPhoto(): Promise<{
    contributor: string;
    coMember: string;
    stranger: string;
    familyId: string;
    photoId: string;
  }> {
    const contributor = await makePerson("Rosa");
    const coMember = await makePerson("Sal");
    const stranger = await makePerson("Stranger");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    await addMember(coMember, familyId);
    const storageKey = "family-photos/route-test";
    await runtimeStorage.put({ key: storageKey, bytes: PNG_BYTES, contentType: "image/png" });
    const photo = await createAlbumPhoto(runtimeDb, {
      contributorPersonId: contributor,
      familyIds: [familyId],
      source: "upload",
      storageKey,
      caption: null,
    });
    return { contributor, coMember, stranger, familyId, photoId: photo.id };
  }

  function call(photoId: string): Promise<Response> {
    return albumPhotoGet(new Request("http://localhost/api/album-photo/x"), {
      params: Promise.resolve({ photoId }),
    });
  }

  it("streams the bytes (200) to a family member", async () => {
    const { coMember, photoId } = await seedPhoto();
    authCtx = account(coMember);
    const res = await call(photoId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(PNG_BYTES);
  });

  it("returns 404 (no leak) to a stranger", async () => {
    const { stranger, photoId } = await seedPhoto();
    authCtx = account(stranger);
    const res = await call(photoId);
    expect(res.status).toBe(404);
  });

  it("returns 404 to an anonymous request", async () => {
    const { photoId } = await seedPhoto();
    authCtx = { kind: "anonymous" };
    const res = await call(photoId);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-existent photo id", async () => {
    await seedPhoto();
    authCtx = account(await makePerson("Whoever"));
    const res = await call("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});
