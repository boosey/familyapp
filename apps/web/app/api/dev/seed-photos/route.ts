/**
 * PREVIEW-ONLY, auth-gated demo seed for the hub Stories masonry (visual review of the Scrapbook skin).
 *
 * POST `/api/dev/seed-photos` seeds three stories OWNED BY the authenticated caller — a 0-photo
 * text-only card, a 1-photo card, and a 2-photo collage card — so the hub feed shows every varied
 * card layout the redesign produces (see `app/hub/tabs/story-layout.ts` `pickStoryLayout`). Stories
 * are approved + shared to a family the caller belongs to, so they pass BOTH the consent gate and the
 * "owner sees their own" arm of `listStoriesForViewer`.
 *
 * DOUBLE GATE — it can never run in production and only ever affects the logged-in caller's own view:
 *   1. 404 unless `VERCEL_ENV === 'preview'`. (NOT NODE_ENV — that is 'production' on a preview build.
 *      NOT the production or development environments.)
 *   2. 401 unless there is an authenticated (account) caller; the seeded stories are owned by them.
 *
 * Every content write goes through the audited `@chronicle/core` front door (no raw table access here)
 * and the photo bytes are PUT into the active `MediaStorage` under fresh `family-photos/<uuid>` keys —
 * the same keyspace the album upload path uses — so the `/api/album-photo/[photoId]` bytes route serves
 * them and the masonry tiles render instead of 404ing.
 *
 * Dev-only: the demo copy below is inlined intentionally (this endpoint never ships to production and
 * is not user-facing product copy, so it is exempt from the `_copy/` externalization convention).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import {
  approveAndShareStory,
  attachPhotoToStory,
  createAlbumPhoto,
  createFamily,
  createTextDraft,
  listActiveFamiliesForPerson,
  transitionStoryState,
  updateDerivedFields,
} from "@chronicle/core";
// `accounts` + `families` are OPEN-schema identity tables (not behind the front-door guard), so a
// read-only count is fine. (We deliberately do NOT count the guarded `stories` table here — the
// planted `?marker=` family is the definitive isolation fingerprint, and a raw-SQL bypass whose
// result shape differs between PGlite and the Neon driver is not worth the fragility.)
import { accounts, families } from "@chronicle/db/schema";
import { ALBUM_PHOTO_KEY_PREFIX } from "@chronicle/storage";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A distinct solid color per demo photo so the seeded tiles are visually distinguishable. */
const DEMO_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [214, 90, 60], // coral
  [90, 140, 210], // sky
  [120, 190, 120], // sage
];

interface DemoStorySpec {
  title: string;
  prose: string;
  photoCount: number;
}

/**
 * The three demo stories, one per masonry layout family (see `pickStoryLayout`):
 *   - 0 photos  → "textonly"
 *   - 1 photo   → one of [top, left, wrap]
 *   - 2+ photos → one of [collage, top]
 * Titles are prefixed so a reviewer (and an optional future cleanup) can recognize seeded rows.
 */
const DEMO_STORIES: readonly DemoStorySpec[] = [
  {
    title: "A quiet afternoon",
    prose:
      "The house was empty and the light came in low through the west windows. I sat with a cup " +
      "of tea gone cold and watched the dust turn in the air, in no hurry to be anywhere at all.",
    photoCount: 0,
  },
  {
    title: "The old house",
    prose:
      "It had a crooked porch and a screen door that never quite latched. Every summer the paint " +
      "peeled a little more, and every summer we loved it a little more for it.",
    photoCount: 1,
  },
  {
    title: "Summer by the lake",
    prose:
      "We packed the car before dawn and drove until the road turned to gravel. The water was cold " +
      "enough to steal your breath, and we swam until our fingers pruned and the sun dropped behind the pines.",
    photoCount: 2,
  },
];

/**
 * Encode a tiny solid-color JPEG (a single 8×8 baseline block filled with `[r,g,b]`). Hand-built so
 * the seed needs no image library and produces a genuinely valid, browser-renderable JPEG — the bytes
 * begin with the SOI/JFIF magic the album bytes route sniffs (`0xFF 0xD8 0xFF`). Small on purpose; this
 * is a visual placeholder, not a real photo.
 */
