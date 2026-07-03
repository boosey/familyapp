/**
 * AlbumSurface (#19) — the ONE shared album surface mounted by BOTH the `/hub/album` deep-link route
 * and the hub's new 'Album' tab. It is an async server component: invoke it as a function, render its
 * element to static markup, and assert the switcher / grid / uploader it composed.
 *
 * The two client children (AlbumGrid, AlbumUploader) are stubbed to echo the props AlbumSurface
 * computed — this both sidesteps their `useRouter`/`useTransition` client hooks under a server render
 * AND lets us assert the derived values (photo ids, canManage, families, currentFamilyId) directly.
 * `next/link` is stubbed to a plain <a> so the switcher's parameterized hrefs land in the markup.
 *
 * The DB reads (active families, album photos, steward) run for real against PGlite, mirroring the
 * album.server.test.ts seed helpers.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/app/hub/album/AlbumGrid", () => ({
  AlbumGrid: ({
    photos,
  }: {
    photos: Array<{ id: string; caption: string | null; canManage: boolean }>;
  }) => (
    <div data-testid="album-grid">
      {photos.map((p) => (
        <div key={p.id} data-photo-id={p.id} data-can-manage={String(p.canManage)}>
          {`/api/album-photo/${p.id}`}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/app/hub/album/AlbumUploader", () => ({
  AlbumUploader: ({
    families,
    currentFamilyId,
  }: {
    families: Array<{ familyId: string; familyName: string }>;
    currentFamilyId: string;
  }) => (
    <div data-testid="album-uploader" data-current-family={currentFamilyId}>
      {families.map((f) => (
        <span key={f.familyId} data-uploader-family={f.familyId}>
          {f.familyName}
        </span>
      ))}
    </div>
  ),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import { createAlbumPhoto, type AuthContext } from "@chronicle/core";
import { AlbumSurface } from "@/app/hub/album/AlbumSurface";
import { hub } from "@/app/_copy";

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function makePerson(db: Database, name: string): Promise<string> {
  const [p] = await db
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

async function makeFamily(db: Database, name: string, creatorId: string): Promise<string> {
  const [f] = await db
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!.id;
}

async function addMember(db: Database, personId: string, familyId: string): Promise<void> {
  await db.insert(memberships).values({ personId, familyId, status: "active" });
}

async function placePhoto(
  db: Database,
  contributorPersonId: string,
  familyIds: string[],
  storageKey: string,
): Promise<string> {
  const photo = await createAlbumPhoto(db, {
    contributorPersonId,
    familyIds,
    source: "upload",
    storageKey,
    caption: null,
  });
  return photo.id;
}

async function render(
  db: Database,
  ctx: AuthContext,
  requestedFamily: string | undefined,
): Promise<string> {
  const el = await AlbumSurface({
    db,
    ctx,
    requestedFamily,
    familyHref: (id) => `/base?family=${id}`,
  });
  return renderToStaticMarkup(el);
}

describe("AlbumSurface", () => {
  it("renders a switcher with BOTH families, each href using the passed familyHref base", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);

    const html = await render(db, account(viewer), undefined);

    // The switcher nav is present with both family names...
    expect(html).toContain(hub.album.switcherAria);
    expect(html).toContain("Esposito");
    expect(html).toContain("Marino");
    // ...and each switcher link uses the parameterized familyHref base (proving both mount contexts).
    expect(html).toContain(`href="/base?family=${famA}"`);
    expect(html).toContain(`href="/base?family=${famB}"`);
  });

  it("shows a placed photo's tile and the uploader when the album has a current family", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoId = await placePhoto(db, viewer, [famA], "family-photos/surface-1");

    const html = await render(db, account(viewer), undefined);

    // The grid received the placed photo (its audited bytes route appears via the grid stub)...
    expect(html).toContain(`/api/album-photo/${photoId}`);
    expect(html).toContain(`data-photo-id="${photoId}"`);
    // ...and the uploader is mounted for the sole current family.
    expect(html).toContain('data-testid="album-uploader"');
    expect(html).toContain(`data-current-family="${famA}"`);
  });

  it("renders NO switcher for a solo-family contributor, uploader still present", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);

    const html = await render(db, account(viewer), undefined);

    // No switcher chrome at all (its aria label + a second family name are both absent).
    expect(html).not.toContain(hub.album.switcherAria);
    expect(html).not.toContain("Marino");
    // The empty-state note shows (no photos yet) and the uploader is still mounted.
    expect(html).toContain(hub.album.empty);
    expect(html).toContain('data-testid="album-uploader"');
  });

  it("honours requestedFamily: the SECOND family's album is the one shown", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");
    const photoB = await placePhoto(db, viewer, [famB], "family-photos/surface-b");

    const html = await render(db, account(viewer), famB);

    // famB is the requested context, so ONLY famB's photo is on screen; the uploader defaults to famB.
    expect(html).toContain(`data-photo-id="${photoB}"`);
    expect(html).not.toContain(`data-photo-id="${photoA}"`);
    expect(html).toContain(`data-current-family="${famB}"`);
  });
});
