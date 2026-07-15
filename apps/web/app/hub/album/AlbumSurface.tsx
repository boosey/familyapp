/**
 * AlbumSurface — the ONE shared album surface (ADR-0009 · #15–#18 · #19).
 *
 * The album is both a full route (`/hub/album`, a deep-link) AND a hub tab (`/hub?tab=album`). Tabs
 * render inline components while a route renders a page, so the surface itself lives here once and is
 * mounted by both: this component renders ONLY the album CONTENT — the grid (or empty note) and the
 * uploader. The page chrome (`<main>`, the container, the back-link, the `<h1>`) belongs to each
 * mount point.
 *
 * Family scope is the hub's shared `?families=` browse FILTER now (ADR-0021) — the album no longer owns
 * its own `?family=` switcher, and the old single-select `?scope=` is retired. The raw param is parsed
 * against the viewer's OWN active families (defense in depth — unknown/crafted ids are dropped, absent
 * = all, an explicit `none` = the empty set): a client-submitted filter is never trusted. Multi-select
 * on the album — the chip bar (self-hidden for <2 families) narrows which families' photos show.
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
import { parseFamilyFilter, selectedIdList, deriveSingleScope } from "@/lib/family-filter";
import { FamilyChips } from "../FamilyChips";
import { AlbumUploader } from "./AlbumUploader";
import { AlbumGrid } from "./AlbumGrid";
import { AlbumBoard } from "./AlbumBoard";
import { isAlbumImportProgressEnabled } from "@/lib/album-import-progress-config";
import { isGooglePhotosConfigured } from "@/lib/google-photos-config";
import { getActiveGooglePhotosConnection } from "@/lib/google-photos-connection";

export async function AlbumSurface({
  db,
  ctx,
  familiesParam,
  googlePhotosOauthConnected = false,
  googlePhotosOauthError = null,
}: {
  db: Database;
  ctx: AuthContext;
  /** The raw `?families=` browse-filter value (absent = all, `none` = empty, else a csv of ids). */
  familiesParam: string | string[] | undefined;
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

  // Parse the shared `?families=` browse filter against the viewer's OWN active families (a
  // client-crafted value is never trusted — unknown ids drop, absent = all, `none` = the empty set).
  // The families to show are the concrete selected ids; the empty-set (`none`) shows nothing.
  const activeIds = active.map((f) => f.familyId);
  const filter = parseFamilyFilter(familiesParam, activeIds);
  const selectedIds = selectedIdList(filter, activeIds);
  const shownFamilies = active.filter((f) => selectedIds.includes(f.familyId));

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

  // Where an "add photo" lands (KEEP the old semantics, adapted to the filter): a single selected
  // family targets that family. With 0 or >1 selected among multiple families the target is ambiguous,
  // so we only fall back to a sole family; otherwise `null` ⇒ no uploader shown (exactly the old "all
  // with multiple families" case). The `uploaderScope` seed handed to AlbumUploader collapses the
  // filter to a single scope for its own seeding logic (unchanged).
  const uploadTargetFamilyId =
    selectedIds.length === 1
      ? selectedIds[0]!
      : active.length === 1
        ? active[0]!.familyId
        : null;
  const uploaderScope = deriveSingleScope(filter);

  // File upload needs an unambiguous target family. Google Photos connect is account-level and
  // import still uses the family picker — show the uploader chrome when either path applies. An
  // explicit empty selection (`none`) withholds the uploader entirely (nothing is being browsed).
  const showUploader =
    filter.kind !== "none" &&
    active.length > 0 &&
    (uploadTargetFamilyId !== null || googleConfigured);

  // The shared browse-filter chip bar sits ABOVE the grid/uploader on every path — but only for a
  // viewer with ≥2 families (one family has nothing to filter). Gating the MOUNT here (rather than
  // relying on FamilyChips' own self-hide) keeps the client widget's next/navigation hooks out of the
  // server render for the 0/1-family case (e.g. a pending-only viewer under renderToStaticMarkup).
  // Two flavors of the same bar: `chips` is standalone (its own trailing margin) for the empty-state
  // paths where no AlbumGrid mounts; `chipsInline` drops that margin so it bottom-aligns with the
  // sibling When/Search controls when it rides INSIDE AlbumGrid's consolidated control row (#52).
  const chipFamilies = active.map((f) => ({ id: f.familyId, name: f.familyName }));
  const chipSelected = filter.kind === "all" ? ("all" as const) : selectedIds;
  const chips =
    active.length >= 2 ? (
      <FamilyChips families={chipFamilies} selected={chipSelected} />
    ) : null;
  const chipsInline =
    active.length >= 2 ? (
      <FamilyChips families={chipFamilies} selected={chipSelected} inline />
    ) : null;

  // Explicit empty selection: an honest empty state (ADR-0021) — no grid, no uploader — rather than a
  // silent "show all". The chip bar stays so the viewer can turn a family back on.
  if (filter.kind === "none") {
    return (
      <>
        {chips}
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {hub.album.noFamiliesSelected}
        </p>
      </>
    );
  }

  // ADR-0015 · F2 (flag-gated, dark in prod): when the in-grid per-item import progress feature is on
  // AND the uploader is shown, hand the whole uploader+grid to the client `AlbumBoard`, which owns the
  // per-item pool + placeholder tiles. `viewedFamilyIds` drives its reconciliation; `uploaderScope`
  // seeds its AlbumUploader.
  if (isAlbumImportProgressEnabled() && showUploader) {
    return (
      <AlbumBoard
        families={active}
        currentFamilyId={uploadTargetFamilyId ?? active[0]!.familyId}
        viewedFamilyIds={selectedIds}
        uploaderScope={uploaderScope}
        showFileUpload={uploadTargetFamilyId !== null}
        googlePhotosConfigured={googleConfigured}
        googlePhotosConnected={googleConn !== null}
        googlePhotosEmail={googleConn?.googleAccountEmail ?? null}
        googlePhotosOauthConnected={googlePhotosOauthConnected}
        googlePhotosOauthError={googlePhotosOauthError}
        photos={gridPhotos}
        familyChips={chipsInline}
      />
    );
  }

  return (
    <>
      {/* The browse Family chips ride INSIDE AlbumGrid's control row when there are photos to show; on
          the empty-album path (a `<p>`, no AlbumGrid) they render standalone below so a ≥2-family viewer
          can still toggle families. */}
      {gridPhotos.length === 0 ? chips : null}
      {showUploader ? (
        <div style={{ margin: "0 0 24px" }}>
          <AlbumUploader
            families={active}
            currentFamilyId={uploadTargetFamilyId ?? active[0]!.familyId}
            scope={uploaderScope}
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
        <AlbumGrid photos={gridPhotos} familyChips={chipsInline} />
      )}
    </>
  );
}
