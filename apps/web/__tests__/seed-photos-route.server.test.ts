/**
 * Server-side integration test for the PREVIEW-ONLY demo seed route `POST /api/dev/seed-photos`.
 *
 * The route seeds three stories owned by the authenticated caller — 0 / 1 / 2 photos — so the hub
 * Stories masonry shows every varied card layout. The double gate (VERCEL_ENV === 'preview' AND an
 * authenticated account caller) is verified here, plus the happy path: three owned+visible stories
 * with the right photo counts and the photo bytes retrievable from storage.
 *
 * Harness mirrors capture-subject-photo.server.test.ts: `@/lib/runtime` is mocked so importing the
 * route doesn't boot the DEV runtime; getRuntime() reads settable module-level bindings. VERCEL_ENV is
 * set per-test (restored in afterEach) — the route reads it directly from process.env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { familyPhotos } from "@chronicle/db/content";
import {
  createFamily,
  listStoriesForViewer,
  listStoryImages,
  type AuthContext,
} from "@chronicle/core";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { inArray } from "drizzle-orm";
import { GET, POST } from "@/app/api/dev/seed-photos/route";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function makePerson(name: string): Promise<string> {
  const [p] = await runtimeDb
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = { kind: "anonymous" };
});

afterEach(() => {
  vi.clearAllMocks();
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("POST /api/dev/seed-photos (preview-only demo seed)", () => {
  it("404s when VERCEL_ENV is not 'preview' (unset)", async () => {
    delete process.env.VERCEL_ENV;
    const person = await makePerson("Caller");
    authCtx = account(person);
    const res = await POST();
    expect(res.status).toBe(404);
    // Nothing was seeded.
    const stories = await listStoriesForViewer(runtimeDb, authCtx, { ownerPersonId: person });
    expect(stories).toHaveLength(0);
  });

  it("404s when VERCEL_ENV is 'production'", async () => {
    process.env.VERCEL_ENV = "production";
    const person = await makePerson("Caller");
    authCtx = account(person);
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("401s an unauthenticated caller on a preview env", async () => {
    process.env.VERCEL_ENV = "preview";
    authCtx = { kind: "anonymous" };
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it("GET 404s when VERCEL_ENV is not 'preview'", async () => {
    delete process.env.VERCEL_ENV;
    const res = await GET(new Request("http://localhost/api/dev/seed-photos"));
    expect(res.status).toBe(404);
  });

  it("GET (no auth) on preview returns counts + marker presence", async () => {
    process.env.VERCEL_ENV = "preview";
    authCtx = { kind: "anonymous" }; // GET requires no auth
    const person = await makePerson("Caller");
    await createFamily(runtimeDb, { name: "Isolated Dev Branch", creatorPersonId: person });

    // marker matches an existing family → present
    const resPresent = await GET(
      new Request("http://localhost/api/dev/seed-photos?marker=Isolated%20Dev%20Branch"),
    );
    expect(resPresent.status).toBe(200);
    const present = (await resPresent.json()) as {
      ok: boolean;
      vercelEnv: string;
      accounts: number;
      markerPresent: boolean;
    };
    expect(present.ok).toBe(true);
    expect(present.vercelEnv).toBe("preview");
    expect(present.accounts).toBe(0); // makePerson creates no Account row
    expect(present.markerPresent).toBe(true);

    // marker with no matching family → absent
    const resAbsent = await GET(
      new Request("http://localhost/api/dev/seed-photos?marker=Production"),
    );
    const absent = (await resAbsent.json()) as { markerPresent: boolean };
    expect(absent.markerPresent).toBe(false);

    // no marker → absent
    const resNone = await GET(new Request("http://localhost/api/dev/seed-photos"));
    const none = (await resNone.json()) as { markerPresent: boolean };
    expect(none.markerPresent).toBe(false);
  });

  it("seeds 3 owned+visible stories (0/1/2 photos) with retrievable bytes on preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const person = await makePerson("Caller");
    authCtx = account(person);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      createdStoryIds: string[];
      familyId: string;
      photoCount: number;
    };
    expect(body.ok).toBe(true);
    expect(body.createdStoryIds).toHaveLength(3);
    expect(body.photoCount).toBe(3); // 0 + 1 + 2
    expect(body.familyId).toBeTruthy();

    // All three are visible to the caller (owner arm of listStoriesForViewer).
    const visible = await listStoriesForViewer(runtimeDb, authCtx, { ownerPersonId: person });
    const visibleIds = new Set(visible.map((s) => s.id));
    for (const id of body.createdStoryIds) expect(visibleIds.has(id)).toBe(true);

    // Photo counts per story, in creation order: 0, 1, 2.
    const counts = await Promise.all(
      body.createdStoryIds.map(async (id) => (await listStoryImages(runtimeDb, id)).length),
    );
    expect(counts).toEqual([0, 1, 2]);

    // The 3 seeded photos are all in the album, and every one's bytes are retrievable from storage.
    const photoIds = [
      ...new Set(
        (
          await Promise.all(
            body.createdStoryIds.map((id) => listStoryImages(runtimeDb, id)),
          )
        )
          .flat()
          .map((img) => img.familyPhotoId)
          .filter((v): v is string => v !== null),
      ),
    ];
    expect(photoIds).toHaveLength(3);
    const rows = await runtimeDb
      .select({ storageKey: familyPhotos.storageKey })
      .from(familyPhotos)
      .where(inArray(familyPhotos.id, photoIds));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const bytes = await runtimeStorage.getBytes(row.storageKey);
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBeGreaterThan(0);
      // Valid JPEG magic (SOI + marker).
      expect([bytes![0], bytes![1], bytes![2]]).toEqual([0xff, 0xd8, 0xff]);
    }
  });
});
