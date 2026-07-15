/**
 * Tests for `canViewerSeePerson` — the viewer-scoped person-visibility gate behind /hub/person/[id]
 * (tree Slice B, cold-review blocker fix). A person is visible iff the viewer would reach them in a
 * family they can browse: SELF always, or a SHARED active family membership. This closes the
 * existence + name leak where any authenticated user could open the page for a person in a wholly
 * unrelated family and see their real name in the heading.
 *
 * All fixtures use PGlite (real Postgres).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import { canViewerSeePerson, type AuthContext } from "../src/index";
import { addMembership, endMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

describe("canViewerSeePerson — person reachability gate", () => {
  it("SELF is always visible (even with no family)", async () => {
    const me = await makePerson(db, "Me");
    expect(await canViewerSeePerson(db, account(me.id), me.id)).toBe(true);
  });

  it("a person in a SHARED active family is visible", async () => {
    const viewer = await makePerson(db, "Viewer");
    const relative = await makePerson(db, "Relative");
    const fam = await makeFamily(db, "Esposito", viewer.id);
    await addMembership(db, viewer.id, fam.id);
    await addMembership(db, relative.id, fam.id);

    expect(await canViewerSeePerson(db, account(viewer.id), relative.id)).toBe(true);
    // Symmetric — the relative can see the viewer too.
    expect(await canViewerSeePerson(db, account(relative.id), viewer.id)).toBe(true);
  });

  // ===================================================================================
  // THE LOAD-BEARING REGRESSION TEST (cold-review blocker): a person in a DISJOINT family
  // — no shared active membership, not kin — must NOT be visible. The page turns this into
  // notFound(), so a hidden person is indistinguishable from a nonexistent id and their
  // name never reaches the response. If this ever returns true, the existence/name leak is back.
  // ===================================================================================
  it("a person in a DISJOINT family (no shared membership) is NOT visible", async () => {
    const viewerA = await makePerson(db, "Viewer A");
    const strangerB = await makePerson(db, "Stranger B");
    const famA = await makeFamily(db, "Family A", viewerA.id);
    const famB = await makeFamily(db, "Family B", strangerB.id);
    await addMembership(db, viewerA.id, famA.id);
    await addMembership(db, strangerB.id, famB.id);
    // No shared family whatsoever.

    expect(await canViewerSeePerson(db, account(viewerA.id), strangerB.id)).toBe(false);
  });

  it("is NOT visible once the shared membership is ENDED (co-membership must be ACTIVE)", async () => {
    const viewer = await makePerson(db, "Viewer");
    const other = await makePerson(db, "Other");
    const fam = await makeFamily(db, "Esposito", viewer.id);
    await addMembership(db, viewer.id, fam.id);
    const m = await addMembership(db, other.id, fam.id);
    expect(await canViewerSeePerson(db, account(viewer.id), other.id)).toBe(true);

    // The other person leaves the family — they are no longer reachable.
    await endMembership(db, m.id);
    expect(await canViewerSeePerson(db, account(viewer.id), other.id)).toBe(false);
  });

  it("is NOT visible when the VIEWER's own membership is ended (they can browse nothing)", async () => {
    const viewer = await makePerson(db, "Viewer");
    const other = await makePerson(db, "Other");
    const fam = await makeFamily(db, "Esposito", viewer.id);
    const vm = await addMembership(db, viewer.id, fam.id);
    await addMembership(db, other.id, fam.id);

    await endMembership(db, vm.id);
    expect(await canViewerSeePerson(db, account(viewer.id), other.id)).toBe(false);
  });

  it("an anonymous viewer sees no one", async () => {
    const someone = await makePerson(db, "Someone");
    const fam = await makeFamily(db, "Esposito", someone.id);
    await addMembership(db, someone.id, fam.id);
    expect(await canViewerSeePerson(db, { kind: "anonymous" }, someone.id)).toBe(false);
  });
});
