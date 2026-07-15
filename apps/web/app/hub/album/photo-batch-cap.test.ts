// Guard: the "max photos per import batch" cap must have ONE source of truth.
//
// This 30 previously lived as a literal in FOUR files (two client uploaders, the server action, and
// the album board), held together by "kept in sync" comments across the client/server boundary. It is
// now PHOTO_BATCH_MAX_FILES in lib/constants.ts. These tests fail if a copy is re-introduced.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { PHOTO_BATCH_MAX_FILES } from "@/lib/constants";
import { hub } from "@/app/_copy";
// import-progress.ts is the client-safe module; MAX_IMPORT_BATCH must be the shared value, not a copy.
import { MAX_IMPORT_BATCH } from "./import-progress";

const ALBUM_DIR = dirname(fileURLToPath(import.meta.url));
const HUB_DIR = dirname(ALBUM_DIR);

describe("photo batch cap is single-sourced", () => {
  it("MAX_IMPORT_BATCH tracks PHOTO_BATCH_MAX_FILES", () => {
    expect(MAX_IMPORT_BATCH).toBe(PHOTO_BATCH_MAX_FILES);
  });

  it("no file re-hardcodes the batch cap as a numeric literal", () => {
    // The cap names must be assigned FROM PHOTO_BATCH_MAX_FILES, never a bare number.
    const files = [
      join(ALBUM_DIR, "actions.ts"),
      join(ALBUM_DIR, "import-progress.ts"),
      join(ALBUM_DIR, "AlbumUploader.tsx"),
      join(HUB_DIR, "StoryPhotosEditor.tsx"),
    ];
    const literalRe = /const\s+(MAX_BATCH_FILES|MAX_IMPORT_BATCH)\s*=\s*\d/;
    const offenders = files.filter((f) => literalRe.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the 'too many photos' copy is derived from the cap, not a hardcoded number", () => {
    // Regression for the reviewer finding: the user-facing sentence must interpolate the cap, so it can
    // never silently disagree with PHOTO_BATCH_MAX_FILES. The arg-varying assertion proves it isn't a
    // static string ignoring its parameter.
    expect(hub.actions.tooManyPhotos(PHOTO_BATCH_MAX_FILES)).toContain(String(PHOTO_BATCH_MAX_FILES));
    expect(hub.actions.tooManyPhotos(7)).toContain("7");
  });
});
