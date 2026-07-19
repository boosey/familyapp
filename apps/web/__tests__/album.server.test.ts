/**
 * Server-side integration tests for the album surface (ADR-0009 · #15 · issue #20 direct-to-storage):
 *   - `requestAlbumUploadAction` + `recordAlbumPhotoAction` — the two-step direct-upload flow. The
 *     browser PUT is SIMULATED by calling `storage.put(key, …)` between the two actions. Covers the
 *     happy path (row + album membership written, target family resolved from the CONTRIBUTOR's own
 *     active memberships, EXIF read from the STORED bytes) plus the security guards (unauth, non-image
 *     type, no-family, bad/expired/foreign ticket, phantom key).
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
  requestAlbumUploadAction,
  recordAlbumPhotoAction,
  editAlbumCaptionAction,
  deleteAlbumPhotoAction,
} from "@/app/hub/album/actions";
import { GET as albumPhotoGet } from "@/app/api/album-photo/[photoId]/route";
import { createUploadTicket } from "@/lib/upload-ticket";
import type { ImportOnePhotoResult } from "@/app/hub/album/import-progress";
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

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = { kind: "anonymous" };
});

/**
 * Drive the whole issue-#20 direct-upload flow end-to-end for ONE photo, SIMULATING the browser PUT
 * with a `storage.put` between request and record. Returns the record result plus the key, so callers
 * can assert on the created row / stored bytes.
 */
async function uploadOnePhoto(
  bytes: Uint8Array,
  opts: { familyIds?: string[]; contentType?: string } = {},
): Promise<{ result: ImportOnePhotoResult; key: string }> {
  const contentType = opts.contentType ?? "image/png";
  const requested = await requestAlbumUploadAction({ contentType });
  if ("error" in requested) throw new Error(`request failed: ${requested.error}`);
  // Browser PUT (simulated): the bytes land at the server-minted key.
  await runtimeStorage.put({ key: requested.key, bytes, contentType });
  const fd = new FormData();
  fd.append("key", requested.key);
  fd.append("ticket", requested.ticket);
  for (const id of opts.familyIds ?? []) fd.append("familyIds", id);
  const result = await recordAlbumPhotoAction(fd);
  return { result, key: requested.key };
}

/** A record FormData for a key that has ALREADY been PUT (or not) — with a valid ticket for `person`. */
function recordForm(
  key: string,
  ticket: string,
  familyIds: string[] = [],
): FormData {
  const fd = new FormData();
  fd.append("key", key);
  fd.append("ticket", ticket);
  for (const id of familyIds) fd.append("familyIds", id);
  return fd;
}

describe("requestAlbumUploadAction (issue #20 — step 1: mint target + ticket)", () => {
  it("returns a key, upload target, and ticket for a signed-in family member", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const res = await requestAlbumUploadAction({ contentType: "image/jpeg" });
    if ("error" in res) throw new Error(res.error);
    expect(res.key.startsWith("family-photos/")).toBe(true);
    expect(res.upload.method).toBe("PUT");
    expect(typeof res.upload.url).toBe("string");
    // The declared content type is bound into the target headers.
    expect(res.upload.headers["Content-Type"]).toBe("image/jpeg");
    expect(typeof res.ticket).toBe("string");
    // No bytes were written yet — request only mints; the browser PUTs next.
    expect(runtimeStorage.size).toBe(0);
  });

  it("rejects an unauthenticated caller", async () => {
    authCtx = { kind: "anonymous" };
    const res = await requestAlbumUploadAction({ contentType: "image/png" });
    expect(res).toEqual({ error: hub.actions.notSignedIn });
  });

  it("rejects a signed-in caller with no family", async () => {
    const orphan = await makePerson("Orphan");
    authCtx = account(orphan);
    const res = await requestAlbumUploadAction({ contentType: "image/png" });
    expect(res).toEqual({ error: hub.actions.noFamily });
  });

  it("rejects a non-image content type BEFORE minting a target", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const res = await requestAlbumUploadAction({ contentType: "application/pdf" });
    expect(res).toEqual({ error: hub.actions.photoTypeUnsupported });
  });
});

