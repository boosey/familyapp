import { getStoryForViewer } from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { families, persons } from "@chronicle/db/schema";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createElderSession,
  ingestRecording,
  InvalidSessionError,
  resolveElderSession,
  revokeElderSession,
} from "../src/index";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

async function makeElderAndFamily() {
  const [elder] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor" })
    .returning();
  const [inviter] = await db
    .insert(persons)
    .values({ displayName: "Sofia", spokenName: "Sofia" })
    .returning();
  const [fam] = await db
    .insert(families)
    .values({
      name: "Boudreaux",
      creatorPersonId: inviter!.id,
      stewardPersonId: inviter!.id,
    })
    .returning();
  return { elder: elder!, inviter: inviter!, family: fam! };
}

describe("elder sessions (token = identity, zero login)", () => {
  it("resolves a valid token to the elder + family", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const { token } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    const resolved = await resolveElderSession(db, token);
    expect(resolved?.personId).toBe(elder.id);
    expect(resolved?.familyId).toBe(family.id);
  });

  it("never stores the raw token (only its hash)", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const { token, session } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it("rejects an unknown token", async () => {
    expect(await resolveElderSession(db, "not-a-real-token")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
      ttlDays: 1,
      now: issued,
    });
    const later = new Date("2026-01-03T00:00:00Z");
    expect(await resolveElderSession(db, token, { now: later })).toBeNull();
  });

  it("rejects a revoked token", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const { token, session } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    await revokeElderSession(db, session.id);
    expect(await resolveElderSession(db, token)).toBeNull();
  });
});

describe("ingestRecording (capture path)", () => {
  it("persists the audio to storage AND creates a private draft story pointing at it", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const { token } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });

    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const result = await ingestRecording(db, storage, {
      sessionToken: token,
      audio: { bytes, contentType: "audio/webm", durationSeconds: 88 },
    });

    // audio is safe in storage, with the exact bytes
    expect(await storage.exists(result.storageKey)).toBe(true);
    expect(Array.from((await storage.getBytes(result.storageKey))!)).toEqual([
      10, 20, 30, 40, 50,
    ]);

    // a draft story exists, owned by the elder, private, pointing at the recording
    const story = await getStoryForViewer(
      db,
      { kind: "elder_session", personId: elder.id },
      result.storyId,
    );
    expect(story?.ownerPersonId).toBe(elder.id);
    expect(story?.state).toBe("draft");
    expect(story?.audienceTier).toBe("private");
    expect(story?.recordingMediaId).toBe(result.recordingMediaId);
  });

  it("rejects an invalid session and writes NOTHING (no orphan audio, no story)", async () => {
    await expect(
      ingestRecording(db, storage, {
        sessionToken: "bogus",
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    // storage untouched
    expect(await storage.getBytes("anything")).toBeNull();
  });

  it("a fresh draft is invisible to family members (private until approval)", async () => {
    const { elder, inviter, family } = await makeElderAndFamily();
    const { token } = await createElderSession(db, {
      personId: elder.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    const { storyId } = await ingestRecording(db, storage, {
      sessionToken: token,
      audio: { bytes: new Uint8Array([1, 2]), contentType: "audio/webm" },
    });
    // inviter is a family member; they must NOT see the private draft
    const seen = await getStoryForViewer(
      db,
      { kind: "account", personId: inviter.id },
      storyId,
    );
    expect(seen).toBeNull();
  });
});
