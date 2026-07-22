import { expect, it } from "vitest";
import { matchUnplacedByDisplayName, normalizeDisplayName } from "./match-unplaced";

it("normalizeDisplayName trims, collapses space, and lower-cases", () => {
  expect(normalizeDisplayName("  Kelly   Boudreaux ")).toBe("kelly boudreaux");
});

it("matchUnplacedByDisplayName returns exact normalized matches", () => {
  const unplaced = [
    { personId: "k1", displayName: "Kelly Boudreaux" },
    { personId: "k2", displayName: "Kelly" },
    { personId: "r1", displayName: "Rosa" },
  ];
  expect(matchUnplacedByDisplayName("kelly  boudreaux", unplaced).map((m) => m.personId)).toEqual([
    "k1",
  ]);
  expect(matchUnplacedByDisplayName("KELLY", unplaced).map((m) => m.personId)).toEqual(["k2"]);
});

it("matchUnplacedByDisplayName ignores blank names and null displayNames", () => {
  const unplaced = [
    { personId: "u1", displayName: null },
    { personId: "u2", displayName: "   " },
  ];
  expect(matchUnplacedByDisplayName("", unplaced)).toEqual([]);
  expect(matchUnplacedByDisplayName("   ", unplaced)).toEqual([]);
  expect(matchUnplacedByDisplayName("Anyone", unplaced)).toEqual([]);
});

it("matchUnplacedByDisplayName excludes listed person ids (e.g. the add anchor)", () => {
  const unplaced = [
    { personId: "self", displayName: "John" },
    { personId: "kelly", displayName: "Kelly" },
  ];
  expect(
    matchUnplacedByDisplayName("John", unplaced, ["self"]).map((m) => m.personId),
  ).toEqual([]);
  expect(
    matchUnplacedByDisplayName("Kelly", unplaced, new Set(["self"])).map((m) => m.personId),
  ).toEqual(["kelly"]);
});
