/**
 * Orphaned-object reaper (issue #90) — reconciles the `family-photos/` keyspace against
 * `family_photos.storage_key`. Pinned here:
 *   - an old object with NO DB row is hard-deleted (the put-then-record orphan window);
 *   - an object WITH a row is never touched — including a SOFT-DELETED row, whose bytes are
 *     deliberately retained today;
 *   - an orphan INSIDE the safety window is kept (it may be an in-flight upload);
 *   - a `.thumb` derivative has no row by design — it lives or dies with its BASE key's row;
 *   - a single failed delete neither aborts the run nor is counted as reaped;
 *   - the sweep is idempotent: a second run reaps nothing.
 */
import { createAlbumPhoto } from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { familyPhotos } from "@chronicle/db/content";
import { families, persons } from "@chronicle/db/schema";
import {
  InMemoryMediaStorage,
  THUMBNAIL_KEY_SUFFIX,
} from "@chronicle/storage";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { reapOrphanedPhotos } from "../src/index";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const HOUR = 60 * 60 * 1000;

let db: Database;
let nowMs: number;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  nowMs = T0;
  storage = new InMemoryMediaStorage({ now: () => new Date(nowMs) });
});

const now = () => new Date(nowMs);

async function put(key: string): Promise<void> {
  await storage.put({ key, bytes: new Uint8Array([1]), contentType: "image/jpeg" });
}

/** Record a `family_photos` row for `storageKey` the way the real upload flow does. */
async function recordPhoto(storageKey: string): Promise<string> {
  const [person] = await db
    .insert(persons)
    .values({ displayName: "Rosa", spokenName: "Rosa" })
    .returning();
  const [fam] = await db
    .insert(families)
    .values({
      name: "Esposito",
      creatorPersonId: person!.id,
      stewardPersonId: person!.id,
    })
    .returning();
  const photo = await createAlbumPhoto(db, {
    contributorPersonId: person!.id,
    familyIds: [fam!.id],
    source: "upload",
    storageKey,
  });
  return photo.id;
}

async function softDelete(photoId: string): Promise<void> {
  await db
    .update(familyPhotos)
    .set({ deletedAt: new Date() })
    .where(eq(familyPhotos.id, photoId));
}

describe("reapOrphanedPhotos", () => {
  it("reaps an old object with no DB row and reports the count", async () => {
    await put("family-photos/orphan");
    nowMs += 2 * HOUR; // object is now well outside the safety window

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result).toEqual({ scanned: 1, reaped: 1, failed: 0 });
    expect(await storage.exists("family-photos/orphan")).toBe(false);
  });

  it("keeps an old object whose key has a DB row", async () => {
    await put("family-photos/recorded");
    await recordPhoto("family-photos/recorded");
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result).toEqual({ scanned: 1, reaped: 0, failed: 0 });
    expect(await storage.exists("family-photos/recorded")).toBe(true);
  });

  it("keeps an old object whose row is SOFT-DELETED (bytes deliberately retained)", async () => {
    await put("family-photos/soft-deleted");
    const photoId = await recordPhoto("family-photos/soft-deleted");
    await softDelete(photoId);
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result.reaped).toBe(0);
    expect(await storage.exists("family-photos/soft-deleted")).toBe(true);
  });

  it("keeps an orphan still INSIDE the safety window (may be an in-flight upload)", async () => {
    await put("family-photos/old-orphan");
    nowMs += 2 * HOUR;
    await put("family-photos/fresh-orphan"); // written seconds ago — inside the window

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result).toEqual({ scanned: 2, reaped: 1, failed: 0 });
    expect(await storage.exists("family-photos/old-orphan")).toBe(false);
    expect(await storage.exists("family-photos/fresh-orphan")).toBe(true);
  });

  it("respects a custom minAgeMs", async () => {
    await put("family-photos/orphan");
    nowMs += 30 * 60 * 1000; // 30 min — inside the default 1h window

    const result = await reapOrphanedPhotos({
      db,
      storage,
      now,
      minAgeMs: 15 * 60 * 1000,
    });

    expect(result.reaped).toBe(1);
    expect(await storage.exists("family-photos/orphan")).toBe(false);
  });

  it("keeps a .thumb whose BASE key has a row; reaps one whose base has none", async () => {
    await put("family-photos/live");
    await recordPhoto("family-photos/live");
    await put(`family-photos/live${THUMBNAIL_KEY_SUFFIX}`);
    await put(`family-photos/ghost${THUMBNAIL_KEY_SUFFIX}`);
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result).toEqual({ scanned: 3, reaped: 1, failed: 0 });
    expect(await storage.exists(`family-photos/live${THUMBNAIL_KEY_SUFFIX}`)).toBe(true);
    expect(await storage.exists(`family-photos/ghost${THUMBNAIL_KEY_SUFFIX}`)).toBe(false);
  });

  it("reaps a .thumb whose base object is already gone (thumbnail of an abandoned upload)", async () => {
    // Base was reaped in an earlier run (or never completed); only the thumbnail remains.
    await put(`family-photos/gone${THUMBNAIL_KEY_SUFFIX}`);
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result.reaped).toBe(1);
    expect(await storage.exists(`family-photos/gone${THUMBNAIL_KEY_SUFFIX}`)).toBe(false);
  });

  it("never looks outside the family-photos/ keyspace", async () => {
    await put("story-audio/keep-me");
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage, now });

    expect(result).toEqual({ scanned: 0, reaped: 0, failed: 0 });
    expect(await storage.exists("story-audio/keep-me")).toBe(true);
  });

  it("a failed delete neither aborts the run nor counts as reaped", async () => {
    const flaky = new (class extends InMemoryMediaStorage {
      override async delete(key: string): Promise<void> {
        if (key === "family-photos/bad") throw new Error("r2 hiccup");
        return super.delete(key);
      }
    })({ now });
    await flaky.put({
      key: "family-photos/bad",
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
    });
    await flaky.put({
      key: "family-photos/good",
      bytes: new Uint8Array([1]),
      contentType: "image/jpeg",
    });
    nowMs += 2 * HOUR;

    const result = await reapOrphanedPhotos({ db, storage: flaky, now });

    expect(result).toEqual({ scanned: 2, reaped: 1, failed: 1 });
    expect(await flaky.exists("family-photos/bad")).toBe(true); // survives for the next run
    expect(await flaky.exists("family-photos/good")).toBe(false);
  });

  it("is idempotent: a second run reaps nothing", async () => {
    await put("family-photos/orphan");
    nowMs += 2 * HOUR;

    const first = await reapOrphanedPhotos({ db, storage, now });
    const second = await reapOrphanedPhotos({ db, storage, now });

    expect(first.reaped).toBe(1);
    expect(second).toEqual({ scanned: 0, reaped: 0, failed: 0 });
  });
});
