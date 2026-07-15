/**
 * Regression tests for the Invite tab's two family-target defects (feat/family-scope-selector review).
 *
 * Finding 1: a pending-only viewer (member of NO family) reaching /hub?tab=invite directly must NOT be
 *   shown a broken form — a `<select name="familyId" required>` with zero options. The tab degrades to
 *   the shared `hub.shell.pendingEmpty` copy, mirroring StoriesTab/AlbumSurface/AsksTab, and never
 *   throws on zero families.
 *
 * Finding 2: in "all" scope with >1 family, the family designator (now aria-pressed chips) must NOT
 *   pre-select any family — its hidden `required` input stays empty so an empty submit is blocked and no
 *   arbitrary family is silently chosen. With a single family (or a scoped default) exactly one chip is
 *   pre-selected and its id is posted.
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
  it("pre-selects NO family (empty required designator) in 'all' with >1 family", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    const famB = await makeFamily(runtimeDb, "Marino", viewer);
    await addMember(runtimeDb, viewer, famA);
    await addMember(runtimeDb, viewer, famB);
    authCtx = { kind: "account", personId: viewer };

    const html = await render("all");

    // No chip is pre-selected — the browser can't silently target an arbitrary family.
    expect(html).not.toMatch(/aria-pressed="true"/);
    // Both forms (member + narrator invite) carry the hidden required familyId input, and both are
    // empty so an empty submit is blocked.
    const familyInputs = html.split('name="familyId"').length - 1;
    expect(familyInputs).toBe(2);
    // The hidden family input is required and empty (an empty submit is blocked).
    expect(html).toMatch(/required[^>]*name="familyId"[^>]*value=""/);
  });

  it("pre-selects the lone family (chip ON, id posted) for a single-family viewer", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    await addMember(runtimeDb, viewer, famA);
    authCtx = { kind: "account", personId: viewer };

    const html = await render("all");

    // The lone family is auto-resolved: its chip is ON and its id posts.
    expect(html).toMatch(/aria-pressed="true"/);
    expect(html).toContain(`value="${famA}"`);
  });

  it("pre-selects the scoped family when a valid family scope supplies a deliberate default", async () => {
    runtimeDb = await createTestDatabase();
    const viewer = await makePerson(runtimeDb, "Rosa");
    const famA = await makeFamily(runtimeDb, "Esposito", viewer);
    const famB = await makeFamily(runtimeDb, "Marino", viewer);
    await addMember(runtimeDb, viewer, famA);
    await addMember(runtimeDb, viewer, famB);
    authCtx = { kind: "account", personId: viewer };

    const html = await render(famB);

    // The scoped family (famB) seeds the designator: a chip is ON and famB's id posts.
    expect(html).toMatch(/aria-pressed="true"/);
    expect(html).toContain(`value="${famB}"`);
  });
});
