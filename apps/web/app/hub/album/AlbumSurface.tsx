/**
 * AlbumSurface — the ONE shared album surface (ADR-0009 · #15–#18 · #19).
 *
 * The album is both a full route (`/hub/album`, a deep-link) AND a hub tab (`/hub?tab=album`). Tabs
 * render inline components while a route renders a page, so the surface itself lives here once and is
 * mounted by both: this component renders ONLY the album CONTENT — the family switcher, the grid (or
 * empty note), and the uploader. The page chrome (`<main>`, the container, the back-link, the `<h1>`)
 * belongs to each mount point.
 *
 * The one thing that differs per mount is where the switcher links point, so the base is injected as
 * `familyHref` (the route builds `/hub/album?family=…`; the tab builds `/hub?tab=album&family=…`).
 *
 * All reads go through the album front door: `listActiveFamiliesForPerson` (the viewer's OWN active
 * families — a client-submitted `requestedFamily` is validated against THIS set, never trusted),
 * `listAlbumPhotos` (enforces active membership), and `getStewardPersonId`.
 */
import Link from "next/link";
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

export async function AlbumSurface({
  db,
  ctx,
  requestedFamily,
  familyHref,
}: {
  db: Database;
  ctx: AuthContext;
  requestedFamily: string | undefined;
  /** Builds each switcher link's href — mount-specific base (route vs tab). */
  familyHref: (familyId: string) => string;
}): Promise<React.ReactElement> {
  // Guard: only an account has a viewer identity. Callers only mount this for an account, but treat
  // anything else as "no viewer" (no families, no photos) rather than reaching for a personId.
  const viewer = ctx.kind === "account" ? ctx.personId : null;

  // #16: the album on screen is the `?family=` context (re-validated against the viewer's OWN active
  // families), falling back to their first active family. `current` is undefined only when they have
  // no active membership.
  const active = viewer ? await listActiveFamiliesForPerson(db, viewer) : [];
  const current = active.find((f) => f.familyId === requestedFamily) ?? active[0];

  const photos = current && viewer ? await listAlbumPhotos(db, ctx, current.familyId) : [];

  // #18: a tile shows management controls when the viewer may manage the photo — they are its
  // CONTRIBUTOR, or the STEWARD of the album on screen. NOTE this checks stewardship of the
  // ON-SCREEN family ONLY — a deliberate UI approximation for this slice. It can UNDER-show controls
  // (a viewer who is steward of a DIFFERENT family the photo is also placed in won't see the controls
  // from this family's view) but it never OVER-grants: the seam re-checks stewardship of ANY
  // placed-in family and is authoritative, so `canManage` only decides visibility, never authority.
  const stewardId = current ? await getStewardPersonId(db, current.familyId) : null;
  const gridPhotos = photos.map((p) => ({
    id: p.id,
    caption: p.caption,
    canManage: p.contributorPersonId === viewer || stewardId === viewer,
  }));

  return (
    <>
      {active.length > 1 ? (
        <nav
          aria-label={hub.album.switcherAria}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            margin: "0 0 24px",
          }}
        >
          {active.map((f) => {
            const isCurrent = current?.familyId === f.familyId;
            return (
              <Link
                key={f.familyId}
                href={familyHref(f.familyId)}
                aria-current={isCurrent ? "page" : undefined}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  padding: "8px 14px",
                  borderRadius: "var(--radius-pill)",
                  textDecoration: "none",
                  border: "var(--border-width) solid var(--border)",
                  background: isCurrent ? "var(--accent)" : "transparent",
                  color: isCurrent ? "var(--accent-on)" : "var(--text-meta)",
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {f.familyName}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {photos.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-meta)",
            margin: "0 0 24px",
          }}
        >
          {hub.album.empty}
        </p>
      ) : (
        <AlbumGrid photos={gridPhotos} />
      )}

      {current ? (
        <AlbumUploader families={active} currentFamilyId={current.familyId} />
      ) : null}
    </>
  );
}
