/**
 * Server-side integration test for ADR-0009 Phase 3 subject-photo carry-forward on the login-free
 * link-session capture path (`POST /api/capture`). When the narrator answers an ask that has 2+
 * subject photos via `/s/[token]`, the FIRST ask photo becomes the story's subject/cover and the
 * REST ride as accompaniment — the same contract as the in-hub answer path, wired here because
 * link-session previously dropped ask subject photos entirely.
 *
 * Harness mirrors story-imagery-compose.server.test.ts: `@/lib/runtime` is mocked so importing the
 * route doesn't boot the DEV runtime; getRuntime() reads settable module-level bindings.
 * `dispatchPipeline` is a no-op — subject/cover are stamped at ingest, before the pipeline runs.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeDispatch: (storyId: string) => Promise<void>;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    dispatchPipeline: (storyId: string) => runtimeDispatch(storyId),
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { asks, families, memberships, persons } from "@chronicle/db/schema";
import { stories } from "@chronicle/db/content";
import {
  createAsk,
  createAlbumPhoto,
  listStoryImages,
  listAskSubjectPhotos,
  type AuthContext,
} from "@chronicle/core";
import { createLinkSession } from "@chronicle/capture";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/capture/route";

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

async function makePhoto(contributorId: string, familyId: string): Promise<string> {
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: `family-photos/${crypto.randomUUID()}`,
  });
  return photo.id;
}

async function subjectPhotoIdOf(storyId: string): Promise<string | null> {
  const [row] = await runtimeDb
    .select({ subjectPhotoId: stories.subjectPhotoId })
    .from(stories)
    .where(eq(stories.id, storyId));
  return row?.subjectPhotoId ?? null;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  // Subject/cover are stamped at ingest; pipeline is irrelevant for this assertion.
  runtimeDispatch = async () => {};
});
afterAll(() => {});

describe("POST /api/capture — ask subject-photo carry-forward (ADR-0009 Phase 3)", () => {
  it("when askId has 2 subject photos: first is subject/cover, rest ride as accompaniment", async () => {
    const narrator = await makePerson("Eleanor"); // link-session target / ask answerer
    const asker = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", narrator);
    await addMember(narrator, fam);
    await addMember(asker, fam);
    const photo1 = await makePhoto(asker, fam);
    const photo2 = await makePhoto(asker, fam);

    const ask = await createAsk(runtimeDb, account(asker), {
      targetPersonId: narrator,
      familyIds: [fam],
      questionText: "Tell me about these two.",
      subjectPhotoIds: [photo1, photo2],
    });
    expect(await listAskSubjectPhotos(runtimeDb, ask.id)).toEqual([photo1, photo2]);

    const { token } = await createLinkSession(runtimeDb, {
      personId: narrator,
      familyId: fam,
      invitedByPersonId: asker,
    });

    const form = new FormData();
    form.append("token", token);
    form.append("askId", ask.id);
    form.append("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "take.webm");

    const res = await POST(new Request("http://localhost/api/capture", { method: "POST", body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; storyId: string };
    expect(body.ok).toBe(true);

    expect(await subjectPhotoIdOf(body.storyId)).toBe(photo1);
    const images = await listStoryImages(runtimeDb, body.storyId);
    expect(images.map((i) => i.familyPhotoId)).toEqual([photo1, photo2]);
    expect(images[0]!.isCover).toBe(true);
    expect(images[1]!.isCover).toBe(false);
  });

  it("rejects when askId targets a different person than the link-session narrator (IDOR)", async () => {
    // Person A has a valid link-session token; Person B has an ask (targeted at B) whose subject
    // photos A can also see (shared family). Capture must NOT bind B's ask onto A's story.
    const personA = await makePerson("PersonA");
    const personB = await makePerson("PersonB");
    const asker = await makePerson("Asker");
    const fam = await makeFamily("Shared", asker);
    await addMember(personA, fam);
    await addMember(personB, fam);
    await addMember(asker, fam);
    const photo1 = await makePhoto(asker, fam);
    const photo2 = await makePhoto(asker, fam);

    const askForB = await createAsk(runtimeDb, account(asker), {
      targetPersonId: personB,
      familyIds: [fam],
      questionText: "Tell me about these — for B only.",
      subjectPhotoIds: [photo1, photo2],
    });

    const { token: tokenA } = await createLinkSession(runtimeDb, {
      personId: personA,
      familyId: fam,
      invitedByPersonId: asker,
    });

    const form = new FormData();
    form.append("token", tokenA);
    form.append("askId", askForB.id);
    form.append("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "take.webm");

    const res = await POST(new Request("http://localhost/api/capture", { method: "POST", body: form }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);

    // Reject before ingest — zero stories created.
    const storyRows = await runtimeDb.select({ id: stories.id }).from(stories);
    expect(storyRows).toHaveLength(0);

    // B's ask must remain queued (not flipped toward answered via a bound draft).
    const [askRow] = await runtimeDb
      .select({ status: asks.status, storyId: asks.storyId })
      .from(asks)
      .where(eq(asks.id, askForB.id));
    expect(askRow?.status).toBe("queued");
    expect(askRow?.storyId).toBeNull();
  });
});
