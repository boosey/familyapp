/**
 * Google Photos Picker adapter — OAuth + Picker HTTP, fetch-only.
 *
 * Lives outside the IP packages: the vendor-SDK guard scans
 * `@chronicle/{core,db,storage,capture,pipeline,interviewer}` — this package is
 * intentionally outside that set. No Google SDK; injectable `fetch` for tests.
 *
 * Slice A of ADR-0009 Phase 5 (connect-once + Picker each import).
 */
export {
  PHOTOS_PICKER_SCOPE,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  GooglePhotosOAuthError,
  type GooglePhotosOAuthConfig,
  type GooglePhotosConnection,
} from "./oauth";

export {
  createPickerSession,
  getPickerSession,
  listPickedPhotos,
  listPickedPhotosWhenReady,
  downloadPickedPhoto,
  parsePickerDurationMs,
  pickerUriForWeb,
  isPickerSessionNotReadyError,
  GooglePhotosPickerError,
  type PickerSession,
  type PickedPhoto,
} from "./picker";

export { encryptToken, decryptToken } from "./token-crypto";

export {
  ScriptedGooglePhotosClient,
  type ScriptedGooglePhotosClientOptions,
  type ScriptedExchangeResult,
  type ScriptedRefreshResult,
  type ScriptedDownloadResult,
} from "./scripted";
