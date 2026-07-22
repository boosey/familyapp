/**
 * place-confirm re-exports Placement seam (#318). Zone mapping covered in placement.test.ts.
 */
import { describe, expect, it } from "vitest";
import { relationFromZone } from "./place-confirm";

describe("relationFromZone (re-export)", () => {
  it("maps top/bottom/side to parent/child/partner", () => {
    expect(relationFromZone("top")).toBe("parent");
    expect(relationFromZone("bottom")).toBe("child");
    expect(relationFromZone("side")).toBe("partner");
  });
});
