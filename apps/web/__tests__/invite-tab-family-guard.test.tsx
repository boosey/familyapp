/**
 * Regression tests for the Invite tab's two family-target defects (feat/family-scope-selector review).
 *
 * Finding 1: a pending-only viewer (member of NO family) reaching /hub?tab=invite directly must NOT be
 *   shown a broken form — a `<select name="familyId" required>` with zero options. The tab degrades to
 *   the shared `hub.shell.pendingEmpty` copy, mirroring StoriesTab/AlbumSurface/AsksTab, and never
 *   throws on zero families.
 *
 * Finding 2: in "all" scope with >1 family, the family select must carry a disabled placeholder so the
 *   browser can't silently auto-select the first (arbitrary) family — `required` then forces an
 *   explicit pick. With a single family (or a scoped default) no placeholder is needed.
 *
 * InviteTab is an async server component reading `@/lib/runtime` + `next/headers`; both are mocked. The
 * membership/candidate reads run for real against PGlite.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// No invite flash cookies in these render paths → the form / empty-state branch is exercised.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => ({ get: () => null }),
}));

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { InviteTab } from "@/app/hub/tabs/InviteTab";
import { parseFamilyFilter } from "@/lib/family-filter";
import { hub } from "@/app/_copy";

// renderToStaticMarkup HTML-escapes apostrophes, so match the distinctive leading fragment.
const PENDING_FRAGMENT = "Nothing here yet";

async function makePerson(db: Database, name: string): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
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

// Build the tab's real props from the current auth context, translating the legacy `scope` argument
// into the new (families + filter) shape: "all" → no `?families=` filter; a family id → a `?families=`
// filter naming that one family. The designator seeds from the filter, exactly as page.tsx does.
async function render(scope: string): Promise<string> {
  const activeFamilies =
    authCtx.kind === "account" && authCtx.personId
      ? await listActiveFamiliesForPerson(runtimeDb, authCtx.personId)
      : [];
  const families = activeFamilies.map((f) => ({ id: f.familyId, name: f.familyName }));
  const activeIds = activeFamilies.map((f) => f.familyId);
  const filter = parseFamilyFilter(scope === "all" ? undefined : scope, activeIds);
  return renderToStaticMarkup(await InviteTab({ families, filter }));
}

describe("InviteTab — pending-only viewer (Finding 1)", () => {
  it("shows the pending-only empty copy and NO family <select> when the viewer belongs to no family", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Newcomer");
    authCtx = { kind: "account", personId: viewer };

    const html = await render("all");

    expect(html).toContain(PENDING_FRAGMENT);
    // A zero-option required select is the broken form the fix prevents.
    expect(html).not.toContain('name="familyId"');
  });
});

describe("InviteTab — all-scope ambiguity guard (Finding 2)", () => {
  it("prepends a disabled placeholder so no family is pre-selected in 'all' with >1 family", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    const famB = await makeFamily(runtimeDb, "Marino", viewer);
    await addMember(runtimeDb, viewer, famA);
    await addMember(runtimeDb, viewer, famB);
    authCtx = { kind: "account", personId: viewer };

    const html = await render("all");

    // The placeholder copy is present and rendered as a disabled empty-value option.
    expect(html).toContain(hub.invite.familyChoosePlaceholder);
    expect(html).toMatch(/<option value="" disabled[^>]*>/);
    // Both selects (member + narrator invite) are present.
    const familySelects = html.split('name="familyId"').length - 1;
    expect(familySelects).toBe(2);
  });

  it("does NOT add a placeholder when the viewer has a single family (unambiguous)", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    await addMember(runtimeDb, viewer, famA);
    authCtx = { kind: "account", personId: viewer };

    const html = await render("all");

    expect(html).not.toContain(hub.invite.familyChoosePlaceholder);
    expect(html).not.toMatch(/<option value="" disabled[^>]*>/);
  });

  it("does NOT add a placeholder when a valid family scope supplies a deliberate default", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    const famB = await makeFamily(runtimeDb, "Marino", viewer);
    await addMember(runtimeDb, viewer, famA);
    await addMember(runtimeDb, viewer, famB);
    authCtx = { kind: "account", personId: viewer };

    const html = await render(famB);

    expect(html).not.toContain(hub.invite.familyChoosePlaceholder);
  });
});
