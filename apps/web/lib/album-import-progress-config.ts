/**
 * Rollout flag for the in-grid per-item import progress feature (ADR-0015 · F2).
 *
 * Off by default so the feature lands DARK. F2 multiplies the Clerk `auth()` path by N (one
 * server-action call per photo), and there is an open "Not signed in" auth bug under diagnosis
 * (commit a764ecb added [DIAG] logging to prod). Do NOT enable this in production until that bug is
 * confirmed dead. Mirrors the `FOLLOW_UPS_ENABLED` idiom in `follow-up-config.ts`.
 */
export function isAlbumImportProgressEnabled(): boolean {
  const raw = process.env.ALBUM_IMPORT_PROGRESS_ENABLED;
  return raw === "1" || raw === "true";
}
