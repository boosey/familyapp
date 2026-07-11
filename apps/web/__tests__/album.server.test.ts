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
import {
  uploadAlbumPhotoAction,
  uploadOneAlbumPhotoAction,
  editAlbumCaptionAction,
  deleteAlbumPhotoAction,
} from "@/app/hub/album/actions";
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
    // One file in → one photo added, none failed (batch summary shape).
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    // The photo is visible in the contributor's family album...
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(1);
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
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    // exifCapturedAt is surfaced on the grid view; the tz-naive EXIF stamp is stored as a
    // deterministic UTC instant (host-TZ-independent), so pin the absolute ISO value.
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    const captured = album[0]!.exifCapturedAt;
    expect(captured).toBeInstanceOf(Date);
    expect(captured!.toISOString()).toBe("2015-06-15T14:30:00.000Z");

    // exifGps is NOT on the grid view — read it through the audited full-row seam.
    const full = await getAlbumPhotoForViewer(runtimeDb, account(contributor), album[0]!.id);
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
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album[0]!.exifCapturedAt).toBeNull();
    const full = await getAlbumPhotoForViewer(runtimeDb, account(contributor), album[0]!.id);
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
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    // The SAME single photo lands in both chosen albums.
    expect(albumA).toHaveLength(1);
    expect(albumB.map((p) => p.id)).toEqual([albumA[0]!.id]);
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
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    // Visible in A...
    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA).toHaveLength(1);
    const photoId = albumA[0]!.id;
    // ...but NOT in B, for the contributor or a co-member of B.
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    expect(albumB).toEqual([]);
    const asBMember = await getAlbumPhotoForViewer(
      runtimeDb,
      account(bMember),
      photoId,
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
    expect(result).toEqual({ ok: true, added: 1, failed: 0 });

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA).toHaveLength(1);
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

  // #16 multi-select: one submit can carry MANY files (repeated `photo` FormData entries). Each
  // becomes its own album photo placed into the SAME chosen album(s).
  it("creates a separate photo for EVERY file, all into the chosen families", async () => {
    const contributor = await makePerson("Rosa");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    authCtx = account(contributor);

    // Three distinct files → three photos, each landing in both chosen albums.
    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array([1, 1, 1]) as BlobPart], { type: "image/png" }), "a.png");
    fd.append("photo", new Blob([new Uint8Array([2, 2, 2]) as BlobPart], { type: "image/png" }), "b.png");
    fd.append("photo", new Blob([new Uint8Array([3, 3, 3]) as BlobPart], { type: "image/png" }), "c.png");
    fd.append("familyIds", famA);
    fd.append("familyIds", famB);

    const result = await uploadAlbumPhotoAction(fd);
    expect(result).toEqual({ ok: true, added: 3, failed: 0 });

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    expect(albumA).toHaveLength(3);
    // Same three photos in both albums (order-independent).
    expect(new Set(albumB.map((p) => p.id))).toEqual(new Set(albumA.map((p) => p.id)));
    // Three files → three distinct storage objects.
    expect(runtimeStorage.size).toBe(3);
  });

  // A per-file storage/db throw increments `failed` and does NOT abort the batch: the other files
  // still land, and the action returns a batch summary (not an error).
  it("returns a partial summary when one file fails but others succeed", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    // Make the SECOND storage write throw, leaving the first and third to succeed.
    const realPut = runtimeStorage.put.bind(runtimeStorage);
    let call = 0;
    vi.spyOn(runtimeStorage, "put").mockImplementation(async (obj) => {
      call += 1;
      if (call === 2) throw new Error("storage boom");
      return realPut(obj);
    });

    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array([1]) as BlobPart], { type: "image/png" }), "a.png");
    fd.append("photo", new Blob([new Uint8Array([2]) as BlobPart], { type: "image/png" }), "b.png");
    fd.append("photo", new Blob([new Uint8Array([3]) as BlobPart], { type: "image/png" }), "c.png");

    const result = await uploadAlbumPhotoAction(fd);
    expect(result).toEqual({ ok: true, added: 2, failed: 1 });

    // Two photos landed (the failed one wrote nothing); each successful file has its own object.
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(2);
    expect(runtimeStorage.size).toBe(2);
  });

  // Whole batch fails (every file throws) → a single upload error, mirroring the single-file case.
  it("returns the upload-failed error when EVERY file fails", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    vi.spyOn(runtimeStorage, "put").mockRejectedValue(new Error("storage boom"));

    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array([1]) as BlobPart], { type: "image/png" }), "a.png");
    fd.append("photo", new Blob([new Uint8Array([2]) as BlobPart], { type: "image/png" }), "b.png");

    const result = await uploadAlbumPhotoAction(fd);
    expect(result).toEqual({
      error: hub.actions.photoUploadFailedDetail("storageboom"),
    });
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });

  // Zero VALID files (only empty-size blobs) → the photoEmpty guard, nothing written.
  it("returns photoEmpty when no file has any bytes", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array([]) as BlobPart], { type: "image/png" }), "empty1.png");
    fd.append("photo", new Blob([new Uint8Array([]) as BlobPart], { type: "image/png" }), "empty2.png");

    const result = await uploadAlbumPhotoAction(fd);
    expect(result).toEqual({ error: hub.actions.photoEmpty });
    expect(runtimeStorage.size).toBe(0);
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });

  // Regression (review finding): the server enforces the per-batch cap authoritatively (the client
  // guards too, but is never trusted). An over-cap batch is rejected before anything touches storage.
  it("rejects a batch over the per-batch cap and writes nothing", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const fd = new FormData();
    for (let i = 0; i < 31; i += 1) {
      fd.append("photo", new Blob([new Uint8Array([i + 1]) as BlobPart], { type: "image/png" }), `p${i}.png`);
    }

    const result = await uploadAlbumPhotoAction(fd);
    expect(result).toEqual({ error: hub.actions.tooManyPhotos });
    expect(runtimeStorage.size).toBe(0);
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });
});

