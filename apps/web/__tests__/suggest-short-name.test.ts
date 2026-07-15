import { describe, expect, it } from "vitest";
import { suggestShortName } from "@/lib/suggest-short-name";

describe("suggestShortName (ADR-0021 deterministic heuristic)", () => {
  it.each([
    ["The Boudreaux family", "Boudreaux"],
    ["Boudreaux family", "Boudreaux"],
    ["The Espositos", "Espositos"],
    ["Mom's side", "Mom's side"], // unchanged — core not name-shaped
    ["Smith-Jones family", "Smith-Jones"],
    ["Van Der Berg family", "Van Der Berg"],
    ["The Bélangér family", "Bélangér"], // accented surname — Unicode-aware name-shaped test
    ["Ñoño clan", "Ñoño"], // non-ASCII leading capital
    ["The family", "The family"], // unchanged — stripping leaves a non-name-shaped "family"
    ["the boudreaux family", "the boudreaux family"], // unchanged — lowercase core
    ["", ""],
    ["   ", ""],
    ["Boudreaux", "Boudreaux"], // no affixes; name-shaped, returned as-is
  ])("%j → %j", (input, expected) => {
    expect(suggestShortName(input)).toBe(expected);
  });
});
