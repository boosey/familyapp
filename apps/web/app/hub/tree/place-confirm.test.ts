/**
 * place-confirm helpers (#286) — zone→relation mapping for future DnD/tap, plus write-arg shape.
 */
import { describe, expect, it } from "vitest";
import { relationFromZone } from "./place-confirm";

describe("relationFromZone (#286 / ADR-0027)", () => {
  it("maps top/bottom/side to parent/child/partner (no sibling zone)", () => {
    expect(relationFromZone("top")).toBe("parent");
    expect(relationFromZone("bottom")).toBe("child");
    expect(relationFromZone("side")).toBe("partner");
  });
});