function solidJpeg([r, g, b]: readonly [number, number, number]): Uint8Array {
  // Standard JPEG luminance + chrominance quantization tables (quality ~50), zig-zag order.
  const qtLuma = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
  ];
  const qtChroma = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  ];
  // Standard baseline Huffman tables (Annex K of the JPEG spec) — DC/AC × luma/chroma.
  const htDcLumaCounts = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const htDcLumaVals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const htDcChromaCounts = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
  const htDcChromaVals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const htAcLumaCounts = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const htAcLumaVals = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ];
  const htAcChromaCounts = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
  const htAcChromaVals = [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ];

  // --- Bit writer for the entropy-coded scan ---------------------------------------------------
  const scan: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const writeBits = (code: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) {
      bitBuffer = (bitBuffer << 1) | ((code >> i) & 1);
      bitCount++;
      if (bitCount === 8) {
        scan.push(bitBuffer & 0xff);
        if ((bitBuffer & 0xff) === 0xff) scan.push(0x00); // byte-stuffing
        bitBuffer = 0;
        bitCount = 0;
      }
    }
  };

  // Build canonical Huffman code tables (JPEG BITS/HUFFVAL → code map) for DC/AC luma/chroma.
  const buildCodes = (
    counts: number[],
    vals: number[],
  ): Map<number, { code: number; length: number }> => {
    const map = new Map<number, { code: number; length: number }>();
    let code = 0;
    let k = 0;
    for (let len = 1; len <= 16; len++) {
      for (let i = 0; i < counts[len - 1]!; i++) {
        map.set(vals[k]!, { code, length: len });
        code++;
        k++;
      }
      code <<= 1;
    }
    return map;
  };
  const dcLuma = buildCodes(htDcLumaCounts, htDcLumaVals);
  const acLuma = buildCodes(htAcLumaCounts, htAcLumaVals);
  const dcChroma = buildCodes(htDcChromaCounts, htDcChromaVals);
  const acChroma = buildCodes(htAcChromaCounts, htAcChromaVals);

  // Category (number of bits) needed to represent a signed DC/AC coefficient magnitude.
  const category = (value: number): number => {
    let v = Math.abs(value);
    let c = 0;
    while (v > 0) {
      v >>= 1;
      c++;
    }
    return c;
  };
  // JPEG signed-value bit representation: positive as-is, negative as (value - 1) in `size` bits.
  const valueBits = (value: number, size: number): number =>
    value >= 0 ? value : (value - 1) & ((1 << size) - 1);

  // A single 8×8 block: only the DC coefficient is non-zero (a flat block → all-AC-zero → EOB).
  const encodeFlatBlock = (
    dcCoeff: number,
    dcTable: Map<number, { code: number; length: number }>,
    acTable: Map<number, { code: number; length: number }>,
  ): void => {
    const size = category(dcCoeff);
    const dc = dcTable.get(size)!;
    writeBits(dc.code, dc.length);
    if (size > 0) writeBits(valueBits(dcCoeff, size), size);
    const eob = acTable.get(0x00)!; // (run=0, size=0) = End Of Block
    writeBits(eob.code, eob.length);
  };

  // RGB → YCbCr (level-shifted). For a FLAT 8×8 block the forward DCT gives F(0,0) = 8·(sample-128)
  // (all 64 samples equal → DC = 8× the level-shifted value); the quantized DC is round(8·(s-128)/Q00).
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const dcY = Math.round((8 * (y - 128)) / qtLuma[0]!);
  const dcCb = Math.round((8 * (cb - 128)) / qtChroma[0]!);
  const dcCr = Math.round((8 * (cr - 128)) / qtChroma[0]!);
  // One MCU, 4:4:4 (no subsampling): Y, Cb, Cr each one flat 8×8 block.
  encodeFlatBlock(dcY, dcLuma, acLuma);
  encodeFlatBlock(dcCb, dcChroma, acChroma);
  encodeFlatBlock(dcCr, dcChroma, acChroma);
  // Flush the final partial byte with 1-bits (JPEG pad convention).
  if (bitCount > 0) writeBits(0xff, 8 - bitCount);

  // --- Assemble the JPEG segments --------------------------------------------------------------
  const bytes: number[] = [];
  const u16 = (n: number): void => {
    bytes.push((n >> 8) & 0xff, n & 0xff);
  };

  bytes.push(0xff, 0xd8); // SOI
  // APP0 / JFIF
  bytes.push(0xff, 0xe0);
  u16(16);
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  // DQT (luma, id 0)
  bytes.push(0xff, 0xdb);
  u16(67);
  bytes.push(0x00, ...qtLuma);
  // DQT (chroma, id 1)
  bytes.push(0xff, 0xdb);
  u16(67);
  bytes.push(0x01, ...qtChroma);
  // SOF0 (baseline), 8×8, 3 components 4:4:4
  bytes.push(0xff, 0xc0);
  u16(17);
  bytes.push(0x08, 0x00, 0x08, 0x00, 0x08, 0x03);
  bytes.push(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  // DHT — four tables
  const dht = (cls: number, id: number, counts: number[], vals: number[]): void => {
    bytes.push(0xff, 0xc4);
    u16(2 + 1 + 16 + vals.length);
    bytes.push((cls << 4) | id, ...counts, ...vals);
  };
  dht(0, 0, htDcLumaCounts, htDcLumaVals);
  dht(1, 0, htAcLumaCounts, htAcLumaVals);
  dht(0, 1, htDcChromaCounts, htDcChromaVals);
  dht(1, 1, htAcChromaCounts, htAcChromaVals);
  // SOS
  bytes.push(0xff, 0xda);
  u16(12);
  bytes.push(0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00);
  bytes.push(...scan);
  bytes.push(0xff, 0xd9); // EOI

  return Uint8Array.from(bytes);
}

