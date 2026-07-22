/**
 * Collapsed browse-panel shell selection (#300) — pure seam: compact → sheet, wide → popover.
 * Does not touch CSS breakpoints or expansion precedence (that's hub-control-expansion).
 */
import { describe, expect, it } from "vitest";
import { resolveCollapsedBrowseShell } from "./collapsed-browse-shell";

describe("resolveCollapsedBrowseShell", () => {
  it("selects bottom sheet on compact viewports", () => {
    expect(resolveCollapsedBrowseShell(true)).toBe("sheet");
  });

  it("selects anchored popover on wide viewports", () => {
    expect(resolveCollapsedBrowseShell(false)).toBe("popover");
  });
});
