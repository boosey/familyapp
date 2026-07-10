/**
 * Deterministic mock for tests / unconfigured-dev seams.
 * Records calls; returns scripted responses. No network.
 */
import type { GooglePhotosOAuthConfig } from "./oauth";
import type { PickedPhoto, PickerSession } from "./picker";

export interface ScriptedExchangeResult {
  refreshToken: string;
  accessToken: string;
  email: string | null;
}

export interface ScriptedRefreshResult {
  accessToken: string;
  expiresIn?: number;
}

export interface ScriptedDownloadResult {
  bytes: Uint8Array;
  contentType: string;
}

export interface ScriptedGooglePhotosClientOptions {
  authorizeUrl?: string;
  exchange?: ScriptedExchangeResult | Error;
  refresh?: ScriptedRefreshResult | Error;
  revokeError?: Error;
  createSession?: PickerSession | Error;
  getSession?: (PickerSession & { mediaItemsSet: boolean }) | Error;
  /** Photos to return, or a full `{ photos, skipped }` result, or an Error. */
  listPhotos?: PickedPhoto[] | { photos: PickedPhoto[]; skipped: number } | Error;
  /** Used when `listPhotos` is a bare array (default 0). */
  listSkipped?: number;
  download?: ScriptedDownloadResult | Error;
}

export class ScriptedGooglePhotosClient {
  readonly calls: Array<{ op: string; args: unknown[] }> = [];

  constructor(private readonly script: ScriptedGooglePhotosClientOptions = {}) {}

  buildAuthorizeUrl(cfg: GooglePhotosOAuthConfig, state: string): string {
    this.calls.push({ op: "buildAuthorizeUrl", args: [cfg, state] });
    return (
      this.script.authorizeUrl ??
      `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}&client_id=${encodeURIComponent(cfg.clientId)}`
    );
  }

  async exchangeAuthorizationCode(
    cfg: GooglePhotosOAuthConfig,
    code: string,
  ): Promise<ScriptedExchangeResult> {
    this.calls.push({ op: "exchangeAuthorizationCode", args: [cfg, code] });
    const r = this.script.exchange;
    if (r instanceof Error) throw r;
    return (
      r ?? {
        refreshToken: "scripted-refresh",
        accessToken: "scripted-access",
        email: "scripted@example.com",
      }
    );
  }

  async refreshAccessToken(
    cfg: GooglePhotosOAuthConfig,
    refreshToken: string,
  ): Promise<ScriptedRefreshResult> {
    this.calls.push({ op: "refreshAccessToken", args: [cfg, refreshToken] });
    const r = this.script.refresh;
    if (r instanceof Error) throw r;
    return r ?? { accessToken: "scripted-access-refreshed", expiresIn: 3600 };
  }

  async revokeToken(token: string): Promise<void> {
    this.calls.push({ op: "revokeToken", args: [token] });
    if (this.script.revokeError) throw this.script.revokeError;
  }

  async createPickerSession(accessToken: string): Promise<PickerSession> {
    this.calls.push({ op: "createPickerSession", args: [accessToken] });
    const r = this.script.createSession;
    if (r instanceof Error) throw r;
    return (
      r ?? {
        id: "scripted-session",
        pickerUri: "https://photospicker.googleapis.com/v1/picker/scripted",
      }
    );
  }

  async getPickerSession(
    accessToken: string,
    sessionId: string,
  ): Promise<PickerSession & { mediaItemsSet: boolean }> {
    this.calls.push({ op: "getPickerSession", args: [accessToken, sessionId] });
    const r = this.script.getSession;
    if (r instanceof Error) throw r;
    return (
      r ?? {
        id: sessionId,
        pickerUri: "https://photospicker.googleapis.com/v1/picker/scripted",
        mediaItemsSet: true,
      }
    );
  }

  async listPickedPhotos(
    accessToken: string,
    sessionId: string,
  ): Promise<{ photos: PickedPhoto[]; skipped: number }> {
    this.calls.push({ op: "listPickedPhotos", args: [accessToken, sessionId] });
    const r = this.script.listPhotos;
    if (r instanceof Error) throw r;
    if (r && !Array.isArray(r) && "photos" in r) return r;
    const photos =
      (Array.isArray(r) ? r : null) ??
      [
        {
          id: "photo-1",
          mimeType: "image/jpeg",
          filename: "scripted.jpg",
          baseUrl: "https://lh3.googleusercontent.com/p/scripted",
        },
      ];
    return { photos, skipped: this.script.listSkipped ?? 0 };
  }

  async downloadPickedPhoto(
    accessToken: string,
    item: PickedPhoto,
  ): Promise<ScriptedDownloadResult> {
    this.calls.push({ op: "downloadPickedPhoto", args: [accessToken, item] });
    const r = this.script.download;
    if (r instanceof Error) throw r;
    return (
      r ?? {
        bytes: new TextEncoder().encode("scripted-bytes"),
        contentType: item.mimeType,
      }
    );
  }
}
