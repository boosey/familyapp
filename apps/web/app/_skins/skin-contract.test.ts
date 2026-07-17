import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_SKIN_TOKENS } from "./skin-contract";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

// heirloom's tokens are the base :root + font block in tokens.css.
const heirloom = read("../_kindred/tokens.css");
const playful = read("./playful.css");

describe("skin token contract", () => {
  for (const skin of [["heirloom", heirloom], ["playful", playful]] as const) {
    const [name, css] = skin;
    it(`${name} declares every required token`, () => {
      const missing = REQUIRED_SKIN_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(css));
      expect(missing, `${name} missing: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
