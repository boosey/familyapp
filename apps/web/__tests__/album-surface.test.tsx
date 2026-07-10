/**
 * AlbumSurface (#19 · Increment 4A) — the ONE shared album surface mounted by BOTH the `/hub/album`
 * deep-link route and the hub's 'Album' tab. It is an async server component: invoke it as a function,
 * render its element to static markup, and assert the grid / uploader it composed.
 *
 * Family scope is the hub's SINGLE `?scope=` selector now — the album no longer renders its own
 * `?family=` switcher. `scope` is "all" (the deduped union across the viewer's active families) or a
 * family id. The two client children (AlbumGrid, AlbumUploader) are stubbed to echo the props
 * AlbumSurface computed — this both sidesteps their `useRouter`/`useTransition` client hooks under a
 * server render AND lets us assert the derived values (photo ids, canManage, families,
 * currentFamilyId) directly.
 *
 * The DB reads (active families, album photos, steward) run for real against PGlite, mirroring the
 * album.server.test.ts seed helpers.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
    showFileUpload,
    googlePhotosConfigured,
    googlePhotosConnected,
  }: {
    families: Array<{ familyId: string; familyName: string }>;
    currentFamilyId: string;
    showFileUpload?: boolean;
    googlePhotosConfigured?: boolean;
    googlePhotosConnected?: boolean;
  }) => (
    <div
      data-testid="album-uploader"
      data-current-family={currentFamilyId}
      data-show-file-upload={String(showFileUpload ?? true)}
      data-google-configured={String(!!googlePhotosConfigured)}
      data-google-connected={String(!!googlePhotosConnected)}
    >
      {families.map((f) => (
        <span key={f.familyId} data-uploader-family={f.familyId}>
          {f.familyName}
        </span>
      ))}
    </div>
  ),
}));

const isGooglePhotosConfigured = vi.fn(() => false);
type GoogleConn = {
  personId: string;
  encryptedRefreshToken: string;
  googleAccountEmail: string | null;
  connectedAt: Date;
  revokedAt: Date | null;
};
const getActiveGooglePhotosConnection = vi.fn<
  (db: unknown, personId: unknown) => Promise<GoogleConn | null>
>(async () => null);
vi.mock("@/lib/google-photos-config", () => ({
  isGooglePhotosConfigured: () => isGooglePhotosConfigured(),
}));
vi.mock("@/lib/google-photos-connection", () => ({
  getActiveGooglePhotosConnection: (db: unknown, personId: unknown) =>
    getActiveGooglePhotosConnection(db, personId),
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

async function render(db: Database, ctx: AuthContext, scope: string): Promise<string> {
  const el = await AlbumSurface({ db, ctx, scope });
  return renderToStaticMarkup(el);
}

describe("AlbumSurface", () => {
  beforeEach(() => {
    isGooglePhotosConfigured.mockReturnValue(false);
    getActiveGooglePhotosConnection.mockResolvedValue(null);
  });

  it("renders NO internal family switcher — the hub selector owns family scope now", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);

    const html = await render(db, account(viewer), "all");

    // The retired switcher's aria-labelled nav is gone entirely.
    expect(html).not.toContain(hub.album.switcherAria);
  });

  it("shows a placed photo's tile and the uploader when the viewer has a sole family", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoId = await placePhoto(db, viewer, [famA], "family-photos/surface-1");

    const html = await render(db, account(viewer), "all");

    // The grid received the placed photo (its audited bytes route appears via the grid stub)...
    expect(html).toContain(`/api/album-photo/${photoId}`);
    expect(html).toContain(`data-photo-id="${photoId}"`);
    // ...and the uploader is mounted, targeting the sole family (unambiguous even in "all").
    expect(html).toContain('data-testid="album-uploader"');
    expect(html).toContain(`data-current-family="${famA}"`);
  });

  it("scope=all shows the DEDUPED union of photos across ALL the viewer's families", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");
    const photoB = await placePhoto(db, viewer, [famB], "family-photos/surface-b");
    // A photo placed in BOTH families — it must appear exactly ONCE in the union.
    const photoAB = await placePhoto(db, viewer, [famA, famB], "family-photos/surface-ab");

    const html = await render(db, account(viewer), "all");

    expect(html).toContain(`data-photo-id="${photoA}"`);
    expect(html).toContain(`data-photo-id="${photoB}"`);
    // Deduped: the both-families photo's tile appears once, not twice.
    const occurrences = html.split(`data-photo-id="${photoAB}"`).length - 1;
    expect(occurrences).toBe(1);
    // With multiple families and no specific scope, the uploader target is ambiguous → withheld.
    expect(html).not.toContain('data-testid="album-uploader"');
  });

  it("scope=<familyId> shows ONLY that family's photos and targets the uploader there", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");
    const photoB = await placePhoto(db, viewer, [famB], "family-photos/surface-b");

    const html = await render(db, account(viewer), famB);

    // famB is the scope, so ONLY famB's photo is on screen; the uploader defaults to famB.
    expect(html).toContain(`data-photo-id="${photoB}"`);
    expect(html).not.toContain(`data-photo-id="${photoA}"`);
    expect(html).toContain(`data-current-family="${famB}"`);
  });

  it("falls back to 'all' when given a scope the viewer is not a member of", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");

    // A family the viewer is NOT a member of — a spoofed scope must not select it; fall back to "all".
    const html = await render(db, account(viewer), "not-a-family-of-mine");

    expect(html).toContain(`data-photo-id="${photoA}"`);
  });

  it("shows Google Photos chrome without file upload when scope=all and Google is configured", async () => {
    isGooglePhotosConfigured.mockReturnValue(true);
    getActiveGooglePhotosConnection.mockResolvedValue({
      personId: "viewer",
      encryptedRefreshToken: "enc",
      googleAccountEmail: "user@gmail.com",
      connectedAt: new Date(),
      revokedAt: null,
    });

    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);

    const html = await render(db, account(viewer), "all");

    expect(html).toContain('data-testid="album-uploader"');
    expect(html).toContain('data-show-file-upload="false"');
    expect(html).toContain('data-google-configured="true"');
    expect(html).toContain('data-google-connected="true"');
  });
});
