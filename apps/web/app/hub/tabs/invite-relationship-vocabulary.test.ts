/**
 * Guard: the invite-relationship picker copy (#164) must stay in lockstep with the Drizzle enum that
 * is the single source of truth. The runtime parse guard already derives its vocabulary from
 * `inviteRelationshipEnum.enumValues`; this pins the two copy maps (option labels + derived display
 * labels) to the same enum so adding/removing a relationship can't silently leave the picker showing
 * a stale set or the server deriving a label for a value the form never offers.
 */
import { inviteRelationshipEnum } from "@chronicle/db/schema";
import { describe, expect, it } from "vitest";
import { hub } from "@/app/_copy";

describe("invite relationship vocabulary (#164)", () => {
  const enumValues = [...inviteRelationshipEnum.enumValues].sort();

  it("the picker option labels cover exactly the enum vocabulary", () => {
    expect(Object.keys(hub.invite.relationshipOptions).sort()).toEqual(enumValues);
  });

  it("the derived display labels cover exactly the DIRECT (non-'other') values", () => {
    const direct = enumValues.filter((v) => v !== "other");
    expect(Object.keys(hub.invite.relationshipDisplayLabels).sort()).toEqual(direct);
  });
});