describe("recordAlbumPhotoAction (issue #20 — step 3: record the stored photo)", () => {
  it("records the row + album membership from bytes already in storage", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const { result, key } = await uploadOnePhoto(PNG_BYTES, { familyIds: [familyId] });

    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(1);
    expect(result).toEqual({ ok: true, photoId: album[0]!.id });
    expect(album[0]!.storageKey).toBe(key);
    expect(album[0]!.source).toBe("upload");
    expect(await runtimeStorage.getBytes(key)).toEqual(PNG_BYTES);
    // The browser PUT (simulated) plus the 0-byte thumbnail-failure sentinel (issue #176 — the
    // fake PNG bytes are not a decodable image, so warm caches the failure instead of a thumb).
    expect(runtimeStorage.size).toBe(2);
  });

  it("resolves the sole family for a solo contributor with no selection", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const { result } = await uploadOnePhoto(PNG_BYTES);
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toHaveLength(1);
    expect(result).toEqual({ ok: true, photoId: album[0]!.id });
  });

  it("populates exif capture-date + gps from the STORED bytes (#17)", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const { result } = await uploadOnePhoto(JPEG_WITH_EXIF, {
      familyIds: [familyId],
      contentType: "image/jpeg",
    });
    expect("ok" in result && result.ok).toBe(true);

    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    const captured = album[0]!.exifCapturedAt;
    expect(captured).toBeInstanceOf(Date);
    expect(captured!.toISOString()).toBe("2015-06-15T14:30:00.000Z");
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

    await uploadOnePhoto(PNG_BYTES, { familyIds: [familyId] });
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album[0]!.exifCapturedAt).toBeNull();
    const full = await getAlbumPhotoForViewer(runtimeDb, account(contributor), album[0]!.id);
    expect(full!.exifGps).toBeNull();
  });

  it("rejects an unauthenticated caller and writes no row", async () => {
    // Mint a valid ticket as a real person, then try to RECORD while anonymous.
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    const key = "family-photos/anon-test";
    const ticket = createUploadTicket({ key, personId: contributor });
    await runtimeStorage.put({ key, bytes: PNG_BYTES, contentType: "image/png" });

    authCtx = { kind: "anonymous" };
    const result = await recordAlbumPhotoAction(recordForm(key, ticket, [familyId]));
    expect(result).toEqual({ error: hub.actions.notSignedIn });
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });

  it("rejects a FOREIGN ticket (minted for another person) — cannot record with someone else's key", async () => {
    const contributor = await makePerson("Rosa");
    const attacker = await makePerson("Vito");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    await addMember(attacker, await makeFamily("Corleone", attacker));

    const key = "family-photos/foreign-test";
    // Ticket minted for the contributor...
    const foreignTicket = createUploadTicket({ key, personId: contributor });
    await runtimeStorage.put({ key, bytes: PNG_BYTES, contentType: "image/png" });

    // ...but the ATTACKER tries to record with it.
    authCtx = account(attacker);
    const result = await recordAlbumPhotoAction(recordForm(key, foreignTicket));
    expect(result).toEqual({ error: hub.actions.uploadTicketInvalid });
  });

  it("rejects a ticket whose bound key does NOT match the submitted key", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const realKey = "family-photos/real";
    const otherKey = "family-photos/other";
    const ticketForOther = createUploadTicket({ key: otherKey, personId: contributor });
    await runtimeStorage.put({ key: realKey, bytes: PNG_BYTES, contentType: "image/png" });

    // Submit realKey but a ticket bound to otherKey → rejected.
    const result = await recordAlbumPhotoAction(recordForm(realKey, ticketForOther, [familyId]));
    expect(result).toEqual({ error: hub.actions.uploadTicketInvalid });
  });

  it("rejects an EXPIRED ticket", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const key = "family-photos/expired";
    // Mint a ticket that was already expired when created (ttl 0, minted 10 min ago).
    const expired = createUploadTicket(
      { key, personId: contributor, ttlSeconds: 0 },
      Date.now() - 10 * 60 * 1000,
    );
    await runtimeStorage.put({ key, bytes: PNG_BYTES, contentType: "image/png" });

    const result = await recordAlbumPhotoAction(recordForm(key, expired, [familyId]));
    expect(result).toEqual({ error: hub.actions.uploadTicketInvalid });
  });

  it("rejects a TAMPERED ticket", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const key = "family-photos/tampered";
    const good = createUploadTicket({ key, personId: contributor });
    const tampered = `${good}x`; // flip the signature
    await runtimeStorage.put({ key, bytes: PNG_BYTES, contentType: "image/png" });

    const result = await recordAlbumPhotoAction(recordForm(key, tampered, [familyId]));
    expect(result).toEqual({ error: hub.actions.uploadTicketInvalid });
  });

  it("rejects a PHANTOM key — no object in storage (never record a phantom)", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    // Valid ticket, but the browser PUT never happened → exists === false.
    const key = "family-photos/never-uploaded";
    const ticket = createUploadTicket({ key, personId: contributor });
    const result = await recordAlbumPhotoAction(recordForm(key, ticket, [familyId]));
    expect(result).toEqual({ error: hub.actions.uploadObjectMissing });
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });

  it("rejects a key OUTSIDE the family-photos/ keyspace even with a valid ticket", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const key = "rec/evil.webm"; // an audio-recording keyspace, not an album photo
    const ticket = createUploadTicket({ key, personId: contributor });
    await runtimeStorage.put({ key, bytes: PNG_BYTES, contentType: "image/png" });

    const result = await recordAlbumPhotoAction(recordForm(key, ticket, [familyId]));
    expect(result).toEqual({ error: hub.actions.uploadTicketInvalid });
  });

  it("returns invalidInput when key or ticket is missing", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const fd = new FormData();
    fd.append("familyIds", familyId);
    const result = await recordAlbumPhotoAction(fd);
    expect(result).toEqual({ error: hub.actions.invalidInput });
  });

  // Family re-validation posture preserved: a spoofed family the caller isn't in is dropped; a
  // solo-owner falls back to their sole family.
  it("drops a spoofed family id and falls back to the sole owned family", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    const { result } = await uploadOnePhoto(PNG_BYTES, { familyIds: [famX] });
    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    expect(albumA).toHaveLength(1);
    expect(result).toEqual({ ok: true, photoId: albumA[0]!.id });
    const albumX = await listAlbumPhotos(runtimeDb, account(outsider), famX);
    expect(albumX).toEqual([]);
  });

  it("errors when a multi-family contributor submits ONLY a foreign family id", async () => {
    const contributor = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    await addMember(outsider, famX);
    authCtx = account(contributor);

    const { result } = await uploadOnePhoto(PNG_BYTES, { familyIds: [famX] });
    expect(result).toEqual({ error: hub.actions.noAlbumChosen });
  });

  it("places a photo into BOTH selected families (one object, two album placements)", async () => {
    const contributor = await makePerson("Rosa");
    const famA = await makeFamily("Esposito", contributor);
    const famB = await makeFamily("Marino", contributor);
    await addMember(contributor, famA);
    await addMember(contributor, famB);
    authCtx = account(contributor);

    const { result } = await uploadOnePhoto(PNG_BYTES, { familyIds: [famA, famB] });
    expect("ok" in result && result.ok).toBe(true);

    const albumA = await listAlbumPhotos(runtimeDb, account(contributor), famA);
    const albumB = await listAlbumPhotos(runtimeDb, account(contributor), famB);
    expect(albumA).toHaveLength(1);
    expect(albumB.map((p) => p.id)).toEqual([albumA[0]!.id]);
    // One object, two album placements — plus the thumbnail-failure sentinel (issue #176), since
    // the fake PNG bytes are not a decodable image.
    expect(runtimeStorage.size).toBe(2);
  });
});

