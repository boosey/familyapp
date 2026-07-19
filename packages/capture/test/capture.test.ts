import { AuthorizationError, getStoryForViewer } from "@chronicle/core";
import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import {
  InMemoryMediaStorage,
  type MediaStorage,
  type PutObjectInput,
} from "@chronicle/storage";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createLinkSession,
  ingestRecording,
  InvalidSessionError,
  resolveLinkSession,
  revokeLinkSession,
} from "../src/index";

let db: Database;
let storage: InMemoryMediaStorage;

beforeEach(async () => {
  db = await createTestDatabase();
  storage = new InMemoryMediaStorage();
});

function storageObjectCount(s: InMemoryMediaStorage): number {
  return s.size;
}

async function rowCount(d: Database, table: "media" | "stories"): Promise<number> {
  const result = await d.execute(
    sql.raw(`select count(*)::int as n from ${table}`),
  );
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function rowCountAny(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

async function makeNarratorAndFamily() {
  const [narrator] = await db
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
  // Both must be active members — createLinkSession gates the invite on family membership.
  await db.insert(memberships).values([
    { personId: narrator!.id, familyId: fam!.id, role: "narrator", status: "active" },
    { personId: inviter!.id, familyId: fam!.id, role: "member", status: "active" },
  ]);
  return { narrator: narrator!, inviter: inviter!, family: fam! };
}

describe("link sessions (token = identity, zero login)", () => {
  it("resolves a valid token to the narrator + family", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    const resolved = await resolveLinkSession(db, token);
    expect(resolved?.personId).toBe(narrator.id);
    expect(resolved?.familyId).toBe(family.id);
  });

  it("never stores the raw token (only its hash)", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token, session } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it("rejects an unknown token", async () => {
    expect(await resolveLinkSession(db, "not-a-real-token")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
      ttlDays: 1,
      now: issued,
    });
    const later = new Date("2026-01-03T00:00:00Z");
    expect(await resolveLinkSession(db, token, { now: later })).toBeNull();
  });

  it(
    "still resolves the narrator if the best-effort lastUsedAt write fails " +
      "(narrator page is logically a read; transient write errors must not 500)",
    async () => {
      const { narrator, inviter, family } = await makeNarratorAndFamily();
      const { token } = await createLinkSession(db, {
        personId: narrator.id,
        familyId: family.id,
        invitedByPersonId: inviter.id,
      });

      // Wrap db so .update() throws (simulates transient write failure on the lastUsedAt
      // bookkeeping). .select() still works, so the SELECT in resolveLinkSession succeeds.
      // sessions.ts must swallow the UPDATE failure and still return the resolved session.
      const flakyOnWrite = new Proxy(db, {
        get(target, prop, recv) {
          if (prop === "update") {
            return () => {
              throw new Error("simulated transient write failure");
            };
          }
          return Reflect.get(target, prop, recv);
        },
      }) as unknown as typeof db;

      const resolved = await resolveLinkSession(flakyOnWrite, token);
      expect(resolved?.personId).toBe(narrator.id);
      expect(resolved?.familyId).toBe(family.id);
    },
  );

  it("rejects a revoked token", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token, session } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    await revokeLinkSession(db, session.id);
    expect(await resolveLinkSession(db, token)).toBeNull();
  });

  it("refuses to create a session when the inviter is NOT an active member of the family", async () => {
    const { narrator, family } = await makeNarratorAndFamily();
    // A bystander with no membership in `family` must not be able to mint a narrator link.
    const [stranger] = await db
      .insert(persons)
      .values({ displayName: "Stranger", spokenName: "Stranger" })
      .returning();
    await expect(
      createLinkSession(db, {
        personId: narrator.id,
        familyId: family.id,
        invitedByPersonId: stranger!.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    // Nothing was written.
    expect(await rowCountAny("link_sessions")).toBe(0);
  });

  it("refuses to create a session when the narrator is NOT an active member of the family", async () => {
    const { inviter, family } = await makeNarratorAndFamily();
    // A person who isn't a member of `family` cannot be made the narrator of a link in it.
    const [outsiderNarrator] = await db
      .insert(persons)
      .values({ displayName: "Outsider", spokenName: "Outsider" })
      .returning();
    await expect(
      createLinkSession(db, {
        personId: outsiderNarrator!.id,
        familyId: family.id,
        invitedByPersonId: inviter.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await rowCountAny("link_sessions")).toBe(0);
  });

  it("refuses when a once-active inviter membership has ended (gate reads current status)", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    // Flip the inviter's membership to ended; the gate must now reject.
    await db.execute(
      sql`update memberships set status = 'ended' where person_id = ${inviter.id} and family_id = ${family.id}`,
    );
    await expect(
      createLinkSession(db, {
        personId: narrator.id,
        familyId: family.id,
        invitedByPersonId: inviter.id,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await rowCountAny("link_sessions")).toBe(0);
  });
});

describe("ingestRecording (capture path)", () => {
  it("persists the audio to storage AND creates a private draft story pointing at it", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });

    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const result = await ingestRecording(db, storage, {
      actor: { kind: "link_session", token },
      audio: { bytes, contentType: "audio/webm", durationSeconds: 88 },
    });

    // audio is safe in storage, with the exact bytes
    expect(await storage.exists(result.storageKey)).toBe(true);
    expect(Array.from((await storage.getBytes(result.storageKey))!)).toEqual([
      10, 20, 30, 40, 50,
    ]);

    // a draft story exists, owned by the narrator, private, pointing at the recording
    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      result.storyId,
    );
    expect(story?.ownerPersonId).toBe(narrator.id);
    expect(story?.state).toBe("draft");
    expect(story?.audienceTier).toBe("private");
    expect(story?.recordingMediaId).toBe(result.recordingMediaId);
  });

  it("rejects an invalid session and writes NOTHING (no orphan audio row, no story, no blob)", async () => {
    await expect(
      ingestRecording(db, storage, {
        actor: { kind: "link_session", token: "bogus" },
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    // Storage has ZERO objects (not just "the key we tried is absent" — every key is absent).
    expect(storageObjectCount(storage)).toBe(0);
    // The content tables are empty — no Media row, no Story row.
    const mediaCount = await rowCount(db, "media");
    const storyCount = await rowCount(db, "stories");
    expect(mediaCount).toBe(0);
    expect(storyCount).toBe(0);
  });

  it(
    "if the DB write fails after the storage upload, the canonical audio is preserved " +
      "(authenticity-beats-polish trade-off) and NO Story is created",
    async () => {
      // The capture-path ordering is deliberate (DECISIONS.md): audio first, then DB. If the DB
      // write fails, the narrator's voice is still durable in object storage — recoverable evidence
      // is the lesser evil than a vanished recording. This test pins that contract.
      const { narrator, inviter, family } = await makeNarratorAndFamily();
      const { token } = await createLinkSession(db, {
        personId: narrator.id,
        familyId: family.id,
        invitedByPersonId: inviter.id,
      });

      // Make the DB write fail by dropping the stories table out from under the transaction.
      // The Media insert is the first DB op inside persistRecordingAndCreateDraft and will succeed,
      // but the Story insert will throw, rolling back the whole transaction — so neither row
      // persists, and we are left with exactly the "audio in storage, no DB rows" case.
      await db.execute(sql`DROP TABLE stories CASCADE`);

      await expect(
        ingestRecording(db, storage, {
          actor: { kind: "link_session", token },
          audio: {
            bytes: new Uint8Array([99, 99, 99]),
            contentType: "audio/webm",
          },
        }),
      ).rejects.toThrow();

      // Storage: the blob IS present (audio is preserved on partial failure).
      expect(storageObjectCount(storage)).toBe(1);
      // DB: media is empty (the Media insert was rolled back with the transaction).
      const mediaCount = await rowCount(db, "media");
      expect(mediaCount).toBe(0);
    },
  );

  it("if storage.put fails, NEITHER an orphan blob NOR a DB row is created", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });

    const failingStorage: MediaStorage = {
      put: async (_input: PutObjectInput) => {
        throw new Error("simulated R2 outage");
      },
      getBytes: async () => null,
      exists: async () => false,
      getUrl: async (k: string) => `nowhere://${k}`,
      createUploadTarget: async ({ key, contentType }) => ({
        method: "PUT" as const,
        url: `nowhere://${key}`,
        headers: { "Content-Type": contentType },
      }),
      delete: async () => {},
      list: async () => [],
    };

    await expect(
      ingestRecording(db, failingStorage, {
        actor: { kind: "link_session", token },
        audio: { bytes: new Uint8Array([7, 7]), contentType: "audio/webm" },
      }),
    ).rejects.toThrow(/simulated R2 outage/);

    const mediaCount = await rowCount(db, "media");
    const storyCount = await rowCount(db, "stories");
    expect(mediaCount).toBe(0);
    expect(storyCount).toBe(0);
  });

  it("a fresh draft is invisible to family members (private until approval)", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    const { storyId } = await ingestRecording(db, storage, {
      actor: { kind: "link_session", token },
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

  // ── account-actor branch (ADR-0003) ────────────────────────────────────────

  it("account actor: persists a draft owned by the signed-in person (no token needed)", async () => {
    // Simulates the in-hub answer flow: the web auth layer has already resolved the cookie to a
    // personId before calling capture.  capture trusts it directly and just checks the person row exists.
    const { narrator } = await makeNarratorAndFamily();
    const bytes = new Uint8Array([11, 22, 33]);
    const result = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: narrator.id },
      audio: { bytes, contentType: "audio/webm", durationSeconds: 5 },
    });

    // Audio is durable in storage.
    expect(await storage.exists(result.storageKey)).toBe(true);
    expect(Array.from((await storage.getBytes(result.storageKey))!)).toEqual([11, 22, 33]);

    // Draft story is owned by the narrator and is private.
    const story = await getStoryForViewer(
      db,
      { kind: "account", personId: narrator.id },
      result.storyId,
    );
    expect(story?.ownerPersonId).toBe(narrator.id);
    expect(story?.state).toBe("draft");
    expect(story?.audienceTier).toBe("private");
    expect(story?.recordingMediaId).toBe(result.recordingMediaId);
  });

  it("link_session capture stamps the session's family onto the draft as its originating context (ADR-0010)", async () => {
    const { narrator, inviter, family } = await makeNarratorAndFamily();
    const { token } = await createLinkSession(db, {
      personId: narrator.id,
      familyId: family.id,
      invitedByPersonId: inviter.id,
    });
    const { storyId } = await ingestRecording(db, storage, {
      actor: { kind: "link_session", token },
      audio: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" },
    });
    const story = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      storyId,
    );
    // The originating family is the link session's family — the signal approval default-targets on.
    expect(story?.originatingFamilyId).toBe(family.id);
  });

  it("account capture leaves originatingFamilyId null (no session family)", async () => {
    const { narrator } = await makeNarratorAndFamily();
    const { storyId } = await ingestRecording(db, storage, {
      actor: { kind: "account", personId: narrator.id },
      audio: { bytes: new Uint8Array([4, 5]), contentType: "audio/webm" },
    });
    const story = await getStoryForViewer(
      db,
      { kind: "account", personId: narrator.id },
      storyId,
    );
    expect(story?.originatingFamilyId).toBeNull();
  });

  it("account actor: rejects a phantom personId that has no row in persons (InvalidSessionError)", async () => {
    // A manually-crafted request that bypasses auth might supply a non-existent personId.
    // capture must reject it before touching storage or DB content tables.
    const phantomId = "00000000-0000-0000-0000-000000000000";
    await expect(
      ingestRecording(db, storage, {
        actor: { kind: "account", personId: phantomId },
        audio: { bytes: new Uint8Array([1]), contentType: "audio/webm" },
      }),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    // Nothing written.
    expect(storageObjectCount(storage)).toBe(0);
    expect(await rowCount(db, "media")).toBe(0);
    expect(await rowCount(db, "stories")).toBe(0);
  });
});
