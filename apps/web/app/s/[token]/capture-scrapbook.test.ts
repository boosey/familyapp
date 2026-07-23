/**
 * CSS-source guards for capture Scrapbook modules (KindredPromptCard + link-session capture/approve).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("capture Scrapbook CSS modules", () => {
  it("KindredPromptCard has scrapbook signatures + reduce-motion suppressors", () => {
    const css = readFileSync(join(APP_DIR, "_kindred", "KindredPromptCard.module.css"), "utf8");
    expect(css).toContain(':global(:root[data-skin="scrapbook"])');
    expect(css).toContain(":global(:root[data-reduce-motion=\"on\"])");
    expect(css).toContain(".card::before");
    expect(css).toContain("var(--highlighter)");
  });

  it("capture.module.css is mobile-first and scrapbook-aware", () => {
    const css = readFileSync(join(APP_DIR, "s", "[token]", "capture.module.css"), "utf8");
    expect(css).toContain("@media (min-width: 40rem)");
    expect(css).toContain(':global(:root[data-skin="scrapbook"])');
    // Phone demotes greeting chrome
    expect(css).toMatch(/\.hello\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.invite\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.date\s*\{[^}]*display:\s*none/);
  });

  it("approve.module.css pins listen to bottom and has scrapbook shelf", () => {
    const css = readFileSync(
      join(APP_DIR, "s", "[token]", "approve", "[storyId]", "approve.module.css"),
      "utf8",
    );
    expect(css).toContain(".listenBottom");
    expect(css).toContain("margin-top: auto");
    expect(css).toContain(':global(:root[data-skin="scrapbook"])');
    expect(css).toContain(".storyShelf");
    expect(css).toContain(":global(:root[data-reduce-motion=\"on\"])");
  });
});
