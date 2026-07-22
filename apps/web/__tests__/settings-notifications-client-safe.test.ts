import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_DIR = join(process.cwd(), "app/hub/settings");

/** Client modules under settings that must not value-import @chronicle/core. */
const CLIENT_MODULES = ["NotificationsSection.tsx", "SettingsPanel.tsx"] as const;

describe("hub settings notifications client boundary", () => {
  it("client modules do not value-import @chronicle/core (node:crypto via token-seal)", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_MODULES) {
      const source = readFileSync(join(SETTINGS_DIR, file), "utf8");
      // Allow `import type { ... } from "@chronicle/core"` — types are erased.
      // Ban value imports: `import { X } from "@chronicle/core"` or `import * as core from "@chronicle/core"`.
      const withoutTypeImports = source.replace(
        /^\s*import\s+type\s+[\s\S]*?from\s+["']@chronicle\/core["']\s*;?\s*$/gm,
        "",
      );
      if (/from\s+["']@chronicle\/core["']/.test(withoutTypeImports)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `These client modules value-import @chronicle/core and will break next build ` +
        `(node:crypto via token-seal): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
