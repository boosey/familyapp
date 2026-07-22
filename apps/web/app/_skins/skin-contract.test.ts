import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SKIN_TOKENS } from "./skin-contract";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

// heirloom is the base/default skin (see the "skin model" comment in tokens.css): its palette lives
// in the `:root, [data-theme…]` blocks and its language tokens in the `:root, :root[data-skin="heirloom"]`
// block — all in tokens.css, so the whole heirloom contract is satisfied by this one file.
const heirloom = read("../_kindred/tokens.css");
const scrapbook = read("./scrapbook.css");

describe("skin token contract", () => {
  for (const skin of [["heirloom", heirloom], ["scrapbook", scrapbook]] as const) {
    const [name, css] = skin;
    it(`${name} declares every required token`, () => {
      const missing = REQUIRED_SKIN_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(css));
      expect(missing, `${name} missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
