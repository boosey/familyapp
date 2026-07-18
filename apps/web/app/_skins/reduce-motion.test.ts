import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
const here = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(here, "../globals.css"), "utf8");

describe("reduce-motion guard", () => {
  it("collapses transitions/animations under data-reduce-motion=on", () => {
    expect(globals).toMatch(/\[data-reduce-motion="on"\][^{]*\{[^}]*transition-duration:\s*0\.001ms/s);
    expect(globals).toMatch(/\[data-reduce-motion="on"\][^{]*\{[^}]*animation-duration:\s*0\.001ms/s);
  });
});
