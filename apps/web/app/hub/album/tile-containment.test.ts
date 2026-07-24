/**
 * #219 — `tileContainment` centralizes the `content-visibility` opt-in for uniform (square) photo
 * tiles. The contract: it always sets `content-visibility: auto` and a `contain-intrinsic-size`
 * placeholder — from the passed size, or the shared default when called bare.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_INTRINSIC_PX, tileContainment } from "./tile-containment";

describe("tileContainment (#219)", () => {
  it("sets content-visibility:auto and an intrinsic-size hint from the passed size", () => {
    expect(tileContainment(120)).toEqual({
      contentVisibility: "auto",
      containIntrinsicSize: "auto 120px",
    });
  });

  it("falls back to the shared default intrinsic size when called bare", () => {
    expect(tileContainment()).toEqual({
      contentVisibility: "auto",
      containIntrinsicSize: `auto ${DEFAULT_TILE_INTRINSIC_PX}px`,
    });
  });
});
