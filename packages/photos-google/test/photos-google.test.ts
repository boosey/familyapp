/**
 * Adapter tests — no live Google calls. Stubbed `fetch` verifies request shape
 * and response mapping (authorize URL, OAuth, Picker session/list/download, crypto).
 */
import { describe, expect, it, vi } from "vitest";
import {
  PHOTOS_PICKER_SCOPE,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  GooglePhotosOAuthError,
  createPickerSession,
  getPickerSession,
  listPickedPhotos,
  downloadPickedPhoto,
  GooglePhotosPickerError,
  parsePickerDurationMs,
  pickerUriForWeb,
  listPickedPhotosWhenReady,
  encryptToken,
  decryptToken,
  ScriptedGooglePhotosClient,
} from "../src/index";

const cfg = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.com/api/google-photos/callback",
};

type FetchArgs = [string | URL, RequestInit?];
function fetchStub(impl: (...args: FetchArgs) => Promise<Response>) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(impl);
}

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("buildAuthorizeUrl", () => {
  it("targets accounts.google.com with offline + consent + picker scope", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "state-abc"));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe(cfg.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(PHOTOS_PICKER_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeAuthorizationCode", () => {
  it("POSTs to oauth2.googleapis.com/token and returns tokens + email from id_token", async () => {
    // header.payload.sig — payload is {"email":"rosa@example.com"}
    const payload = Buffer.from(
      JSON.stringify({ email: "rosa@example.com" }),
    ).toString("base64url");
    const idToken = `hdr.${payload}.sig`;

    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        access_token: "access-1",
        refresh_token: "refresh-1",
        id_token: idToken,
        expires_in: 3600,
      }),
    );

    const out = await exchangeAuthorizationCode(cfg, "auth-code", {
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(out).toEqual({
      refreshToken: "refresh-1",
      accessToken: "access-1",
      email: "rosa@example.com",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe(cfg.clientId);
    expect(body.get("client_secret")).toBe(cfg.clientSecret);
    expect(body.get("redirect_uri")).toBe(cfg.redirectUri);
  });

  it("throws GooglePhotosOAuthError when refresh_token is missing", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({ access_token: "only-access" }),
    );
    await expect(
      exchangeAuthorizationCode(cfg, "code", {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(GooglePhotosOAuthError);
  });

  it("does not put access_token / refresh_token into GooglePhotosOAuthError.responseBody", async () => {
    const sampleAccess = "ya29.sample-access-token-MUST-NOT-LEAK";
    const sampleRefresh = "1//sample-refresh-token-MUST-NOT-LEAK";
    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        access_token: sampleAccess,
        // missing refresh_token → validation failure, but body still has tokens
        expires_in: 3600,
      }),
    );
    let caught: unknown;
    try {
      await exchangeAuthorizationCode(cfg, "code", {
        fetch: fetchSpy as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GooglePhotosOAuthError);
    const oauthErr = caught as GooglePhotosOAuthError;
    expect(oauthErr.responseBody).not.toContain(sampleAccess);
    expect(oauthErr.responseBody).not.toContain("access_token");
    expect(oauthErr.responseBody).not.toContain(sampleRefresh);
    expect(oauthErr.responseBody).not.toContain("refresh_token");
  });

  it("throws on non-2xx with status + redacted error body (no tokens)", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(
      exchangeAuthorizationCode(cfg, "bad", {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "GooglePhotosOAuthError",
      status: 400,
      responseBody: JSON.stringify({ error: "invalid_grant" }),
    });
  });
});

describe("refreshAccessToken", () => {
  it("POSTs refresh_token grant and returns access token", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({ access_token: "access-2", expires_in: 3599 }),
    );
    const out = await refreshAccessToken(cfg, "refresh-1", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(out).toEqual({ accessToken: "access-2", expiresIn: 3599 });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");
  });

  it("does not put access_token into GooglePhotosOAuthError.responseBody on HTTP error with tokens", async () => {
    const sampleAccess = "ya29.leaked-on-error-MUST-NOT-APPEAR";
    const fetchSpy = fetchStub(async () =>
      jsonResponse(
        { error: "invalid_grant", access_token: sampleAccess },
        { status: 400 },
      ),
    );
    let caught: unknown;
    try {
      await refreshAccessToken(cfg, "refresh-1", {
        fetch: fetchSpy as unknown as typeof fetch,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GooglePhotosOAuthError);
    const oauthErr = caught as GooglePhotosOAuthError;
    expect(oauthErr.responseBody).not.toContain(sampleAccess);
    expect(oauthErr.responseBody).not.toContain("access_token");
    expect(oauthErr.responseBody).toContain("invalid_grant");
  });
});

describe("revokeToken", () => {
  it("POSTs to oauth2.googleapis.com/revoke and swallows HTTP errors", async () => {
    const fetchSpy = fetchStub(async () => new Response("gone", { status: 400 }));
    await expect(
      revokeToken("tok", { fetch: fetchSpy as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "https://oauth2.googleapis.com/revoke",
    );
  });

  it("swallows network failures", async () => {
    const fetchSpy = fetchStub(async () => {
      throw new Error("network down");
    });
    await expect(
      revokeToken("tok", { fetch: fetchSpy as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });
});

describe("pickerUriForWeb / parsePickerDurationMs", () => {
  it("appends /autoclose once for web picker URIs", () => {
    expect(
      pickerUriForWeb("https://photospicker.googleapis.com/v1/picker/sess-1"),
    ).toBe("https://photospicker.googleapis.com/v1/picker/sess-1/autoclose");
    expect(
      pickerUriForWeb(
        "https://photospicker.googleapis.com/v1/picker/sess-1/autoclose",
      ),
    ).toBe("https://photospicker.googleapis.com/v1/picker/sess-1/autoclose");
  });

  it("accepts photos.google.com query-style URIs without rewriting /autoclose", () => {
    // Real picker URIs often carry ?sessionId=… — path-appending /autoclose can break completion.
    expect(
      pickerUriForWeb(
        "https://photos.google.com/picker?sessionId=session-123",
      ),
    ).toBe("https://photos.google.com/picker?sessionId=session-123");
  });

  it("appends /autoclose for path-style photos.google.com URIs", () => {
    expect(pickerUriForWeb("https://photos.google.com/picker/sess-1")).toBe(
      "https://photos.google.com/picker/sess-1/autoclose",
    );
  });

  it("rejects non-Google picker hosts", () => {
    expect(() => pickerUriForWeb("https://evil.example/picker")).toThrow(
      /trusted Google Photos picker host/,
    );
    expect(() => pickerUriForWeb("not-a-url")).toThrow(/not a valid URL/);
  });

  it("parses protobuf duration strings to milliseconds", () => {
    expect(parsePickerDurationMs("5s")).toBe(5000);
    expect(parsePickerDurationMs("300.5s")).toBe(300500);
    expect(parsePickerDurationMs("0s")).toBeNull();
    expect(parsePickerDurationMs(undefined)).toBeNull();
    expect(parsePickerDurationMs("bad")).toBeNull();
  });
});

describe("listPickedPhotosWhenReady", () => {
  it("retries FAILED_PRECONDITION then succeeds", async () => {
    let calls = 0;
    const fetchSpy = fetchStub(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: { code: 400, message: "not ready", status: "FAILED_PRECONDITION" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return jsonResponse({
        mediaItems: [
          {
            id: "p1",
            type: "PHOTO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/a",
              mimeType: "image/jpeg",
            },
          },
        ],
      });
    });
    const result = await listPickedPhotosWhenReady("access", "sess-1", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(result.photos).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe("createPickerSession / getPickerSession", () => {
  it("POSTs sessions and maps id + pickerUri", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        id: "sess-1",
        pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
        pollingConfig: { pollInterval: "5s", timeoutIn: "300s" },
      }),
    );
    const session = await createPickerSession("access", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(session).toEqual({
      id: "sess-1",
      pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
      pollingConfig: { pollInterval: "5s", timeoutIn: "300s" },
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://photospicker.googleapis.com/v1/sessions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe("Bearer access");
  });

  it("GETs session and reports mediaItemsSet", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        id: "sess-1",
        pickerUri: "https://photospicker.googleapis.com/v1/picker/sess-1",
        mediaItemsSet: true,
      }),
    );
    const session = await getPickerSession("access", "sess-1", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(session.mediaItemsSet).toBe(true);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "https://photospicker.googleapis.com/v1/sessions/sess-1",
    );
  });

  it("throws GooglePhotosPickerError on non-2xx", async () => {
    const fetchSpy = fetchStub(async () =>
      new Response("nope", { status: 401 }),
    );
    await expect(
      createPickerSession("bad", { fetch: fetchSpy as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(GooglePhotosPickerError);
  });
});

describe("listPickedPhotos", () => {
  it("filters VIDEO items and keeps PHOTO / image mime", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        mediaItems: [
          {
            id: "p1",
            type: "PHOTO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/a",
              mimeType: "image/jpeg",
              filename: "a.jpg",
            },
          },
          {
            id: "v1",
            type: "VIDEO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/v",
              mimeType: "video/mp4",
              filename: "v.mp4",
            },
          },
          {
            id: "p2",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/b",
              mimeType: "image/png",
              filename: "b.png",
            },
          },
        ],
      }),
    );
    const result = await listPickedPhotos("access", "sess-1", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(result.photos).toEqual([
      {
        id: "p1",
        mimeType: "image/jpeg",
        filename: "a.jpg",
        baseUrl: "https://lh3.googleusercontent.com/p/a",
      },
      {
        id: "p2",
        mimeType: "image/png",
        filename: "b.png",
        baseUrl: "https://lh3.googleusercontent.com/p/b",
      },
    ]);
    expect(result.skipped).toBe(1);
    expect(result.rejected).toBe(0);
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(
      "https://photospicker.googleapis.com/v1/mediaItems",
    );
    expect(url.searchParams.get("sessionId")).toBe("sess-1");
  });

  it("paginates with pageToken until exhausted", async () => {
    const fetchSpy = fetchStub(async (url) => {
      const u = new URL(String(url));
      if (!u.searchParams.get("pageToken")) {
        return jsonResponse({
          mediaItems: [
            {
              id: "p1",
              type: "PHOTO",
              mediaFile: {
                baseUrl: "https://lh3.googleusercontent.com/p/1",
                mimeType: "image/jpeg",
              },
            },
          ],
          nextPageToken: "page-2",
        });
      }
      return jsonResponse({
        mediaItems: [
          {
            id: "p2",
            type: "PHOTO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/2",
              mimeType: "image/jpeg",
            },
          },
        ],
      });
    });
    const result = await listPickedPhotos("access", "sess", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(result.photos.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.skipped).toBe(0);
    expect(result.rejected).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it("keeps PHOTO items when mimeType is missing (filename / default fallback)", async () => {
    const fetchSpy = fetchStub(async () =>
      jsonResponse({
        mediaItems: [
          {
            id: "p1",
            type: "PHOTO",
            mediaFile: {
              baseUrl: "https://lh3.googleusercontent.com/p/a",
              filename: "vacation.jpg",
            },
          },
        ],
      }),
    );
    const result = await listPickedPhotos("access", "sess-1", {
      fetch: fetchSpy as unknown as typeof fetch,
    });
    expect(result.photos).toEqual([
      {
        id: "p1",
        mimeType: "image/jpeg",
        filename: "vacation.jpg",
        baseUrl: "https://lh3.googleusercontent.com/p/a",
      },
    ]);
    expect(result.rejected).toBe(0);
  });
});

describe("downloadPickedPhoto", () => {
  it("GETs baseUrl with =d suffix and Bearer auth", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchSpy = fetchStub(async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const out = await downloadPickedPhoto(
      "access",
      {
        id: "p1",
        mimeType: "image/jpeg",
        filename: "a.jpg",
        baseUrl: "https://lh3.googleusercontent.com/p/AzXabC",
      },
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(out.contentType).toBe("image/jpeg");
    expect(Array.from(out.bytes)).toEqual([1, 2, 3, 4]);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://lh3.googleusercontent.com/p/AzXabC=d");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer access");
  });

  it("does not double-append =d", async () => {
    const fetchSpy = fetchStub(async () =>
      new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    await downloadPickedPhoto(
      "access",
      {
        id: "p1",
        mimeType: "image/png",
        filename: null,
        baseUrl: "https://lh3.googleusercontent.com/p/x=d",
      },
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      "https://lh3.googleusercontent.com/p/x=d",
    );
  });
});

describe("encryptToken / decryptToken", () => {
  it("round-trips plaintext", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const blob = encryptToken("refresh-secret", key);
    expect(blob).not.toContain("refresh-secret");
    expect(decryptToken(blob, key)).toBe("refresh-secret");
  });

  it("rejects wrong key length", () => {
    expect(() => encryptToken("x", new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it("rejects tampered ciphertext", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const blob = encryptToken("secret", key);
    const raw = Buffer.from(blob, "base64");
    const last = raw.length - 1;
    const prev = raw[last];
    if (prev === undefined) throw new Error("empty ciphertext");
    raw[last] = prev ^ 0xff;
    expect(() => decryptToken(raw.toString("base64"), key)).toThrow();
  });
});

describe("ScriptedGooglePhotosClient", () => {
  it("records calls and returns scripted defaults", async () => {
    const client = new ScriptedGooglePhotosClient();
    const url = client.buildAuthorizeUrl(cfg, "st");
    expect(url).toContain("state=st");
    const exchanged = await client.exchangeAuthorizationCode(cfg, "code");
    expect(exchanged.refreshToken).toBe("scripted-refresh");
    const listed = await client.listPickedPhotos("a", "s");
    expect(listed.photos).toHaveLength(1);
    expect(listed.skipped).toBe(0);
    expect(client.calls.map((c) => c.op)).toEqual([
      "buildAuthorizeUrl",
      "exchangeAuthorizationCode",
      "listPickedPhotos",
    ]);
  });
});
