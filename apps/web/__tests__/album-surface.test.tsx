/**
 * AlbumSurface (#19 · Increment 4A) — the ONE shared album surface mounted by BOTH the `/hub/album`
 * deep-link route and the hub's 'Album' tab. It is an async server component: invoke it as a function,
 * render its element to static markup, and assert the grid / uploader it composed.
 *
 * Family scope is the shared `?families=` browse FILTER now (ADR-0021) — the album no longer renders
 * its own `?family=` switcher, and the old single-select `?scope=` is retired. `familiesParam` is the
 * raw value (absent = all, `none` = the empty set, else a csv of family ids). The client children
 * (AlbumBoard, AlbumControls) plus FamilyChips are stubbed to echo the props AlbumSurface computed —
 * this both sidesteps their `useRouter`/`useTransition` client hooks under a server render AND lets us
 * assert the derived values (photo ids, canManage, families, currentFamilyId) directly.
 *
 * The DB reads (active families, album photos, steward) run for real against PGlite, mirroring the
 * album.server.test.ts seed helpers.
 */
import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// AlbumBoard (ADR-0015 · F2, now GA — the SOLE import path) is the mount for any viewer with ≥1
// family. Stub it to echo the props AlbumSurface hands it, so the surface's wiring stays assertable
// without the real board's client hooks.
vi.mock("@/app/hub/album/AlbumBoard", () => ({
  AlbumBoard: ({
    currentFamilyId,
    defaultSelected,
    showFileUpload,
    googlePhotosConfigured,
    googlePhotosConnected,
    photos,
    familyChips,
    emptyNote,
  }: {
    currentFamilyId: string;
    defaultSelected?: string[];
    showFileUpload?: boolean;
    googlePhotosConfigured?: boolean;
    googlePhotosConnected?: boolean;
    photos: Array<{ id: string; caption: string | null; canManage: boolean }>;
    familyChips?: ReactNode;
    emptyNote?: string;
  }) => (
    <div
      data-testid="album-board"
      data-current-family={currentFamilyId}
      data-default-selected={(defaultSelected ?? []).join(",")}
      data-show-file-upload={String(showFileUpload ?? true)}
      data-google-configured={String(!!googlePhotosConfigured)}
      data-google-connected={String(!!googlePhotosConnected)}
    >
      {familyChips}
      {photos.map((p) => (
        <div key={p.id} data-board-photo-id={p.id}>
          {`/api/album-photo/${p.id}`}
        </div>
      ))}
      {photos.length === 0 ? <p data-testid="album-empty-note">{emptyNote}</p> : null}
    </div>
  ),
}));

// AlbumControls is used ONLY for the no-uploader (pending-only, zero-family) viewer — every ≥1-family
// path routes through AlbumBoard above. Stub it to echo the chips + photos it composes.
vi.mock("@/app/hub/album/AlbumControls", () => ({
  AlbumControls: ({
    photos,
    familyChips,
    addSlot,
    emptyNote,
  }: {
    photos: Array<{ id: string; caption: string | null; canManage: boolean }>;
    familyChips?: ReactNode;
    addSlot?: ReactNode;
    emptyNote?: string;
  }) => (
    <div data-testid="album-grid">
      {familyChips}
      {addSlot}
      {photos.map((p) => (
        <div key={p.id} data-photo-id={p.id} data-can-manage={String(p.canManage)}>
          {`/api/album-photo/${p.id}`}
        </div>
      ))}
      {photos.length === 0 ? <p data-testid="album-empty-note">{emptyNote}</p> : null}
    </div>
  ),
}));