interface SeedResponse {
  ok: true;
  createdStoryIds: string[];
  familyId: string;
  photoCount: number;
}

/**
 * READ-ONLY preview diagnostic: confirm WHICH database a preview deployment is wired to BEFORE anyone
 * runs the POST seed. Preview-gated (404 otherwise) but intentionally UNAUTHENTICATED — it returns no
 * sensitive data, only total row counts and a marker-presence boolean, so it is safe to hit with a
 * plain fetch. Writes nothing.
 *
 * `?marker=<name>` → `markerPresent` is whether a family with that exact name exists (a cheap way to
 * fingerprint an isolated dev branch vs production). Absent marker → `markerPresent: false`.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const { db } = await getRuntime();

  const marker = new URL(request.url).searchParams.get("marker");

  // accounts: open-schema row count (robust across PGlite + the Neon driver via the query builder).
  const [accountRow] = await db.select({ n: count() }).from(accounts);

  let markerPresent = false;
  if (marker) {
    const [markerRow] = await db
      .select({ n: count() })
      .from(families)
      .where(eq(families.name, marker));
    markerPresent = (markerRow?.n ?? 0) > 0;
  }

  return NextResponse.json({
    ok: true,
    vercelEnv: process.env.VERCEL_ENV,
    accounts: accountRow?.n ?? 0,
    markerPresent,
  });
}

export async function POST(): Promise<Response> {
  // Gate 1 (fail-closed): preview only. NODE_ENV is 'production' on a preview build, so it cannot be
  // used here; VERCEL_ENV distinguishes preview from production. Absent (local/dev) or anything else → 404.
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse(null, { status: 404 });
  }

  const { db, storage, auth } = await getRuntime();

  // Gate 2: an authenticated account caller. The seeded stories are OWNED BY this person, so they are
  // visible to the caller via the owner arm of listStoriesForViewer regardless of the consent gate.
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const personId = ctx.personId;

  // Ensure the caller has a family + ACTIVE membership to share the demo stories into. Reuse an
  // existing one if present; otherwise mint a demo family owned by the caller (createFamily gives the
  // creator an active steward membership atomically).
  const active = await listActiveFamiliesForPerson(db, personId);
  const familyId =
    active[0]?.familyId ??
    (await createFamily(db, { name: "Preview Demo", creatorPersonId: personId })).familyId;

  const createdStoryIds: string[] = [];
  let photoCount = 0;

  for (const spec of DEMO_STORIES) {
    // 1. Create a text-origin draft owned by the caller. `text` seeds the empty-check; the canonical
    //    prose is set below via updateDerivedFields (mirrors dev-seed's derive step).
    const { story } = await createTextDraft(db, {
      ownerPersonId: personId,
      text: spec.prose,
    });
    await updateDerivedFields(db, story.id, { title: spec.title, prose: spec.prose });

    // 2. Attach the demo photos BEFORE approval — album photo (bytes → storage, then row via the
    //    audited createAlbumPhoto) then attach to the story (audited attachPhotoToStory). The caller
    //    is both the contributor and the attacher, and is an active member of the target family.
    for (let i = 0; i < spec.photoCount; i++) {
      const color = DEMO_COLORS[i % DEMO_COLORS.length]!;
      const bytes = solidJpeg(color);
      const key = `${ALBUM_PHOTO_KEY_PREFIX}${randomUUID()}`;
      await storage.put({ key, bytes, contentType: "image/jpeg" });
      const photo = await createAlbumPhoto(db, {
        contributorPersonId: personId,
        familyIds: [familyId],
        source: "upload",
        storageKey: key,
      });
      await attachPhotoToStory(db, {
        storyId: story.id,
        familyPhotoId: photo.id,
        attachedByPersonId: personId,
      });
      photoCount++;
    }

    // 3. Approve + share to the family (tap approval, no approval audio — ADR-0004). Explicit
    //    familyIds targets the demo family so co-members would see it too; the caller (owner) always does.
    await transitionStoryState(db, story.id, "pending_approval");
    await approveAndShareStory(db, {
      storyId: story.id,
      narratorPersonId: personId,
      audienceTier: "family",
      familyIds: [familyId],
    });

    createdStoryIds.push(story.id);
  }

  const body: SeedResponse = { ok: true, createdStoryIds, familyId, photoCount };
  return NextResponse.json(body, { status: 200 });
}
