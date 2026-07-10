/**
 * Google OAuth for Photos Picker (connect-once).
 *
 * Hosts locked by Phase 5 contract:
 * - authorize: https://accounts.google.com/o/oauth2/v2/auth
 * - token:     https://oauth2.googleapis.com/token
 * - revoke:    https://oauth2.googleapis.com/revoke
 *
 * Scope is Picker-only (no Library browse). `access_type=offline` + `prompt=consent`
 * so Google issues a refresh token on every Connect.
 */

export const PHOTOS_PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GooglePhotosOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GooglePhotosConnection {
  /** Plaintext in memory only — encrypt before persisting. */
  refreshToken: string;
  googleAccountEmail?: string | null;
}

export class GooglePhotosOAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = "GooglePhotosOAuthError";
  }
}

type FetchLike = typeof fetch;

function resolveFetch(opts?: { fetch?: FetchLike }): FetchLike {
  return opts?.fetch ?? fetch;
}

/** Build the Google OAuth authorize URL (offline access, consent). */
export function buildAuthorizeUrl(
  cfg: GooglePhotosOAuthConfig,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PHOTOS_PICKER_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postForm(
  url: string,
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<{ status: number; text: string; json: TokenResponse | null }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await safeReadBody(res);
  let json: TokenResponse | null = null;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

/**
 * Body attached to GooglePhotosOAuthError — never include access_token / refresh_token /
 * id_token (success-shaped responses that fail validation, or mixed error payloads).
 * Prefer `json.error` (+ optional description) only.
 */
function safeOAuthErrorBody(
  json: TokenResponse | null,
  text: string,
): string {
  const hasTokenKeys =
    Boolean(json?.access_token) ||
    Boolean(json?.refresh_token) ||
    Boolean(json?.id_token) ||
    /["']?(?:access_token|refresh_token|id_token)["']?\s*:/i.test(text);

  if (hasTokenKeys) {
    if (json?.error) {
      const safe: { error: string; error_description?: string } = {
        error: json.error,
      };
      if (typeof json.error_description === "string") {
        safe.error_description = json.error_description;
      }
      return JSON.stringify(safe);
    }
    return "";
  }

  if (json?.error) {
    const safe: { error: string; error_description?: string } = {
      error: json.error,
    };
    if (typeof json.error_description === "string") {
      safe.error_description = json.error_description;
    }
    return JSON.stringify(safe);
  }

  return text;
}

function throwOAuthError(
  kind: "code exchange" | "token refresh",
  status: number,
  json: TokenResponse | null,
  text: string,
): never {
  throw new GooglePhotosOAuthError(
    `Google OAuth ${kind} failed: HTTP ${status}${json?.error ? ` (${json.error})` : ""}`,
    status,
    safeOAuthErrorBody(json, text),
  );
}

/**
 * Decode the email claim from an OIDC id_token when present.
 * Best-effort only — never throws on malformed JWT.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** Exchange authorization code → refresh + access tokens. */
export async function exchangeAuthorizationCode(
  cfg: GooglePhotosOAuthConfig,
  code: string,
  opts?: { fetch?: FetchLike },
): Promise<{ refreshToken: string; accessToken: string; email: string | null }> {
  const fetchImpl = resolveFetch(opts);
  const { status, text, json } = await postForm(
    TOKEN_URL,
    new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
    fetchImpl,
  );

  if (status < 200 || status >= 300 || !json?.access_token || !json.refresh_token) {
    throwOAuthError("code exchange", status, json, text);
  }

  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    email: emailFromIdToken(json.id_token),
  };
}

/** Refresh → short-lived access token. */
export async function refreshAccessToken(
  cfg: GooglePhotosOAuthConfig,
  refreshToken: string,
  opts?: { fetch?: FetchLike },
): Promise<{ accessToken: string; expiresIn?: number }> {
  const fetchImpl = resolveFetch(opts);
  const { status, text, json } = await postForm(
    TOKEN_URL,
    new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );

  if (status < 200 || status >= 300 || !json?.access_token) {
    throwOAuthError("token refresh", status, json, text);
  }

  const result: { accessToken: string; expiresIn?: number } = {
    accessToken: json.access_token,
  };
  if (typeof json.expires_in === "number") {
    result.expiresIn = json.expires_in;
  }
  return result;
}

/** Best-effort revoke (access or refresh token). Swallows network/HTTP errors. */
export async function revokeToken(
  token: string,
  opts?: { fetch?: FetchLike },
): Promise<void> {
  const fetchImpl = resolveFetch(opts);
  try {
    await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best-effort: disconnect still clears our vault even if Google is unreachable.
  }
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
