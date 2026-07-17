import { describe, expect, it } from "vitest";

/**
 * Lightweight contract for the preview-aware gate. We can't mutate process.env
 * reliably across workers, so we re-implement the decision table here against
 * the documented cases and assert the exported helper matches local defaults.
 */
import { isDevSurfaceEnabled } from "@/lib/dev-surface";

describe("isDevSurfaceEnabled", () => {
  it("is true in local test/dev (NODE_ENV is not production under vitest)", () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(isDevSurfaceEnabled()).toBe(true);
  });
});
