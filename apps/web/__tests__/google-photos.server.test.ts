/**
 * Google Photos Phase 5 Slice B — config, connection vault, OAuth state, import actions, routes.
 *
 * Harness mirrors album.server.test.ts: `@/lib/runtime` mocked; Google deps injected via
 * `setGooglePhotosDepsForTests` (ScriptedGooglePhotosClient-shaped fns). No live Google.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const TEST_KEY = Buffer.alloc(32, 7);
const TEST_KEY_B64 = TEST_KEY.toString("base64");

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

// Cookie jar for OAuth state routes — mutable map.
const cookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import { listAlbumPhotos, type AuthContext } from "@chronicle/core";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { ScriptedGooglePhotosClient } from "@chronicle/photos-google";
import {
  getGooglePhotosEncryptionKey,
  getGooglePhotosOAuthConfig,
  isGooglePhotosConfigured,
  setGooglePhotosDepsForTests,
  type GooglePhotosDeps,
} from "@/lib/google-photos-config";
import {
  decryptConnectionRefreshToken,
  disconnectGooglePhotosConnection,
  getActiveGooglePhotosConnection,
  upsertGooglePhotosConnection,
} from "@/lib/google-photos-connection";
import {
  createOAuthState,
  GOOGLE_PHOTOS_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/google-photos-oauth-state";
import {
  completeGooglePhotosImportAction,
  disconnectGooglePhotosAction,
  importOneGooglePhotoAction,
  listGooglePhotosImportAction,
  pollGooglePhotosImportAction,
  startGooglePhotosImportAction,
} from "@/app/hub/album/google-photos-actions";
import { GET as connectGet } from "@/app/api/google-photos/connect/route";
import { GET as callbackGet } from "@/app/api/google-photos/callback/route";
import { hub } from "@/app/_copy";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

const ENV_KEYS = [
  "GOOGLE_PHOTOS_CLIENT_ID",
  "GOOGLE_PHOTOS_CLIENT_SECRET",
  "GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY",
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

function stubConfiguredEnv() {
  vi.stubEnv("GOOGLE_PHOTOS_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_PHOTOS_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY", TEST_KEY_B64);
  vi.stubEnv("APP_BASE_URL", "https://app.example.com");
}

function depsFromScripted(client: ScriptedGooglePhotosClient): GooglePhotosDeps {
  return {
    buildAuthorizeUrl: (cfg, state) => client.buildAuthorizeUrl(cfg, state),
    exchangeAuthorizationCode: (cfg, code) =>
      client.exchangeAuthorizationCode(cfg, code),
    refreshAccessToken: (cfg, refresh) => client.refreshAccessToken(cfg, refresh),
    revokeToken: (token) => client.revokeToken(token),
    createPickerSession: (access) => client.createPickerSession(access),
    getPickerSession: (access, id) => client.getPickerSession(access, id),
    listPickedPhotos: (access, id) => client.listPickedPhotos(access, id),
    downloadPickedPhoto: (access, item) => client.downloadPickedPhoto(access, item),
  };
}

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

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = { kind: "anonymous" };
  cookieStore.clear();
  setGooglePhotosDepsForTests(null);
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  setGooglePhotosDepsForTests(null);
  vi.unstubAllEnvs();
});

describe("isGooglePhotosConfigured / getGooglePhotosOAuthConfig", () => {
  it("is false when any required env is missing", () => {
    expect(isGooglePhotosConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_PHOTOS_CLIENT_ID", "x");
    expect(isGooglePhotosConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_PHOTOS_CLIENT_SECRET", "y");
    expect(isGooglePhotosConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY", TEST_KEY_B64);
    expect(isGooglePhotosConfigured()).toBe(true);
  });

  it("builds redirectUri from APP_BASE_URL", () => {
    stubConfiguredEnv();
    const cfg = getGooglePhotosOAuthConfig();
    expect(cfg.redirectUri).toBe(
      "https://app.example.com/api/google-photos/callback",
    );
    expect(cfg.clientId).toBe("client-id");
  });

  it("decodes a 32-byte encryption key from base64", () => {
    stubConfiguredEnv();
    expect(getGooglePhotosEncryptionKey()).toEqual(TEST_KEY);
  });
});

describe("OAuth state signing", () => {
  it("round-trips personId and rejects tamper / expiry", () => {
    stubConfiguredEnv();
    const state = createOAuthState("person-1", 1_000_000);
    expect(verifyOAuthState(state, 1_000_000 + 1000)?.personId).toBe("person-1");
    expect(verifyOAuthState(state, 1_000_000 + 11 * 60 * 1000)).toBeNull();

    const parts = state.split(".");
    parts[3] = createHmac("sha256", TEST_KEY).update("tampered").digest("base64url");
    expect(verifyOAuthState(parts.join("."), 1_000_000 + 1000)).toBeNull();
  });
});

describe("google-photos-connection vault", () => {
  it("upserts encrypted token, getActive returns it, disconnect deletes", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");

    const row = await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: "rosa@example.com",
    });
    expect(row.encryptedRefreshToken).not.toContain("refresh-secret");
    expect(row.googleAccountEmail).toBe("rosa@example.com");
    expect(row.revokedAt).toBeNull();

    const active = await getActiveGooglePhotosConnection(runtimeDb, personId);
    expect(active?.personId).toBe(personId);
    expect(decryptConnectionRefreshToken(active!)).toBe("refresh-secret");

    // Re-upsert replaces token
    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-2",
      email: "rosa@example.com",
    });
    const again = await getActiveGooglePhotosConnection(runtimeDb, personId);
    expect(decryptConnectionRefreshToken(again!)).toBe("refresh-2");

    const disc = await disconnectGooglePhotosConnection(runtimeDb, personId);
    expect(disc.deleted).toBe(true);
    expect(disc.refreshTokenPlain).toBe("refresh-2");
    expect(await getActiveGooglePhotosConnection(runtimeDb, personId)).toBeNull();
  });
});

describe("import actions", () => {
  it("denies unauthenticated callers", async () => {
    stubConfiguredEnv();
    authCtx = { kind: "anonymous" };
    expect(await startGooglePhotosImportAction()).toEqual({
      error: hub.actions.notSignedIn,
    });
    expect(await disconnectGooglePhotosAction()).toEqual({
      error: hub.actions.notSignedIn,
    });
  });

  it("happy path: start → poll → complete imports with google_picker source", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", personId);
    await addMember(personId, familyId);
    authCtx = account(personId);

    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: "rosa@example.com",
    });

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const client = new ScriptedGooglePhotosClient({
      refresh: { accessToken: "access-tok", expiresIn: 3600 },
      createSession: {
        id: "sess-1",
        pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
      },
      getSession: {
        id: "sess-1",
        pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
        mediaItemsSet: true,
      },
      listPhotos: {
        photos: [
          {
            id: "p1",
            mimeType: "image/png",
            filename: "a.png",
            baseUrl: "https://lh3.googleusercontent.com/p/a",
          },
        ],
        skipped: 1,
      },
      download: { bytes: png, contentType: "image/png" },
    });
    setGooglePhotosDepsForTests(depsFromScripted(client));

    const started = await startGooglePhotosImportAction();
    expect(started).toEqual({
      ok: true,
      sessionId: "sess-1",
      pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
      pollIntervalMs: 2000,
      pollTimeoutMs: 5 * 60 * 1000,
    });

    const polled = await pollGooglePhotosImportAction("sess-1");
    expect(polled).toEqual({ ok: true, mediaItemsSet: true });

    const fd = new FormData();
    fd.append("sessionId", "sess-1");
    fd.append("familyIds", familyId);
    const completed = await completeGooglePhotosImportAction(fd);
    expect(completed).toEqual({ ok: true, added: 1, failed: 0, skipped: 1, rejected: 0 });

    const album = await listAlbumPhotos(runtimeDb, account(personId), familyId);
    expect(album).toHaveLength(1);
    expect(album[0]!.source).toBe("google_picker");
    expect(album[0]!.storageKey.startsWith("family-photos/")).toBe(true);
    expect(await runtimeStorage.getBytes(album[0]!.storageKey)).toEqual(png);
  });

  it("disconnect clears the vault and best-effort revokes", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: null,
    });
    const client = new ScriptedGooglePhotosClient();
    setGooglePhotosDepsForTests(depsFromScripted(client));

    const result = await disconnectGooglePhotosAction();
    expect(result).toEqual({ ok: true });
    expect(await getActiveGooglePhotosConnection(runtimeDb, personId)).toBeNull();
    expect(client.calls.some((c) => c.op === "revokeToken")).toBe(true);
  });
});

// ADR-0015 · F2 — the Google split: a list-first step (exact-N handles) followed by per-item
// download+create, so Google reaches the same exact-N placeholder UX as file upload.
describe("per-item Google import (ADR-0015)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

  function scriptedForImport(personIsMember = true) {
    return new ScriptedGooglePhotosClient({
      refresh: { accessToken: "access-tok", expiresIn: 3600 },
      listPhotos: {
        photos: [
          {
            id: "p1",
            mimeType: "image/png",
            filename: "a.png",
            baseUrl: "https://lh3.googleusercontent.com/p/a",
          },
        ],
        skipped: 1,
      },
      download: { bytes: PNG, contentType: "image/png" },
    });
  }

  it("listGooglePhotosImportAction returns exact-N handles with skipped/rejected", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: "rosa@example.com",
    });
    setGooglePhotosDepsForTests(depsFromScripted(scriptedForImport()));

    const result = await listGooglePhotosImportAction("sess-1");
    expect(result).toEqual({
      ok: true,
      count: 1,
      items: [
        {
          id: "p1",
          mimeType: "image/png",
          filename: "a.png",
          baseUrl: "https://lh3.googleusercontent.com/p/a",
        },
      ],
      skipped: 1,
      rejected: 0,
    });
  });

  it("listGooglePhotosImportAction denies anonymous callers", async () => {
    stubConfiguredEnv();
    authCtx = { kind: "anonymous" };
    expect(await listGooglePhotosImportAction("sess-1")).toEqual({
      error: hub.actions.notSignedIn,
    });
  });

  it("importOneGooglePhotoAction downloads one handle and creates a google_picker photo", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    const familyId = await makeFamily("Esposito", personId);
    await addMember(personId, familyId);
    authCtx = account(personId);
    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: "rosa@example.com",
    });
    setGooglePhotosDepsForTests(depsFromScripted(scriptedForImport()));

    const fd = new FormData();
    fd.append("id", "p1");
    fd.append("mimeType", "image/png");
    fd.append("filename", "a.png");
    fd.append("baseUrl", "https://lh3.googleusercontent.com/p/a");
    fd.append("familyIds", familyId);

    const result = await importOneGooglePhotoAction(fd);
    expect(result).toEqual({ ok: true });

    const album = await listAlbumPhotos(runtimeDb, account(personId), familyId);
    expect(album).toHaveLength(1);
    expect(album[0]!.source).toBe("google_picker");
    expect(await runtimeStorage.getBytes(album[0]!.storageKey)).toEqual(PNG);
  });

  it("importOneGooglePhotoAction denies anonymous callers", async () => {
    stubConfiguredEnv();
    authCtx = { kind: "anonymous" };
    const fd = new FormData();
    fd.append("id", "p1");
    fd.append("baseUrl", "https://lh3.googleusercontent.com/p/a");
    expect(await importOneGooglePhotoAction(fd)).toEqual({
      error: hub.actions.notSignedIn,
    });
  });

  it("importOneGooglePhotoAction re-validates family membership (drops a spoofed family id)", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    const outsider = await makePerson("Vito");
    const famA = await makeFamily("Esposito", personId);
    const famX = await makeFamily("Corleone", outsider);
    await addMember(personId, famA);
    await addMember(outsider, famX);
    authCtx = account(personId);
    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "refresh-secret",
      email: "rosa@example.com",
    });
    setGooglePhotosDepsForTests(depsFromScripted(scriptedForImport()));

    const fd = new FormData();
    fd.append("id", "p1");
    fd.append("mimeType", "image/png");
    fd.append("baseUrl", "https://lh3.googleusercontent.com/p/a");
    // Submit ONLY a foreign family id; the caller's sole owned family (famA) is used instead.
    fd.append("familyIds", famX);

    const result = await importOneGooglePhotoAction(fd);
    expect(result).toEqual({ ok: true });

    const albumA = await listAlbumPhotos(runtimeDb, account(personId), famA);
    expect(albumA).toHaveLength(1);
    const albumX = await listAlbumPhotos(runtimeDb, account(outsider), famX);
    expect(albumX).toEqual([]);
  });

  it("importOneGooglePhotoAction rejects a missing baseUrl handle", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    const fd = new FormData();
    fd.append("id", "p1");
    expect(await importOneGooglePhotoAction(fd)).toEqual({
      error: hub.actions.invalidInput,
    });
  });
});

describe("OAuth routes", () => {
  it("connect returns 503 when unconfigured", async () => {
    authCtx = account("anyone");
    const res = await connectGet(new Request("http://localhost:3000/api/google-photos/connect"));
    expect(res.status).toBe(503);
  });

  it("connect redirects anonymous to sign-in", async () => {
    stubConfiguredEnv();
    authCtx = { kind: "anonymous" };
    const res = await connectGet(new Request("http://localhost:3000/api/google-photos/connect"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sign-in");
  });

  it("connect sets state cookie and redirects to Google", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    const client = new ScriptedGooglePhotosClient({
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?scripted=1",
    });
    setGooglePhotosDepsForTests(depsFromScripted(client));

    const res = await connectGet(new Request("http://localhost:3000/api/google-photos/connect"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("accounts.google.com");
    const state = cookieStore.get(GOOGLE_PHOTOS_STATE_COOKIE);
    expect(state).toBeTruthy();
    expect(verifyOAuthState(state!)?.personId).toBe(personId);
  });

  it("callback exchanges code and upserts connection", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    const state = createOAuthState(personId);
    cookieStore.set(GOOGLE_PHOTOS_STATE_COOKIE, state);

    const client = new ScriptedGooglePhotosClient({
      exchange: {
        refreshToken: "new-refresh",
        accessToken: "access",
        email: "rosa@example.com",
      },
    });
    setGooglePhotosDepsForTests(depsFromScripted(client));

    const reqUrl = new URL("http://localhost:3000/api/google-photos/callback");
    reqUrl.searchParams.set("code", "auth-code");
    reqUrl.searchParams.set("state", state);
    const res = await callbackGet(new Request(reqUrl.toString()));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("tab=album");
    expect(res.headers.get("location")).toContain("googlePhotos=connected");

    const conn = await getActiveGooglePhotosConnection(runtimeDb, personId);
    expect(conn).not.toBeNull();
    expect(decryptConnectionRefreshToken(conn!)).toBe("new-refresh");
    expect(cookieStore.has(GOOGLE_PHOTOS_STATE_COOKIE)).toBe(false);
  });

  it("callback reconnect revokes the old refresh token before upserting the new one", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);

    await upsertGooglePhotosConnection(runtimeDb, {
      personId,
      refreshTokenPlain: "old-refresh-token",
      email: "rosa@example.com",
    });

    const state = createOAuthState(personId);
    cookieStore.set(GOOGLE_PHOTOS_STATE_COOKIE, state);

    const client = new ScriptedGooglePhotosClient({
      exchange: {
        refreshToken: "new-refresh-token",
        accessToken: "access",
        email: "rosa@example.com",
      },
    });
    setGooglePhotosDepsForTests(depsFromScripted(client));

    const reqUrl = new URL("http://localhost:3000/api/google-photos/callback");
    reqUrl.searchParams.set("code", "auth-code");
    reqUrl.searchParams.set("state", state);
    const res = await callbackGet(new Request(reqUrl.toString()));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("googlePhotos=connected");

    const revokeCalls = client.calls.filter((c) => c.op === "revokeToken");
    expect(revokeCalls).toHaveLength(1);
    expect(revokeCalls[0]!.args[0]).toBe("old-refresh-token");

    const conn = await getActiveGooglePhotosConnection(runtimeDb, personId);
    expect(conn).not.toBeNull();
    expect(decryptConnectionRefreshToken(conn!)).toBe("new-refresh-token");
  });

  it("callback rejects mismatched state", async () => {
    stubConfiguredEnv();
    const personId = await makePerson("Rosa");
    authCtx = account(personId);
    cookieStore.set(GOOGLE_PHOTOS_STATE_COOKIE, createOAuthState(personId));

    const reqUrl = new URL("http://localhost:3000/api/google-photos/callback");
    reqUrl.searchParams.set("code", "auth-code");
    reqUrl.searchParams.set("state", "totally-wrong");
    const res = await callbackGet(new Request(reqUrl.toString()));
    expect(res.headers.get("location")).toContain("googlePhotosError=invalid_state");
    expect(await getActiveGooglePhotosConnection(runtimeDb, personId)).toBeNull();
  });
});
