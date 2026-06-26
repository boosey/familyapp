/**
 * Tests for the Ask repository (Increment 6 / wedge of Increment 7).
 *
 * Authorization rule: the asker must share an ACTIVE family membership with the target elder —
 * mirrors the family-tier read rule in the authorization function. The interviewer's
 * system-actor read (`listPendingAsksForElder`) is separately covered for ordering and inclusion.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  createAsk,
  listPendingAsksForElder,
} from "../src/index";
import { addMembership, endMembership, makeFamily, makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("createAsk — co-membership authorization", () => {
  it("allows a co-member of any shared family to ask", async () => {
    const elder = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", elder.id);
    await addMembership(db, elder.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: elder.id,
        familyId: fam.id,
        questionText: "What was your wedding day like?",
      },
    );
    expect(ask.status).toBe("queued");
    expect(ask.askerPersonId).toBe(cousin.id);
    expect(ask.targetPersonId).toBe(elder.id);
    expect(ask.familyId).toBe(fam.id);
  });

  it("rejects a stranger (no shared family)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamily(db, "Boudreaux", elder.id);
    await addMembership(db, elder.id, fam.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: stranger.id },
        { targetPersonId: elder.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a former co-member whose membership has ENDED (divorce semantics)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const exSpouse = await makePerson(db, "Ex");
    const fam = await makeFamily(db, "Boudreaux", elder.id);
    await addMembership(db, elder.id, fam.id);
    const m = await addMembership(db, exSpouse.id, fam.id);
    await endMembership(db, m.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: exSpouse.id },
        { targetPersonId: elder.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects anonymous askers", async () => {
    const elder = await makePerson(db, "Eleanor");
    await expect(
      createAsk(
        db,
        { kind: "anonymous" },
        { targetPersonId: elder.id, questionText: "..." },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects an empty question (trims whitespace)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "B", elder.id);
    await addMembership(db, elder.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        { targetPersonId: elder.id, questionText: "   \n  " },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects a supplied familyId the asker is not actually in (form-spoof defense)", async () => {
    const elder = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const shared = await makeFamily(db, "Shared", elder.id);
    const other = await makeFamily(db, "Other", elder.id);
    await addMembership(db, elder.id, shared.id);
    await addMembership(db, cousin.id, shared.id);
    // cousin is NOT in `other`, but tries to claim that family context
    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        {
          targetPersonId: elder.id,
          familyId: other.id,
          questionText: "Q",
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("listPendingAsksForElder", () => {
  it("returns queued/routed asks in arrival order, with asker's spoken name", async () => {
    const elder = await makePerson(db, "Eleanor");
    const a = await makePerson(db, "Sofia");
    const b = await makePerson(db, "Marco");
    const fam = await makeFamily(db, "B", elder.id);
    await addMembership(db, elder.id, fam.id);
    await addMembership(db, a.id, fam.id);
    await addMembership(db, b.id, fam.id);

    const askA = await createAsk(
      db,
      { kind: "account", personId: a.id },
      { targetPersonId: elder.id, questionText: "Q-A" },
    );
    // tiny delay so createdAt ordering is deterministic
    await new Promise((r) => setTimeout(r, 5));
    const askB = await createAsk(
      db,
      { kind: "account", personId: b.id },
      { targetPersonId: elder.id, questionText: "Q-B" },
    );

    const pending = await listPendingAsksForElder(db, elder.id);
    expect(pending.map((p) => p.ask.id)).toEqual([askA.id, askB.id]);
    expect(pending.map((p) => p.askerSpokenName)).toEqual(["Sofia", "Marco"]);
  });
});