// FamilyChips is a client widget (next/navigation hooks). Stub it to echo which chips are ON so we
// can assert the chip bar renders for ≥2 families and reflects the derived selection.
vi.mock("@/app/hub/FamilyChips", () => ({
  FamilyChips: ({
    families,
    selected,
  }: {
    families: Array<{ id: string; name: string }>;
    selected: string[] | "all";
  }) =>
    families.length < 2 ? null : (
      <div
        data-testid="family-chips"
        data-selected={selected === "all" ? "all" : selected.join(",")}
      >
        {families.map((f) => (
          <span key={f.id} data-chip-family={f.id}>
            {f.name}
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

async function render(
  db: Database,
  ctx: AuthContext,
  familiesParam: string | string[] | undefined,
): Promise<string> {
  const el = await AlbumSurface({ db, ctx, familiesParam });
  return renderToStaticMarkup(el);
}

describe("AlbumSurface", () => {
  beforeEach(() => {
    isGooglePhotosConfigured.mockReturnValue(false);
    getActiveGooglePhotosConnection.mockResolvedValue(null);
  });

  it("renders NO internal family switcher — the shared ?families= filter owns family scope now", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);

    const html = await render(db, account(viewer), undefined);

    // The retired switcher's aria-labelled nav is gone entirely.
    expect(html).not.toContain(hub.album.switcherAria);
    // ...but the shared browse-filter chip bar IS present (viewer has 2 families).
    expect(html).toContain('data-testid="family-chips"');
  });

  it("shows a placed photo's tile and the board when the viewer has a sole family", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoId = await placePhoto(db, viewer, [famA], "family-photos/surface-1");

    const html = await render(db, account(viewer), undefined);

    // The board received the placed photo (its audited bytes route appears via the board stub)...
    expect(html).toContain(`/api/album-photo/${photoId}`);
    expect(html).toContain(`data-board-photo-id="${photoId}"`);
    // ...and the board is mounted, targeting the sole family (unambiguous even in "all"): the
    // designator pre-selects that lone family so upload proceeds with no extra picking.
    expect(html).toContain('data-testid="album-board"');
    expect(html).toContain(`data-current-family="${famA}"`);
    expect(html).toContain(`data-default-selected="${famA}"`);
    // The file-add button is always available now (decoupled from the filter).
    expect(html).toContain('data-show-file-upload="true"');
    // A one-family viewer has nothing to filter → no chip bar.
    expect(html).not.toContain('data-testid="family-chips"');
  });

  it("absent families param shows the DEDUPED union of photos across ALL the viewer's families", async () => {
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

    const html = await render(db, account(viewer), undefined);

    expect(html).toContain(`data-board-photo-id="${photoA}"`);
    expect(html).toContain(`data-board-photo-id="${photoB}"`);
    // Deduped: the both-families photo's tile appears once, not twice.
    const occurrences = html.split(`data-board-photo-id="${photoAB}"`).length - 1;
    expect(occurrences).toBe(1);
    // ADR-0021: the board is ALWAYS present (decoupled from the filter). With multiple families all
    // selected (absent = all) the target is AMBIGUOUS → the designator pre-selects NOTHING, forcing a
    // deliberate pick (a photo never silently fans out to all families).
    expect(html).toContain('data-testid="album-board"');
    expect(html).toContain('data-default-selected=""');
    expect(html).toContain('data-show-file-upload="true"');
    // The chip bar is shown with every chip ON.
    expect(html).toContain('data-testid="family-chips"');
    expect(html).toContain('data-selected="all"');
  });

  it("a single-family ?families= shows ONLY that family's photos and targets the board there", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");
    const photoB = await placePhoto(db, viewer, [famB], "family-photos/surface-b");

    const html = await render(db, account(viewer), famB);

    // famB is the selected family, so ONLY famB's photo is on screen; the board defaults to famB.
    expect(html).toContain(`data-board-photo-id="${photoB}"`);
    expect(html).not.toContain(`data-board-photo-id="${photoA}"`);
    expect(html).toContain(`data-current-family="${famB}"`);
    // The filter names exactly one family → unambiguous, so the designator pre-selects famB.
    expect(html).toContain(`data-default-selected="${famB}"`);
    // A single-family selection out of two → chip bar present, only famB ON.
    expect(html).toContain(`data-selected="${famB}"`);
  });

  it("narrows to a multi-family subset (some) and shows exactly those families' photos", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    const famC = await makeFamily(db, "Rossi", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    await addMember(db, viewer, famC);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");
    const photoB = await placePhoto(db, viewer, [famB], "family-photos/surface-b");
    const photoC = await placePhoto(db, viewer, [famC], "family-photos/surface-c");

    // Select A + C (a strict subset of three) — B's photo must be excluded.
    const html = await render(db, account(viewer), `${famA},${famC}`);

    expect(html).toContain(`data-board-photo-id="${photoA}"`);
    expect(html).toContain(`data-board-photo-id="${photoC}"`);
    expect(html).not.toContain(`data-board-photo-id="${photoB}"`);
    // Two selected among three → the board is still present (ADR-0021) but the target is AMBIGUOUS
    // → the designator pre-selects nothing (a deliberate pick is forced).
    expect(html).toContain('data-testid="album-board"');
    expect(html).toContain('data-default-selected=""');
    // Chip bar reflects the A+C subset (active-set order).
    expect(html).toContain(`data-selected="${famA},${famC}"`);
  });

  it("none (all chips off) routes through AlbumBoard: unified toolbar (Add Photos + chips) above the empty note", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);
    await placePhoto(db, viewer, [famA], "family-photos/surface-a");

    const html = await render(db, account(viewer), "none");

    // The honest empty state (ADR-0021) — not a silent "show all". It renders through AlbumBoard (the
    // SAME unified path as every other ≥1-family state), so no bespoke stacked-block render: the empty
    // note carries the "no families selected" copy inside the AlbumBoard region.
    expect(html).toContain(hub.album.noFamiliesSelected);
    expect(html).toContain('data-testid="album-empty-note"');
    // The add/import flow is DECOUPLED from the filter: the board shows even in the all-off case. The
    // target is ambiguous (>1 family, filter names none) → the designator pre-selects nothing.
    expect(html).toContain('data-testid="album-board"');
    expect(html).toContain('data-default-selected=""');
    expect(html).toContain('data-show-file-upload="true"');
    // The chip bar stays so a family can be turned back on; all chips OFF.
    expect(html).toContain('data-testid="family-chips"');
    expect(html).toContain('data-selected=""');
  });

  it("falls back to 'all' when given a families value the viewer is not a member of", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoA = await placePhoto(db, viewer, [famA], "family-photos/surface-a");

    // A family the viewer is NOT a member of — a spoofed value must not select it; fall back to "all".
    const html = await render(db, account(viewer), "not-a-family-of-mine");

    expect(html).toContain(`data-board-photo-id="${photoA}"`);
  });

  // Regression (issue #152): the board is the SOLE album import path now — GA, no flag. Any ≥1-family
  // viewer always mounts AlbumBoard, never the (now-deleted) legacy AlbumUploader/AlbumGrid pair, and
  // with NO env var set (the flag no longer exists / is a no-op if left set anywhere).
  it("mounts AlbumBoard unconditionally (no flag) for a ≥1-family viewer; never the legacy pair", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    await addMember(db, viewer, famA);
    const photoId = await placePhoto(db, viewer, [famA], "family-photos/surface-on");

    const html = await render(db, account(viewer), undefined);

    expect(html).toContain('data-testid="album-board"');
    expect(html).toContain(`data-current-family="${famA}"`);
    expect(html).toContain(`data-board-photo-id="${photoId}"`);
    // There is no more legacy AlbumUploader/AlbumGrid pair — only the board (or, for a zero-family
    // viewer, AlbumControls — covered separately below).
    expect(html).not.toContain('data-testid="album-uploader"');
    expect(html).not.toContain('data-testid="album-grid"');
  });

  it("shows Google Photos chrome AND the file-add button when all families are selected and Google is configured", async () => {
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

    const html = await render(db, account(viewer), undefined);

    expect(html).toContain('data-testid="album-board"');
    // ADR-0021: the file-add button is always available now (the designator, not a hidden button,
    // resolves the ambiguous target). The target is still ambiguous here → empty default selection.
    expect(html).toContain('data-show-file-upload="true"');
    expect(html).toContain('data-default-selected=""');
    expect(html).toContain('data-google-configured="true"');
    expect(html).toContain('data-google-connected="true"');
  });

  // ADR-0021 regression: the board is shown REGARDLESS of filter state for a viewer with ≥1 family.
  // Sweep the three filter shapes (all-on / all-off / single) and assert the board is always mounted
  // with the file-add button available — the add/import flow is decoupled from the browse filter.
  it("shows the board regardless of filter state (all-on, all-off/none, single) for a ≥1-family viewer", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");
    const famA = await makeFamily(db, "Esposito", viewer);
    const famB = await makeFamily(db, "Marino", viewer);
    await addMember(db, viewer, famA);
    await addMember(db, viewer, famB);

    // absent = all-on (ambiguous target)
    const all = await render(db, account(viewer), undefined);
    expect(all).toContain('data-testid="album-board"');
    expect(all).toContain('data-show-file-upload="true"');
    expect(all).toContain('data-default-selected=""');

    // none = all-off (board still present, ambiguous target)
    const none = await render(db, account(viewer), "none");
    expect(none).toContain('data-testid="album-board"');
    expect(none).toContain('data-show-file-upload="true"');
    expect(none).toContain('data-default-selected=""');

    // a single family named (unambiguous → that family pre-selected)
    const one = await render(db, account(viewer), famA);
    expect(one).toContain('data-testid="album-board"');
    expect(one).toContain('data-show-file-upload="true"');
    expect(one).toContain(`data-default-selected="${famA}"`);
  });

  // A zero-family (pending-only) viewer has nothing to import — AlbumControls (not AlbumBoard) owns
  // that coherent hub-wide empty state, with no add affordance.
  it("a pending-only (zero-family) viewer renders AlbumControls, never AlbumBoard", async () => {
    const db = await createTestDatabase();
    const viewer = await makePerson(db, "Rosa");

    const html = await render(db, account(viewer), undefined);

    expect(html).toContain('data-testid="album-grid"');
    expect(html).not.toContain('data-testid="album-board"');
    expect(html).toContain('data-testid="album-empty-note"');
  });
});
