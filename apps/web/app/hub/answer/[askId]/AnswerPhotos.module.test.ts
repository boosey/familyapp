/**
 * AnswerPhotos.module.css + AskPhotoPicker tile hover (issue #208) — assert the photo CELLS get the
 * light-touch Scrapbook hover-lift + accent ring, skin-scoped and suppressed under reduce-motion /
 * solemn. Follows the contrast.test.ts pattern of reading the stylesheet source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const answerCss = readFileSync(join(here, "AnswerPhotos.module.css"), "utf8");
const pickerCss = readFileSync(
  join(here, "../../tabs/AskPhotoPicker.module.css"),
  "utf8",
);

describe("answer subject-photo cell — Scrapbook hover-lift", () => {
  it("adds a skin-scoped hover-lift + accent ring, suppressed under reduce-motion / solemn", () => {
    expect(answerCss).toContain(':global(:root[data-skin="scrapbook"])');
    expect(answerCss).toContain("var(--shadow-lift)");
    expect(answerCss).toContain("var(--accent-soft)");
    expect(answerCss).toMatch(/translateY/);
    expect(answerCss).toContain(':global(:root[data-reduce-motion="on"])');
    expect(answerCss).toContain(':global([data-tone="solemn"])');
    expect(answerCss).toMatch(/box-shadow:\s*none/);
  });
});

describe("ask photo picker tile — Scrapbook hover-lift", () => {
  it("adds a skin-scoped hover-lift, suppressed under reduce-motion / solemn", () => {
    expect(pickerCss).toContain(':global(:root[data-skin="scrapbook"])');
    expect(pickerCss).toContain("var(--shadow-lift)");
    expect(pickerCss).toContain(':global(:root[data-reduce-motion="on"])');
    expect(pickerCss).toContain(':global([data-tone="solemn"])');
    expect(pickerCss).toMatch(/box-shadow:\s*none/);
  });
});
