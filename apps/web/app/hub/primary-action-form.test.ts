/**
 * Primary-action iconify choice (#301) — outside browse expansion precedence.
 */
import { describe, expect, it } from "vitest";
import { resolvePrimaryActionForm } from "./primary-action-form";

describe("resolvePrimaryActionForm", () => {
  it("prefers labeled when fully-collapsed browse + labeled action fit", () => {
    expect(
      resolvePrimaryActionForm({
        availableWidth: 400,
        minBrowseWidth: 200,
        gapsWidth: 24,
        labeledActionWidth: 120,
        iconifiedActionWidth: 48,
      }),
    ).toBe("labeled");
  });

  it("iconifies when labeled action would not fit with min browse", () => {
    expect(
      resolvePrimaryActionForm({
        availableWidth: 300,
        minBrowseWidth: 200,
        gapsWidth: 24,
        labeledActionWidth: 120,
        iconifiedActionWidth: 48,
      }),
    ).toBe("iconified");
  });
});
