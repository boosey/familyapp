/**
 * AlbumSurface — the ONE shared album surface (ADR-0009 · #15–#18 · #19).
 *
 * The album is both a full route (`/hub/album`, a deep-link) AND a hub tab (`/hub?tab=album`). Tabs
 * render inline components while a route renders a page, so the surface itself lives here once and is
 * mounted by both: this component renders ONLY the album CONTENT — the grid (or empty note) and the
 * uploader. The page chrome (`<main>`, the container, the back-link, the `<h1>`) belongs to each
 * mount point.
 *
 * Family scope is the hub's SINGLE `?scope=` selector now (Increment 4A) — the album no longer owns
 * its own `?family=` switcher. `scope` is "all" (the deduped union of photos across ALL the viewer's
 * active families) or a family id (only that family's photos). It is re-validated here against the
 * viewer's OWN active families (defense in depth), falling back to "all" — a client-submitted scope
 * is never trusted.
 *
 * All reads go through the album front door: `listActiveFamiliesForPerson` (the viewer's OWN active
 * families), `listAlbumPhotos` (enforces active membership, called per shown family), and
 * `getStewardPersonId`.
 */
import {
  getStewardPersonId,
  listActiveFamiliesForPerson,
  listAlbumPhotos,
  type AuthContext,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";
import { hub } from "@/app/_copy";
import { AlbumUploader } from "./AlbumUploader";
import { AlbumGrid } from "./AlbumGrid";
import { AlbumBoard } from "./AlbumBoard";
import { isAlbumImportProgressEnabled } from "@/lib/album-import-progress-config";
import { isGooglePhotosConfigured } from "@/lib/google-photos-config";
import { getActiveGooglePhotosConnection } from "@/lib/google-photos-connection";

export async function AlbumSurface({
  db,
  ctx,
  scope,
  googlePhotosOauthConnected = false,
  googlePhotosOauthError = null,
}: {
  db: Database;
  ctx: AuthContext;
  /** The hub's single family scope: "all" (union across the viewer's families) or a family id. */
  scope: string;
  /** OAuth callback landed with `?googlePhotos=connected` (hub album tab only). */
  googlePhotosOauthConnected?: boolean;
  /** OAuth callback error code from `?googlePhotosError=` (hub album tab only). */
  googlePhotosOauthError?: string | null;
}): Promise<React.ReactElement> {
  // Guard: only an account has a viewer identity. Callers only mount this for an account, but treat
  // anything else as "no viewer" (no families, no photos) rather than reaching for a personId.
  const viewer = ctx.kind === "account" ? ctx.personId : null;

  const active = viewer ? await listActiveFamiliesForPerson(db, viewer) : [];

  // Phase 5: Google chrome only when env-configured. Connection status is per-viewer.
  const googleConfigured = isGooglePhotosConfigured();
  const googleConn =
    googleConfigured && viewer
      ? await getActiveGooglePhotosConnection(db, viewer)
      : null;

  // Re-validate the hub scope against the viewer's OWN active families (a client-crafted `?scope=`
  // is never trusted); an unrecognized value falls back to "all". The families to show are ALL of
  // them in "all" mode, else the single selected family.
  const validScope =
    scope !== "all" && active.some((f) => f.familyId === scope) ? scope : "all";
  const shownFamilies =
    validScope === "all" ? active : active.filter((f) => f.familyId === validScope);

  // The photos on screen — the union across `shownFamilies`, DEDUPED by photo id (a photo placed in
  // two of the viewer's families would otherwise appear twice in the "all" union). `canManage` is
  // #18's visibility hint: the viewer is the photo's CONTRIBUTOR, or the STEWARD of a family it is
  // shown under. When a photo appears under two shown families we OR the hint across them. This is a
  // deliberate UI approximation — it never OVER-grants (the delete/caption seam re-checks stewardship
  // of ANY placed-in family and is authoritative; `canManage` only decides control visibility).
  const merged = new Map<
    string,
    { id: string; caption: string | null; canManage: boolean; createdAt: Date }
  >();
  for (const fam of shownFamilies) {
    const stewardId = await getStewardPersonId(db, fam.familyId);
    const photos = viewer ? await listAlbumPhotos(db, ctx, fam.familyId) : [];
    for (const p of photos) {
      const canManage = p.contributorPersonId === viewer || stewardId === viewer;
      const existing = merged.get(p.id);
      if (existing) {
        existing.canManage = existing.canManage || canManage;
      } else {
        merged.set(p.id, { id: p.id, caption: p.caption, canManage, createdAt: p.createdAt });
      }
    }
  }
  const gridPhotos = [...merged.values()]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((p) => ({ id: p.id, caption: p.caption, canManage: p.canManage }));

  // Where an "add photo" lands. A specific-family scope targets that family. In "all" mode the target
  // is ambiguous, so we only offer the uploader when there is exactly ONE family to fall back to;
  // with multiple families in "all" the uploader is withheld (pick a family from the hub selector to
  // add). `null` ⇒ no uploader shown.
  const uploadTargetFamilyId =
    validScope !== "all"
      ? validScope
      : active.length === 1
        ? active[0]!.familyId
        : null;

  // File upload needs an unambiguous target family. Google Photos connect is account-level and
  // import still uses the family picker — show the uploader chrome when either path applies.
  const showUploader =
    active.length > 0 && (uploadTargetFamilyId !== null || googleConfigured);

  // ADR-0015 · F2 (flag-gated, dark in prod): when the in-grid per-item import progress feature is on
  // AND the uploader is shown, hand the whole uploader+grid to the client `AlbumBoard`, which owns the
  // per-item pool + placeholder tiles. The flag-off path below is byte-for-byte unchanged.
  if (isAlbumImportProgressEnabled() && showUploader) {
    return (
      <AlbumBoard
        families={active}
        currentFamilyId={uploadTargetFamilyId ?? active[0]!.familyId}
        scope={validScope}
        showFileUpload={uploadTargetFamilyId !== null}
        googlePhotosConfigured={googleConfigured}
        googlePhotosConnected={googleConn !== null}
        googlePhotosEmail={googleConn?.googleAccountEmail ?? null}
        googlePhotosOauthConnected={googlePhotosOauthConnected}
        googlePhotosOauthError={googlePhotosOauthError}
        photos={gridPhotos}
      />
    );
  }

  return (
    <>
      {showUploader ? (
        <div style={{ margin: "0 0 24px" }}>
          <AlbumUploader
            families={active}
            currentFamilyId={uploadTargetFamilyId ?? active[0]!.familyId}
            scope={validScope}
            showFileUpload={uploadTargetFamilyId !== null}
            googlePhotosConfigured={googleConfigured}
            googlePhotosConnected={googleConn !== null}
            googlePhotosEmail={googleConn?.googleAccountEmail ?? null}
            googlePhotosOauthConnected={googlePhotosOauthConnected}
            googlePhotosOauthError={googlePhotosOauthError}
          />
        </div>
      ) : null}

      {gridPhotos.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {/* Pending-only viewer (member of no family) → the coherent hub-wide empty state; an
              actual member with an empty album → the album-specific prompt (Task 4.6). */}
          {active.length === 0 ? hub.shell.pendingEmpty : hub.album.empty}
        </p>
      ) : (
        <AlbumGrid photos={gridPhotos} />
      )}
    </>
  );
}
