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
  listAlbumPhotosDetailed,
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

  // The photos on screen — ONE detailed read across `shownFamilies`, already DEDUPED by photo id and
  // sorted most-recent-first by the core seam (which also intersects each row's `families` down to the
  // authorized placements). Phase C enriches each tile with the contributor name, families, subjects,
  // people, places, and capture time so the client can filter + fill the List columns without more reads.
  const shownFamilyIds = shownFamilies.map((f) => f.familyId);
  const detailed = viewer ? await listAlbumPhotosDetailed(db, ctx, shownFamilyIds) : [];

  // `canManage` is #18's visibility hint: the viewer is the photo's CONTRIBUTOR, or the STEWARD of ANY
  // family the photo is shown under. Fetch steward ids per shown family (as before) and test membership
  // against the photo's authorized `families`. A deliberate UI approximation — it never OVER-grants (the
  // delete/caption seam re-checks stewardship of ANY placed-in family and is authoritative).
  const stewardByFamily = new Map<string, string | null>();
  for (const fam of shownFamilies) {
    stewardByFamily.set(fam.familyId, await getStewardPersonId(db, fam.familyId));
  }
  const viewerIsStewardOf = new Set(
    [...stewardByFamily].filter(([, s]) => s === viewer).map(([fid]) => fid),
  );

  const unnamed = hub.album.unnamedPerson;
  const gridPhotos = detailed.map((p) => {
    const canManage =
      p.contributorPersonId === viewer ||
      p.families.some((f) => viewerIsStewardOf.has(f.familyId));
    return {
      id: p.id,
      caption: p.caption,
      canManage,
      contributorName: p.contributorDisplayName,
      families: p.families.map((f) => ({ id: f.familyId, name: f.familyName })),
      subjects: p.subjects.map((s) => ({ id: s.personId, name: s.displayName ?? unnamed })),
      people: p.people.map((pp) => ({ id: pp.personId, name: pp.displayName ?? unnamed })),
      places: p.places.map((pl) => ({ id: pl.placeId, name: pl.name })),
      capturedAt: (p.capturedAt ?? p.createdAt).toISOString(),
    };
  });

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
