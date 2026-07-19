/**
 * Album-photo byte route (issue #139 thumbnails): `GET /api/album-photo/[photoId]`.
 *
 * The route is the ONLY web surface returning album-photo bytes; every byte first passes the album
 * front door (`getAlbumPhotoForViewer`). Issue #139 adds a `?variant=thumb` variant that serves a
 * downscaled JPEG — generated lazily on first request and cached in storage — behind the IDENTICAL
 * authorization gate (an unauthorized viewer 404s the same whether or not they ask for a thumbnail).
 *
 * `@/lib/runtime` is mocked so importing the route doesn't boot the real dev runtime; `@chronicle/core`
 * is mocked to a settable `getAlbumPhotoForViewer` so we drive the authz outcome directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

let runtimeStorage: InMemoryMediaStorage;
let authCtx: AuthContext;
/** What the mocked front door returns: `{ storageKey }` when authorized, else null. */
let resolved: { storageKey: string } | null;

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: {},
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

vi.mock("@chronicle/core", () => ({
  getAlbumPhotoForViewer: async () => resolved,
}));

import { InMemoryMediaStorage } from "@chronicle/storage";
import type { AuthContext } from "@chronicle/core";
import { GET } from "@/app/api/album-photo/[photoId]/route";
import { thumbnailStorageKey, THUMBNAIL_MAX_EDGE_PX } from "@/lib/thumbnail";

const account = (personId: string): AuthContext => ({ kind: "account", personId });
const KEY = "family-photos/photo-1";

async function bigPng(width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function call(photoId: string, variant?: string): Promise<Response> {
  const qs = variant ? `?variant=${variant}` : "";
  return GET(new Request(`http://localhost/api/album-photo/${photoId}${qs}`), {
    params: Promise.resolve({ photoId }),
  });
}

beforeEach(() => {
  runtimeStorage = new InMemoryMediaStorage();
  authCtx = account("person-1");
  resolved = { storageKey: KEY };
});

describe("GET /api/album-photo/[photoId] — full resolution (default)", () => {
  it("serves the stored bytes with a sniffed content type", async () => {
    const png = await bigPng(64, 64);
    await runtimeStorage.put({ key: KEY, bytes: png, contentType: "image/png" });
    const res = await call("photo-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });
});

describe("GET /api/album-photo/[photoId]?variant=thumb — authorization parity", () => {
  it("404s an unauthorized viewer for the thumb variant, exactly like full-res", async () => {
    resolved = null; // front door denies
    await runtimeStorage.put({ key: KEY, bytes: await bigPng(64, 64), contentType: "image/png" });
    expect((await call("photo-1")).status).toBe(404);
    expect((await call("photo-1", "thumb")).status).toBe(404);
    // Nothing generated for a denied viewer.
    expect(await runtimeStorage.getBytes(thumbnailStorageKey(KEY))).toBeNull();
  });
});

describe("GET /api/album-photo/[photoId]?variant=thumb — lazy generation + cache", () => {
  it("generates a downscaled JPEG thumbnail on first request and caches it in storage", async () => {
    await runtimeStorage.put({ key: KEY, bytes: await bigPng(1600, 900), contentType: "image/png" });

    const res = await call("photo-1", "thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    const meta = await sharp(Buffer.from(body)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMBNAIL_MAX_EDGE_PX);

    // Cached at the derived key for next time.
    const cached = await runtimeStorage.getBytes(thumbnailStorageKey(KEY));
    expect(cached).not.toBeNull();
    expect(Array.from(cached!)).toEqual(Array.from(body));
  });

  it("serves the cached thumbnail on a subsequent request without regenerating", async () => {
    // Seed a SENTINEL thumbnail so we can prove the route returns it verbatim (no re-thumbnail).
    const sentinel = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    await runtimeStorage.put({ key: KEY, bytes: await bigPng(1600, 900), contentType: "image/png" });
    await runtimeStorage.put({
      key: thumbnailStorageKey(KEY),
      bytes: new Uint8Array(sentinel),
      contentType: "image/jpeg",
    });

    const res = await call("photo-1", "thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(sentinel));
  });

  it("404s when the original object is missing (never a phantom thumbnail)", async () => {
    // resolved points at KEY but nothing is stored there.
    expect((await call("photo-1", "thumb")).status).toBe(404);
  });

  it("falls back to the full-res original when the bytes are not a decodable image", async () => {
    const junk = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // "%PDF" — not an image
    await runtimeStorage.put({ key: KEY, bytes: junk, contentType: "image/jpeg" });
    const res = await call("photo-1", "thumb");
    expect(res.status).toBe(200);
    // The failure is cached as a 0-byte sentinel (issue #176) — sharp could not process it.
    const sentinel = await runtimeStorage.getBytes(thumbnailStorageKey(KEY));
    expect(sentinel).not.toBeNull();
    expect(sentinel!.byteLength).toBe(0);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(junk);
  });

  it("serves the original on later requests without re-running sharp once the sentinel exists", async () => {
    const junk = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // "%PDF" — not an image
    await runtimeStorage.put({ key: KEY, bytes: junk, contentType: "image/jpeg" });
    expect((await call("photo-1", "thumb")).status).toBe(200); // fails, writes the sentinel

    // Swap the original for a VALID image: if the route re-attempted generation, sharp would now
    // succeed and return a JPEG thumbnail. The sentinel path must serve the original bytes as-is.
    await runtimeStorage.delete(KEY);
    const png = await bigPng(64, 64);
    await runtimeStorage.put({ key: KEY, bytes: png, contentType: "image/png" });

    const res = await call("photo-1", "thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png"); // sniffed original, not the JPEG thumb
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });
});
