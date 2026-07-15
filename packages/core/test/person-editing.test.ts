/**
 * ADR-0021 (tree Slice C) — cross-person identity editing.
 *
 * The auth predicate `canEditPerson` is the risk surface, so its truth table is tested exhaustively:
 * self / creator / steward / deceased-family ALLOW; living-non-self, non-member, anonymous DENY. The
 * write choke point `updatePersonIdentityAsEditor` is tested to REJECT a disallowed editor even when
 * called directly (not merely UI-hidden), to apply an allowed patch, to flip `identified` when a
 * nameless mention is named (#5), and to keep `createdByPersonId` immutable across an edit.
 *
 * All fixtures use PGlite (real Postgres in-process).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRelative,
  canEditPerson,
  updatePersonIdentityAsEditor,
  AuthorizationError,
  type AuthContext,
} from "../src/index";
import { addMembership as addActiveMembership } from "../src/memberships";
import { makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });
const anonymous: AuthContext = { kind: "anonymous" };

/** Insert a bare `mention` person (no membership) with explicit fields, returning its id. */
async function makeMention(opts: {
  displayName?: string | null;
  lifeStatus?: "living" | "deceased";
  createdByPersonId?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(persons)
    .values({
      displayName: opts.displayName ?? null,
      spokenName: opts.displayName ? opts.displayName.split(/\s+/)[0]! : null,
      origin: "mention",
      identified: opts.displayName != null,
      lifeStatus: opts.lifeStatus ?? "living",
      createdByPersonId: opts.createdByPersonId ?? null,
    })
    .returning({ id: persons.id });
  return row!.id;
}

describe("canEditPerson truth table (ADR-0021)", () => {
  it("SELF — a viewer may edit their own record", async () => {
    const me = await makePerson(db, "Me");
    const d = await canEditPerson(db, account(me.id), me.id);
    expect(d).toEqual({ allowed: true, reason: "self" });
  });

  it("CREATOR — the viewer who minted the record may edit it (living, non-self)", async () => {
    const me = await makePerson(db, "Me");
    const target = await makeMention({
      displayName: "Placeholder",
      lifeStatus: "living",
      createdByPersonId: me.id,
    });
    const d = await canEditPerson(db, account(me.id), target);
    expect(d).toEqual({ allowed: true, reason: "creator" });
  });

  it("STEWARD — the steward of a family the (living) person actively belongs to may edit", async () => {
    const steward = await makePerson(db, "Steward");
    const fam = await makeFamily(db, "Carney", steward.id); // makeFamily sets steward = creator
    const target = await makePerson(db, "Member"); // NOT created by the steward
    await addActiveMembership(db, { personId: target.id, familyId: fam.id });

    const d = await canEditPerson(db, account(steward.id), target.id);
    expect(d).toEqual({ allowed: true, reason: "steward" });
  });

  it("DECEASED-FAMILY — any active co-member may edit a DECEASED person", async () => {
    const owner = await makePerson(db, "Owner"); // steward of the family
    const fam = await makeFamily(db, "Boudreaux", owner.id);
    // The deceased ancestor: an active member, deceased, NOT created by the editor.
    const deceased = await makePerson(db, "Grandpa");
    await db
      .update(persons)
      .set({ lifeStatus: "deceased" })
      .where(eq(persons.id, deceased.id));
    await addActiveMembership(db, { personId: deceased.id, familyId: fam.id });
    // The editor: a plain co-member (not steward, not creator).
    const editor = await makePerson(db, "Cousin");
    await addActiveMembership(db, { personId: editor.id, familyId: fam.id });

    const d = await canEditPerson(db, account(editor.id), deceased.id);
    expect(d).toEqual({ allowed: true, reason: "deceased-family" });
  });

  it("DENY — a LIVING, non-self person is not editable by a plain co-member (not steward/creator)", async () => {
    const owner = await makePerson(db, "Owner");
    const fam = await makeFamily(db, "Fam", owner.id);
    const living = await makePerson(db, "Alice"); // living member, not created by editor
    await addActiveMembership(db, { personId: living.id, familyId: fam.id });
    const editor = await makePerson(db, "Bob");
    await addActiveMembership(db, { personId: editor.id, familyId: fam.id });

    const d = await canEditPerson(db, account(editor.id), living.id);
    expect(d).toEqual({ allowed: false, reason: null });
  });

  it("DENY — a non-member viewer cannot edit even a deceased person", async () => {
    const owner = await makePerson(db, "Owner");
    const fam = await makeFamily(db, "Fam", owner.id);
    const deceased = await makePerson(db, "Ancestor");
    await db
      .update(persons)
      .set({ lifeStatus: "deceased" })
      .where(eq(persons.id, deceased.id));
    await addActiveMembership(db, { personId: deceased.id, familyId: fam.id });
    const stranger = await makePerson(db, "Stranger"); // shares no family

    const d = await canEditPerson(db, account(stranger.id), deceased.id);
    expect(d).toEqual({ allowed: false, reason: null });
  });

  it("DENY — an anonymous viewer can never edit", async () => {
    const target = await makePerson(db, "Anyone");
    const d = await canEditPerson(db, anonymous, target.id);
    expect(d).toEqual({ allowed: false, reason: null });
  });

  it("DENY — an unknown personId is denied (person must exist)", async () => {
    const me = await makePerson(db, "Me");
    const d = await canEditPerson(db, account(me.id), "00000000-0000-0000-0000-000000000000");
    expect(d).toEqual({ allowed: false, reason: null });
  });

  it("precedence — self wins even when the viewer is also the steward of their own family", async () => {
    const me = await makePerson(db, "Me");
    await makeFamily(db, "Mine", me.id); // me is steward
    const d = await canEditPerson(db, account(me.id), me.id);
    expect(d.reason).toBe("self");
  });
});

describe("updatePersonIdentityAsEditor write guard (ADR-0021)", () => {
  it("REJECTS a disallowed editor even when called DIRECTLY (not UI-hidden)", async () => {
    const owner = await makePerson(db, "Owner");
    const fam = await makeFamily(db, "Fam", owner.id);
    const living = await makePerson(db, "Alice", );
    await addActiveMembership(db, { personId: living.id, familyId: fam.id });
    const editor = await makePerson(db, "Bob");
    await addActiveMembership(db, { personId: editor.id, familyId: fam.id });

    await expect(
      updatePersonIdentityAsEditor(db, account(editor.id), living.id, {
        displayName: "Hacked Name",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // The row is untouched.
    const [row] = await db
      .select({ displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, living.id));
    expect(row!.displayName).toBe("Alice");
  });

  it("REJECTS an anonymous caller", async () => {
    const target = await makePerson(db, "Target");
    await expect(
      updatePersonIdentityAsEditor(db, anonymous, target.id, { displayName: "X" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("allows a steward to edit a member's dates + sex + lifeStatus", async () => {
    const steward = await makePerson(db, "Steward");
    const fam = await makeFamily(db, "Fam", steward.id);
    const target = await makePerson(db, "Member");
    await addActiveMembership(db, { personId: target.id, familyId: fam.id });

    await updatePersonIdentityAsEditor(db, account(steward.id), target.id, {
      birthYear: 1950,
      birthMonth: 3,
      birthDay: 4,
      sex: "female",
      lifeStatus: "deceased",
      deathYear: 2001,
    });

    const [row] = await db
      .select({
        birthYear: persons.birthYear,
        birthDate: persons.birthDate,
        sex: persons.sex,
        lifeStatus: persons.lifeStatus,
        deathYear: persons.deathYear,
      })
      .from(persons)
      .where(eq(persons.id, target.id));
    expect(row).toMatchObject({
      birthYear: 1950,
      birthDate: "1950-03-04",
      sex: "female",
      lifeStatus: "deceased",
      deathYear: 2001,
    });
  });

  it("year-only birth edit sets birthYear and CLEARS any full birthDate (tree grain)", async () => {
    // Regression: an editor who knows only the year must not be forced to supply month+day. A
    // year-only patch (the tree card's grain) is accepted and nulls any stored full date.
    const steward = await makePerson(db, "Steward");
    const fam = await makeFamily(db, "Fam", steward.id);
    const target = await makePerson(db, "Member");
    await addActiveMembership(db, { personId: target.id, familyId: fam.id });
    // Seed a full date first.
    await updatePersonIdentityAsEditor(db, account(steward.id), target.id, {
      birthYear: 1960,
      birthMonth: 6,
      birthDay: 15,
    });
    let [row] = await db
      .select({ birthYear: persons.birthYear, birthDate: persons.birthDate })
      .from(persons)
      .where(eq(persons.id, target.id));
    expect(row).toMatchObject({ birthYear: 1960, birthDate: "1960-06-15" });

    // Now a year-only edit.
    await updatePersonIdentityAsEditor(db, account(steward.id), target.id, { birthYear: 1961 });
    [row] = await db
      .select({ birthYear: persons.birthYear, birthDate: persons.birthDate })
      .from(persons)
      .where(eq(persons.id, target.id));
    expect(row).toMatchObject({ birthYear: 1961, birthDate: null });
  });

  it("rejects a partial full date (month without day)", async () => {
    const steward = await makePerson(db, "Steward");
    const fam = await makeFamily(db, "Fam", steward.id);
    const target = await makePerson(db, "Member");
    await addActiveMembership(db, { personId: target.id, familyId: fam.id });
    await expect(
      updatePersonIdentityAsEditor(db, account(steward.id), target.id, {
        birthYear: 1970,
        birthMonth: 4,
      }),
    ).rejects.toThrow();
  });

  it("#5 — naming a previously-UNIDENTIFIED mention flips `identified` true", async () => {
    const me = await makePerson(db, "Me");
    // A nameless bridge the editor created → creator arm allows the edit.
    const bridge = await makeMention({
      displayName: null,
      lifeStatus: "living",
      createdByPersonId: me.id,
    });
    // Precondition: unidentified.
    const [before] = await db
      .select({ identified: persons.identified })
      .from(persons)
      .where(eq(persons.id, bridge));
    expect(before!.identified).toBe(false);

    await updatePersonIdentityAsEditor(db, account(me.id), bridge, {
      displayName: "Great-Aunt Mabel",
    });

    const [after] = await db
      .select({ identified: persons.identified, displayName: persons.displayName, origin: persons.origin })
      .from(persons)
      .where(eq(persons.id, bridge));
    expect(after).toMatchObject({
      identified: true,
      displayName: "Great-Aunt Mabel",
      origin: "mention", // origin unchanged (ADR-0016)
    });
  });

  it("a non-self editor's spokenName is IGNORED (narrator concept, self-only)", async () => {
    const me = await makePerson(db, "Me");
    const target = await makeMention({
      displayName: null,
      lifeStatus: "living",
      createdByPersonId: me.id,
    });
    await updatePersonIdentityAsEditor(db, account(me.id), target, {
      displayName: "Robert Smith",
      spokenName: "SHOULD_BE_IGNORED",
    });
    const [row] = await db
      .select({ spokenName: persons.spokenName, displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, target));
    // spokenName was NOT set by the editor path (me is not the SELF of `target`).
    expect(row!.spokenName).toBeNull();
    expect(row!.displayName).toBe("Robert Smith");
  });
});

describe("createdByPersonId provenance (ADR-0021)", () => {
  it("addRelative sets createdByPersonId to the acting viewer, on the relative AND any bridge", async () => {
    const me = await makePerson(db, "Me");
    const fam = await makeFamily(db, "Esposito", me.id);
    await addActiveMembership(db, { personId: me.id, familyId: fam.id });

    // Grandparent add with no recorded parent mints ONE bridge → both carry me as creator.
    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "grandparent",
      displayName: "Grandpa Joe",
    });
    expect(res.allowed).toBe(true);
    const created = res.createdPersonId!;
    const bridge = res.bridgePersonId!;

    const rows = await db
      .select({ id: persons.id, createdBy: persons.createdByPersonId })
      .from(persons)
      .where(eq(persons.id, created));
    expect(rows[0]!.createdBy).toBe(me.id);

    const [bridgeRow] = await db
      .select({ createdBy: persons.createdByPersonId })
      .from(persons)
      .where(eq(persons.id, bridge));
    expect(bridgeRow!.createdBy).toBe(me.id);
  });

  it("createdByPersonId is IMMUTABLE — a later identity edit never changes it", async () => {
    const me = await makePerson(db, "Me");
    const fam = await makeFamily(db, "Esposito", me.id);
    await addActiveMembership(db, { personId: me.id, familyId: fam.id });

    const res = await addRelative(db, account(me.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Mom",
    });
    const created = res.createdPersonId!;

    // Edit the relative (creator arm allows it) and confirm provenance is unchanged.
    await updatePersonIdentityAsEditor(db, account(me.id), created, {
      displayName: "Mom Renamed",
      sex: "female",
    });

    const [row] = await db
      .select({ createdBy: persons.createdByPersonId, displayName: persons.displayName })
      .from(persons)
      .where(eq(persons.id, created));
    expect(row!.createdBy).toBe(me.id);
    expect(row!.displayName).toBe("Mom Renamed");
  });
});
