/**
 * Dev-only direct-upload receiver route (issue #20): `PUT /api/media-upload/[key]`.
 *
 * In production the browser PUTs to a presigned R2 URL, never here — so this route 404s in any durable
 * deploy. In dev it re-enforces every rule R2's presign would: auth, a valid HMAC ticket bound to
 * THIS person + THIS key, the `family-photos/` keyspace, and write-once. The bytes land via storage.put.
 *
 * `@/lib/runtime` is mocked so importing the route doesn't boot the real dev runtime; `isDurableDeploy`
 * is a settable module binding so we can flip the durable-vs-dev branch. `getRuntime()` reads settable
 * storage + auth bindings.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

let runtimeStorage: InMemoryMediaStorage;
let authCtx: AuthContext;
let durable = false;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
  isDurableDeploy: () => durable,
}));

import { InMemoryMediaStorage } from "@chronicle/storage";
import type { AuthContext } from "@chronicle/core";
import { PUT } from "@/app/api/media-upload/[key]/route";
import { createUploadTicket } from "@/lib/upload-ticket";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PERSON = "person-1";
const KEY = "family-photos/abc-123";

/** The route reads the key from the [key] segment URL-encoded (a single path segment). */
function call(
  encodedKey: string,
  opts: { ticket?: string | null; body?: Uint8Array; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "image/png",
  };
  if (opts.ticket) headers["x-upload-ticket"] = opts.ticket;
  const body = opts.body ?? PNG_BYTES;
  return PUT(
    new Request(`http://localhost/api/media-upload/${encodedKey}`, {
      method: "PUT",
      headers,
      body: body as BodyInit,
    }),
    { params: Promise.resolve({ key: encodedKey }) },
  );
}

beforeEach(() => {
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = account(PERSON);
  durable = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/media-upload/[key] (dev receiver)", () => {
  it("stores the bytes for an authed caller with a valid ticket + keyspace", async () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(200);
    expect(await runtimeStorage.getBytes(KEY)).toEqual(PNG_BYTES);
  });

  it("404s in a durable/Vercel deploy (R2 presign points at R2, never here)", async () => {
    durable = true;
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(404);
    expect(runtimeStorage.size).toBe(0);
  });

  it("401s an anonymous caller", async () => {
    authCtx = { kind: "anonymous" };
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(401);
    expect(runtimeStorage.size).toBe(0);
  });

  it("403s when the ticket is missing", async () => {
    const res = await call(encodeURIComponent(KEY), { ticket: null });
    expect(res.status).toBe(403);
    expect(runtimeStorage.size).toBe(0);
  });

  it("403s a FOREIGN ticket (minted for another person)", async () => {
    const ticket = createUploadTicket({ key: KEY, personId: "someone-else" });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(403);
    expect(runtimeStorage.size).toBe(0);
  });

  it("403s a ticket bound to a DIFFERENT key than the path", async () => {
    const ticket = createUploadTicket({ key: "family-photos/other", personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(403);
    expect(runtimeStorage.size).toBe(0);
  });

  it("403s a key OUTSIDE the family-photos/ keyspace (even with a matching ticket)", async () => {
    const evilKey = "rec/evil.webm";
    const ticket = createUploadTicket({ key: evilKey, personId: PERSON });
    const res = await call(encodeURIComponent(evilKey), { ticket });
    expect(res.status).toBe(403);
    expect(runtimeStorage.size).toBe(0);
  });

  it("409s on a write-once conflict (an object already lives at the key)", async () => {
    await runtimeStorage.put({ key: KEY, bytes: PNG_BYTES, contentType: "image/png" });
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket });
    expect(res.status).toBe(409);
    // The original object is untouched.
    expect(runtimeStorage.size).toBe(1);
  });

  it("400s an empty body", async () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket, body: new Uint8Array([]) });
    expect(res.status).toBe(400);
    expect(runtimeStorage.size).toBe(0);
  });

  it("415s a non-image content type (parity with the presign content-type gate)", async () => {
    const ticket = createUploadTicket({ key: KEY, personId: PERSON });
    const res = await call(encodeURIComponent(KEY), { ticket, contentType: "application/pdf" });
    expect(res.status).toBe(415);
    expect(runtimeStorage.size).toBe(0);
  });

  it("accepts every allowed image content type", async () => {
    for (const ct of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
      runtimeStorage = new InMemoryMediaStorage();
      const key = `family-photos/${ct.replace("/", "-")}`;
      const ticket = createUploadTicket({ key, personId: PERSON });
      const res = await call(encodeURIComponent(key), { ticket, contentType: ct });
      expect(res.status).toBe(200);
      expect(await runtimeStorage.getBytes(key)).toEqual(PNG_BYTES);
    }
  });
});