// ADR-0015 · F2 — the per-item sibling of the batch upload. One file per call so the client can
// drive a bounded concurrency pool and resolve each placeholder tile independently. Mirrors the
// batch action's guards EXACTLY, but for exactly one file, returning ImportOnePhotoResult.
describe("uploadOneAlbumPhotoAction", () => {
  it("lands exactly one upload photo in the chosen family", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadOneAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [familyId]),
    );

    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(1);
    // The returned photoId is the ACTUAL persisted row id — the board renders that tile optimistically.
    expect(result).toEqual({ ok: true, photoId: album[0]!.id });
    expect(album[0]!.source).toBe("upload");
    expect(await runtimeStorage.getBytes(album[0]!.storageKey)).toEqual(PNG_BYTES);
    expect(runtimeStorage.size).toBe(1);
  });

  it("resolves the sole family for a solo contributor with no selection", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadOneAlbumPhotoAction(photoForm(PNG_BYTES));
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(1);
    expect(result).toEqual({ ok: true, photoId: album[0]!.id });
  });

  it("rejects an unauthenticated caller and writes nothing", async () => {
    authCtx = { kind: "anonymous" };
    const result = await uploadOneAlbumPhotoAction(photoForm(PNG_BYTES));
    expect(result).toEqual({ error: hub.actions.notSignedIn });
    expect(runtimeStorage.size).toBe(0);
  });

  it("returns photoEmpty when the file has no bytes", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const result = await uploadOneAlbumPhotoAction(photoForm(new Uint8Array([])));
    expect(result).toEqual({ error: hub.actions.photoEmpty });
    expect(runtimeStorage.size).toBe(0);
  });

  it("drops a spoofed family id and falls back to the sole owned family", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    // Submits only a foreign family id; with a single owned family it falls back to it.
    const result = await uploadOneAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famX]),
    );
    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA).toHaveLength(1);
    expect(result).toEqual({ ok: true, photoId: albumA[0]!.id });
    const albumX = await listAlbumPhotos(runtimeDb, account(outsider), famX);
    expect(albumX).toEqual([]);
  });

  it("errors when a multi-family contributor submits only a foreign family id", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    const result = await uploadOneAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [famX]),
    );
    expect(result).toEqual({ error: hub.actions.noAlbumChosen });
    expect(runtimeStorage.size).toBe(0);
  });

  it("returns the upload-failed detail error when storage throws", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    vi.spyOn(runtimeStorage, "put").mockRejectedValue(new Error("storage boom"));

    const result = await uploadOneAlbumPhotoAction(
      photoFormWithFamilies(PNG_BYTES, [familyId]),
    );
    expect(result).toEqual({
      error: hub.actions.photoUploadFailedDetail("storageboom"),
    });
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
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

// #18 — the album's first MANAGEMENT surface: caption edit + delete, each re-resolving auth on the
// server and forwarding the AuthContext to the audited seam (which re-runs the contributor/steward
// check). The client is never trusted for identity.
describe("album management actions (#18)", () => {
  function captionForm(photoId: string, caption: string | null): FormData {
    const fd = new FormData();
    fd.append("photoId", photoId);
    if (caption !== null) fd.append("caption", caption);
    return fd;
  }
  function deleteForm(photoId: string): FormData {
    const fd = new FormData();
    fd.append("photoId", photoId);
    return fd;
  }
  function callBytes(photoId: string): Promise<Response> {
    return albumPhotoGet(new Request("http://localhost/api/album-photo/x"), {
      params: Promise.resolve({ photoId }),
    });
  }

  // steward = the family creator; contributor + plainMember are separate active members.
  async function seedManaged(): Promise<{
    steward: string;
    contributor: string;
    plainMember: string;
    familyId: string;
    photoId: string;
  }> {
    const steward = await makePerson("Nonna");
    const contributor = await makePerson("Rosa");
    const plainMember = await makePerson("Sal");
    const familyId = await makeFamily("Esposito", steward);
    await addMember(steward, familyId);
    await addMember(contributor, familyId);
    await addMember(plainMember, familyId);
    const storageKey = "family-photos/manage-test";
    await runtimeStorage.put({ key: storageKey, bytes: PNG_BYTES, contentType: "image/png" });
    const photo = await createAlbumPhoto(runtimeDb, {
      contributorPersonId: contributor,
      familyIds: [familyId],
      source: "upload",
      storageKey,
      caption: null,
    });
    return { steward, contributor, plainMember, familyId, photoId: photo.id };
  }

  describe("editAlbumCaptionAction", () => {
    it("lets the contributor set a caption (reflected on the grid)", async () => {
      const { contributor, familyId, photoId } = await seedManaged();
      authCtx = account(contributor);
      const result = await editAlbumCaptionAction(captionForm(photoId, "Wedding, 1961"));
      expect(result).toEqual({ ok: true });
      const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
      expect(album[0]!.caption).toBe("Wedding, 1961");
    });

    it("rejects a plain member and leaves the caption unchanged", async () => {
      const { contributor, plainMember, familyId, photoId } = await seedManaged();
      // Seed an existing caption as the contributor first.
      authCtx = account(contributor);
      await editAlbumCaptionAction(captionForm(photoId, "Original"));
      // A plain member cannot change it.
      authCtx = account(plainMember);
      const result = await editAlbumCaptionAction(captionForm(photoId, "Hijacked"));
      expect(result).toEqual({ error: hub.actions.notAllowedToManagePhoto });
      const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
      expect(album[0]!.caption).toBe("Original");
    });

    it("rejects a caption longer than 500 characters", async () => {
      const { contributor, photoId } = await seedManaged();
      authCtx = account(contributor);
      const result = await editAlbumCaptionAction(captionForm(photoId, "x".repeat(501)));
      expect(result).toEqual({ error: hub.actions.captionTooLong });
    });

    it("rejects an unauthenticated caller", async () => {
      const { photoId } = await seedManaged();
      authCtx = { kind: "anonymous" };
      const result = await editAlbumCaptionAction(captionForm(photoId, "nope"));
      expect(result).toEqual({ error: hub.actions.notSignedIn });
    });
  });

  describe("deleteAlbumPhotoAction", () => {
    it("lets the contributor delete: gone from the grid, bytes route 404s", async () => {
      const { contributor, familyId, photoId } = await seedManaged();
      authCtx = account(contributor);
      const result = await deleteAlbumPhotoAction(deleteForm(photoId));
      expect(result).toEqual({ ok: true });
      const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
      expect(album).toEqual([]);
      const res = await callBytes(photoId);
      expect(res.status).toBe(404);
    });

    it("rejects a plain member; the photo stays", async () => {
      const { contributor, plainMember, familyId, photoId } = await seedManaged();
      authCtx = account(plainMember);
      const result = await deleteAlbumPhotoAction(deleteForm(photoId));
      expect(result).toEqual({ error: hub.actions.notAllowedToManagePhoto });
      const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
      expect(album.map((p) => p.id)).toEqual([photoId]);
    });

    it("rejects an unauthenticated caller", async () => {
      const { photoId } = await seedManaged();
      authCtx = { kind: "anonymous" };
      const result = await deleteAlbumPhotoAction(deleteForm(photoId));
      expect(result).toEqual({ error: hub.actions.notSignedIn });
    });
  });
});
