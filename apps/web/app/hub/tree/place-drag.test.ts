/**
 * place-drag (#287) — payload encode/parse + zone drop → modal props (thin; no DnD physics).
 */
import { describe, expect, it } from "vitest";
import { relationFromZone } from "./place-confirm";
import {
  encodePlaceDrag,
  parsePlaceDragData,
  subjectFromPlaceDrag,
  zoneDropModalProps,
} from "./place-drag";

describe("place-drag payload (#287)", () => {
  it("round-trips link and mint payloads", () => {
    const link = parsePlaceDragData(
      encodePlaceDrag({ kind: "link", personId: "u1", displayName: "Rosa" }),
    );
    expect(link).toEqual({ kind: "link", personId: "u1", displayName: "Rosa" });
    expect(parsePlaceDragData(encodePlaceDrag({ kind: "mint" }))).toEqual({ kind: "mint" });
  });

  it("rejects malformed payloads", () => {
    expect(parsePlaceDragData("")).toBeNull();
    expect(parsePlaceDragData("{}")).toBeNull();
    expect(parsePlaceDragData('{"kind":"link"}')).toBeNull();
    expect(parsePlaceDragData("not-json")).toBeNull();
  });
});

describe("zoneDropModalProps (#287 / ADR-0027)", () => {
  it("maps each zone to locked receiver + relationFromZone (side = partner only)", () => {
    const subject = subjectFromPlaceDrag({
      kind: "link",
      personId: "u1",
      displayName: "Rosa",
    });
    const receiver = { personId: "elena", displayName: "Elena" };

    for (const zone of ["top", "bottom", "side"] as const) {
      const props = zoneDropModalProps(zone, receiver, subject);
      expect(props.receiverLocked).toBe(true);
      expect(props.receiver).toEqual(receiver);
      expect(props.subject).toEqual(subject);
      expect(props.initialRelation).toBe(relationFromZone(zone));
    }

    expect(zoneDropModalProps("side", receiver, subject).initialRelation).toBe("partner");
    expect(zoneDropModalProps("top", receiver, subject).initialRelation).toBe("parent");
    expect(zoneDropModalProps("bottom", receiver, subject).initialRelation).toBe("child");
  });

  it("mint subject stays mint through the zone→modal seam", () => {
    const props = zoneDropModalProps(
      "bottom",
      { personId: "elena", displayName: "Elena" },
      subjectFromPlaceDrag({ kind: "mint" }),
    );
    expect(props.subject).toEqual({ kind: "mint" });
    expect(props.initialRelation).toBe("child");
  });
});