// Regression (issue #20 core behavior change): bytes NEVER transit the record action, and record
// refuses a key it can't prove was minted for this caller.
describe("issue #20 direct-upload regression: no bytes in record, no phantom keys", () => {
  it("recordAlbumPhotoAction carries NO photo bytes — it only names a key the browser already PUT", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const requested = await requestAlbumUploadAction({ contentType: "image/png" });
    if ("error" in requested) throw new Error(requested.error);

    // The record FormData carries ONLY metadata (key, ticket, familyIds) — never a `photo` blob.
    const fd = recordForm(requested.key, requested.ticket, [familyId]);
    expect(fd.getAll("photo")).toEqual([]);
    expect(fd.get("key")).toBe(requested.key);

    // Simulate the browser PUT, then record: the photo lands, sourced from STORAGE bytes.
    await runtimeStorage.put({ key: requested.key, bytes: PNG_BYTES, contentType: "image/png" });
    const result = await recordAlbumPhotoAction(fd);
    expect("ok" in result && result.ok).toBe(true);
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(await runtimeStorage.getBytes(album[0]!.storageKey)).toEqual(PNG_BYTES);
  });

  it("refuses to record when the object was never PUT (phantom), leaving nothing behind", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const requested = await requestAlbumUploadAction({ contentType: "image/png" });
    if ("error" in requested) throw new Error(requested.error);
    // Skip the browser PUT entirely → record must refuse.
    const result = await recordAlbumPhotoAction(
      recordForm(requested.key, requested.ticket, [familyId]),
    );
    expect(result).toEqual({ error: hub.actions.uploadObjectMissing });
    expect(runtimeStorage.size).toBe(0);
    const album = await listAlbumPhotos(runtimeDb, account(contributor), familyId);
    expect(album).toEqual([]);
  });

  // Orphan cleanup: if createAlbumPhoto throws AFTER the object exists, the stored (write-once) blob
  // is best-effort deleted so a retry (fresh key) doesn't accumulate orphans.
  it("deletes the stored object when createAlbumPhoto throws (no write-once orphan)", async () => {
    const contributor = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", contributor);
    await addMember(contributor, familyId);
    authCtx = account(contributor);

    const requested = await requestAlbumUploadAction({ contentType: "image/png" });
    if ("error" in requested) throw new Error(requested.error);
    // Browser PUT lands the object...
    await runtimeStorage.put({ key: requested.key, bytes: PNG_BYTES, contentType: "image/png" });
    expect(runtimeStorage.size).toBe(1);
    const deleteSpy = vi.spyOn(runtimeStorage, "delete");

    // ...but the row write throws.
    vi.spyOn(runtimeStorage, "getBytes").mockResolvedValueOnce(PNG_BYTES);
    const err = new Error("db down");
    vi.spyOn(await import("@chronicle/core"), "createAlbumPhoto").mockRejectedValueOnce(err);

    const result = await recordAlbumPhotoAction(
      recordForm(requested.key, requested.ticket, [familyId]),
    );
    expect("error" in result).toBe(true);
    // The orphaned object was cleaned up.
    expect(deleteSpy).toHaveBeenCalledWith(requested.key);
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
