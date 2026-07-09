import { beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    dispatchPipeline: async () => {},
  }),
}));

// Mock next/navigation redirect and revalidatePath
const redirectMock = vi.fn();
const revalidatePathMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    // Next.js redirect throws a specific error to halt execution
    throw new Error(`NEXT_REDIRECT: ${path}`);
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidatePathMock(path);
  },
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { getStoryForViewer, persistRecordingAndCreateDraft } from "@chronicle/core";
import { deleteStoryAction } from "../app/hub/stories/[id]/actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.append(k, v);
  }
  return fd;
}

describe("deleteStoryAction", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    vi.clearAllMocks();
  });

  it("allows owner to delete their story and deletes storage keys", async () => {
    // 1. Create owner
    const [owner] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Eleanor", spokenName: "Eleanor" })
      .returning();

    // Use persistRecordingAndCreateDraft to create a valid draft
    const storageKey = "recordings/eleanor-1.webm";
    const { story } = await persistRecordingAndCreateDraft(runtimeDb, {
      ownerPersonId: owner!.id,
      storageKey,
      contentType: "audio/webm",
      checksum: "sha256:take0",
    });

    // Add key to in-memory storage using .put()
    await runtimeStorage.put({ key: storageKey, bytes: Buffer.from("fake audio data"), contentType: "audio/webm" });

    // Set auth context to owner
    authCtx = { kind: "account", personId: owner!.id };

    // 2. Call delete action
    let thrownError: Error | null = null;
    try {
      await deleteStoryAction(form({ storyId: story.id }));
    } catch (e) {
      thrownError = e as Error;
    }

    // Next.js redirect throws a specific control-flow error
    expect(thrownError?.message).toContain("NEXT_REDIRECT: /hub");
    expect(redirectMock).toHaveBeenCalledWith("/hub");
    expect(revalidatePathMock).toHaveBeenCalledWith("/hub");

    // 3. Verify story is deleted from DB
    const viewerCtx = { kind: "account" as const, personId: owner!.id };
    const fetched = await getStoryForViewer(runtimeDb, viewerCtx, story.id);
    expect(fetched).toBeNull();

    // 4. Verify storage key is deleted (polling to allow async deletion to finish)
    let exists = true;
    for (let i = 0; i < 20; i++) {
      exists = await runtimeStorage.exists(storageKey);
      if (!exists) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(exists).toBe(false);
  });

  it("rejects non-owner delete and leaves story and storage intact", async () => {
    const [owner] = await runtimeDb.insert(persons).values({ displayName: "Eleanor", spokenName: "Eleanor" }).returning();
    const [other] = await runtimeDb.insert(persons).values({ displayName: "Other", spokenName: "Other" }).returning();

    const storageKey = "recordings/eleanor-2.webm";
    const { story } = await persistRecordingAndCreateDraft(runtimeDb, {
      ownerPersonId: owner!.id,
      storageKey,
      contentType: "audio/webm",
      checksum: "sha256:take0",
    });

    await runtimeStorage.put({ key: storageKey, bytes: Buffer.from("fake audio data"), contentType: "audio/webm" });

    // Set auth context to other person
    authCtx = { kind: "account", personId: other!.id };

    const result = await deleteStoryAction(form({ storyId: story.id }));

    expect(result).toEqual({ error: expect.stringContaining("neither the owner nor a steward") });
    expect(redirectMock).not.toHaveBeenCalled();

    // Verify story and storage key still exist
    const viewerCtx = { kind: "account" as const, personId: owner!.id };
    const fetched = await getStoryForViewer(runtimeDb, viewerCtx, story.id);
    expect(fetched).not.toBeNull();

    const exists = await runtimeStorage.exists(storageKey);
    expect(exists).toBe(true);
  });
});
