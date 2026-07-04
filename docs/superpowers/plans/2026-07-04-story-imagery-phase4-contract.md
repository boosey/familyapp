# ADR-0009 Phase 4 — Photo suggestion + the nudge (cheap engine, editor-time) — SHARED CONTRACT

Worktree: `C:\Users\boose\projects\familyapp\.claude\worktrees\story-imagery-phase2plus`
(Phase 3 committed at `c37de39`; build on it.) Spec: `docs/adr/0009-...md` "Suggestion is ranking
layered over browse — never a gate" (lines 74-82); `docs/PLAN.md` Phase 4 (~line 280). Slice value:
**the right photo floats up in the draft-editor picker without the narrator browsing, plus a gentle
"add this photo?" nudge — driven by a cheap, deterministic caption ∪ EXIF-date ranker.**

Two sequential slices, each coding-agent + fresh cold reviewer:
- **Slice A (pipeline):** the PURE ranker (`photo-ranker.ts`) + the reserved `PhotoUnderstanding`
  vendor-seam interface & mock + pure unit tests. This is the shared contract Slice B consumes.
- **Slice B (web):** wire the ranker into `loadStoryPhotoEditorAction` (rank the candidate album +
  compute a nudge, server-side), render the nudge in `StoryPhotosEditor.tsx`, copy, web tests.

## Grounding facts (from the code map — do not re-litigate)
- `stories.eraYear` = `integer`, **nullable**, a 4-digit year (`schema.ts:419`). It is a
  supplied/deferred field — **nothing auto-derives it today**, so it is **frequently NULL** at editor
  time. The EXIF-proximity arm MUST degrade to "no date signal" when it is null.
- `family_photos.exif_captured_at` = `timestamp` → `Date | null` (`schema.ts:890`), **commonly NULL**
  (EXIF is often stripped/absent). The proximity arm needs BOTH `eraYear` and `exifCapturedAt` present.
- The editor's server action already has the full `Story` row and the album candidates server-side
  (`loadStoryPhotoEditorAction` → `requireDraftOwner` → `getStoryForViewer`;
  `photo-actions.ts:69,104-114`). Text corpus available: `title, prose, transcript, summary, tags[],
  promptQuestion, eraLabel`. Candidate rows (`AlbumPhotoView`) carry `caption` AND `exifCapturedAt`
  (`album-repository.ts:169-177`). **Ranking runs SERVER-SIDE in the action; silent to the client.**
- Reuse the pure `tokenize`/`overlap`/weighted-sum idiom from `packages/core/src/family-search.ts:44-60`
  (module-private there — mirror the shape; do NOT export core internals cross-package).
- Vendor-seam architecture test (`packages/pipeline/test/pipeline.test.ts:575-642`) forbids vendor SDK
  import strings in `pipeline/src`. A pure ranker + an interface + a deterministic mock trip NOTHING.

## Design decisions (LOCKED)
1. **Deterministic, pure, no DB, no AI.** The ranker is a pure function over already-loaded inputs.
   No PGlite in its tests. The `PhotoUnderstanding` seam is reserved (interface + mock) but **NOT wired
   into the v1 ranker** — YAGNI on the wiring; it exists so the future vision ranker has a home.
2. **Two arms, caption-primary, union by weighted sum:**
   - *Caption arm:* `overlap(storyTokens, captionTokens)` = count of shared meaningful tokens.
   - *Year arm:* only when BOTH `eraYear != null` AND `exifCapturedAt != null`:
     `yearProximity = max(0, 1 - |exifYear - eraYear| / PHOTO_RANK_YEAR_WINDOW)` (linear decay; same
     year → 1.0, ≥ window years off → 0). `exifYear = exifCapturedAt.getUTCFullYear()` (EXIF is parsed
     tz-naive as UTC — use UTC to match). When either is null, `yearProximity = null` (arm contributes 0).
   - *Score:* `PHOTO_RANK_CAPTION_WEIGHT * captionOverlap + PHOTO_RANK_YEAR_WEIGHT * (yearProximity ?? 0)`.
     Weights LOCKED so **one caption token beats a perfect year match** (caption is the ADR's "primary
     human signal"): `CAPTION_WEIGHT = 1.0` (per token), `YEAR_WEIGHT = 0.5` (max), `YEAR_WINDOW = 10`.
3. **Graceful degradation is the common case, not an edge case.** If every candidate scores 0 (no
   caption match, no usable date — the majority reality given the NULL facts above), return candidates
   in their INPUT order (which is recency from `listAlbumPhotos`) with `score: 0`. The picker then looks
   exactly like today. Ranking is **purely additive** — it can never hide or drop a photo.
4. **Stable, deterministic ordering.** Sort by `score` desc; ties broken by preserving input index
   (candidates arrive recency-ordered). Implement the tie-break explicitly (do not rely on `Array.sort`
   stability). No timestamps/randomness in the ranker.
5. **The nudge is CAPTION-driven only.** The copy is "you mentioned … — add a photo?", which is only
   honest when there is a TEXT match. So the nudge fires on the caption arm, NOT on date proximity:
   `pickPhotoNudge(ranked)` returns the top candidate **iff its `captionOverlap >= PHOTO_NUDGE_MIN_OVERLAP`**
   (LOCKED = 1, i.e. at least one meaningful shared token), else `null`. Date proximity influences the
   silent picker order but never triggers a nudge. *(Debatable — flag for review: should a strong pure
   date match also nudge with different copy? v1 says no, to keep the copy truthful.)*
6. **Meaningful tokens.** The ranker's `tokenize` lowercases, splits on non-alphanumeric, drops tokens
   of length < 3, and drops a small English STOPWORD set (the, and, was, with, that, this, для… keep it
   ~30 common words). This prevents nudging on "the/and". Applies to BOTH story text and captions.
7. **Candidates are the UNATTACHED album set** (the action already excludes attached photos —
   `photo-actions.ts:104-114`). So `pickPhotoNudge` needs no attached-filter; ranked[0] is already a
   not-yet-attached photo. The nudge suggests attaching it.

---

## SLICE A — pipeline (the pure ranker + reserved seam)

### 1. New module `packages/pipeline/src/photo-ranker.ts` (PURE — no imports of db/core/vendor)
Locked exported types + functions:
```ts
export interface PhotoCandidate {
  id: string;
  caption: string | null;
  exifCapturedAt: Date | null;
}
export interface StorySignals {
  /** The tokenizable corpus: title + prose/transcript + summary + tags + promptQuestion + eraLabel,
   *  each null-guarded, space-joined. Built by the caller (Slice B). */
  text: string;
  /** stories.eraYear — nullable; when null the year arm is inert. */
  eraYear: number | null;
}
export interface RankedPhoto {
  id: string;
  caption: string | null;
  score: number;              // 0 when no signal
  captionOverlap: number;     // shared meaningful-token count
  yearProximity: number | null; // 0..1, or null when no usable date signal
}

/** Rank candidates for a story; additive, deterministic, stable. Never drops a candidate. */
export function rankPhotosForStory(signals: StorySignals, candidates: PhotoCandidate[]): RankedPhoto[];

/** The system-initiated "add this photo?" nudge: the top ranked candidate IFF it has a real caption
 *  match (captionOverlap >= PHOTO_NUDGE_MIN_OVERLAP), else null. Caption-driven only (see decision 5). */
export function pickPhotoNudge(ranked: RankedPhoto[]): { photoId: string; caption: string | null } | null;
```
- Constants (top of the file, named `export const`): `PHOTO_RANK_CAPTION_WEIGHT = 1.0`,
  `PHOTO_RANK_YEAR_WEIGHT = 0.5`, `PHOTO_RANK_YEAR_WINDOW = 10`, `PHOTO_NUDGE_MIN_OVERLAP = 1`.
- Private `tokenize(text: string | null): Set<string>` + `STOPWORDS: ReadonlySet<string>` per decision 6.
- Barrel: re-export the two functions + the three interfaces + the four constants from
  `packages/pipeline/src/index.ts` (types in the `export type { … }` block, values in the value block).

### 2. Reserved vendor seam — `packages/pipeline/src/contracts.ts` + `mocks.ts`
- `contracts.ts`: add a minimal `PhotoUnderstanding` interface (mirrors `Transcriber` shape) reserved
  for a future vision ranker — e.g.:
```ts
export interface PhotoUnderstandingInput { photoId: string; bytes: Uint8Array; contentType: string; }
export interface PhotoUnderstandingResult { labels: string[]; modelId: string; /* embedding?: number[] */ }
export interface PhotoUnderstanding {
  /** Vision → labels/caption/embedding for a photo. RESERVED (ADR-0009): not wired into the v1
   *  deterministic ranker; a later subscription-gated ranker will consume it. */
  describe(input: PhotoUnderstandingInput): Promise<PhotoUnderstandingResult>;
}
```
- `mocks.ts`: add `ScriptedPhotoUnderstanding implements PhotoUnderstanding` (deterministic, dependency-
  free, records `calls[]`, returns a scripted `{labels, modelId}`), mirroring `ScriptedTranscriber`
  (`mocks.ts:36-52`).
- `index.ts`: re-export the type(s) + the mock class in the existing blocks.
- Confirm `packages/pipeline/test/pipeline.test.ts` "no vendor SDK imports" stays green.

### 3. Pure unit tests — `packages/pipeline/test/photo-ranker.test.ts` (Vitest, NO PGlite)
Assert (call the functions directly with hand-built inputs — no db):
- Caption-overlap ordering: a candidate whose caption shares story tokens outranks one that doesn't.
- Stopwords/short tokens don't count (a caption of only "the a of" against story text → overlap 0).
- Year-proximity ordering: with `eraYear` set and two dated photos, the nearer year outranks the
  farther; beyond `YEAR_WINDOW` → year arm 0.
- Caption beats year: one caption-token match outranks a perfect year match (weights).
- **Degradation:** `eraYear = null` → year arm inert; all captions null / no matches → all score 0 and
  ORIGINAL input order preserved (recency); `exifCapturedAt = null` on some → those get `yearProximity:
  null` and don't crash.
- Stable tie-break: equal-score candidates keep input order (assert with ≥3 equal-score items).
- `pickPhotoNudge`: returns the top caption-matching candidate; returns `null` when the best overlap is
  0 (no text match) even if a strong date match exists; returns `null` for an empty list.
- Determinism: same inputs → identical output across repeated calls.

**Locked signatures for Slice B** (build against these — do not deviate): the three interfaces + the two
functions + four constants above, all imported from `@chronicle/pipeline`.

Verify: `pnpm --filter @chronicle/pipeline test`, `pnpm -r typecheck`, `oxlint` on changed files.

---

## SLICE B — web (wire the ranker + render the nudge)  *(build after Slice A is green + reviewed)*

1. **Widen the draft-owner gate to carry the story.** `requireDraftOwner`
   (`apps/web/app/hub/answer/[askId]/photo-actions.ts`, currently returns `{db, ctx, personId}` and
   discards the `getStoryForViewer` result at ~`:69-73`) → also return the loaded `story` so the ranker
   has `eraYear` + text without a second read. Keep every existing caller working (additive field).
2. **Rank + nudge inside `loadStoryPhotoEditorAction`** (`photo-actions.ts:81-...`):
   - Build `StorySignals`: `text` = `[story.title, story.prose, story.transcript, story.summary,
     (story.tags ?? []).join(' '), story.promptQuestion, story.eraLabel].filter(Boolean).join(' ')`;
     `eraYear = story.eraYear`.
   - Build `PhotoCandidate[]` from the SAME unattached album pool it already assembles (`:104-114`) —
     but source `caption` + `exifCapturedAt` from `AlbumPhotoView` (add `exifCapturedAt` to the local
     candidate objects; it is NOT exposed to the client).
   - `const ranked = rankPhotosForStory(signals, candidates)` → emit `album` as the ranked
     `EditorAlbumPhoto[]` (`{photoId, caption}` in ranked order — **no client shape change to
     `EditorAlbumPhoto`**; silent ranking).
   - `const nudge = pickPhotoNudge(ranked)` → add to the response.
   - **`StoryPhotoEditorData` ok-variant gains** `nudge: { photoId: string; caption: string | null } | null`.
     (Additive; existing consumers ignore it.)
3. **Render the nudge** in `StoryPhotosEditor.tsx` (a new element ABOVE the picker grid, ~`:177`):
   a gentle banner using `hub.compose.photoNudge(caption)` copy + a KindredButton that attaches that
   photo (reuse the existing attach server action the editor already calls — do NOT add a new mutation).
   Client-dismissible (local `useState`), never blocking. Real design tokens only (see the album-fixes
   convention; `var(--text-danger, #b00)` is the one established exception).
4. **Copy** — add to `apps/web/app/_copy/hub.ts` under `compose`: `photoNudge: (caption: string | null)
   => caption ? \`You mentioned "${caption}" — add this photo?\` : "Add a related photo?"` (or similar
   warm wording; it is copy, keep it honest — it only shows on a real caption match). Add the
   dismiss/aria strings the component needs.
5. **Web tests** (mirror `apps/web/__tests__/album.server.test.ts` / the Phase-3 server-test harness,
   PGlite-backed): a draft whose text matches a photo's caption → that photo is ranked FIRST in `album`
   AND `nudge` points at it; a draft with NO matching caption and no era/exif → `album` stays in recency
   order and `nudge` is `null`; the nudge photo is one the owner can actually see (gate unaffected).
   Keep every existing web test green. **No new mutation/authz surface** — ranking is a read-time
   re-order of an already-authorized list, so the front-door/IDOR posture is unchanged (call this out
   for the reviewer).

## Non-negotiables (same as prior phases)
- Single front door: web reads go through `@chronicle/core`/`@chronicle/pipeline`; no
  `@chronicle/db/content` / `.query.stories`. Ranking touches NO new table and adds NO read path — it
  re-orders the existing authorized candidate list. `packages/core/test/architecture.test.ts` stays green.
- Vendor-seam rule: `PhotoUnderstanding` is interface+mock only; no vision SDK anywhere in `*/src`.
- TS strict / `noUncheckedIndexedAccess` / `verbatimModuleSyntax` / ESM. Domain types stay where they
  are; the ranker's types live in `@chronicle/pipeline`. Regression test after any bug fix. boosey
  commit identity; main agent commits.
- Verify: `pnpm --filter @chronicle/pipeline test` · `pnpm --filter @chronicle/web test` ·
  `pnpm -r typecheck` · `oxlint <changed files>`.

## Explicitly OUT of scope (parked)
Vision/embedding ranking (the reserved seam's future job) · deriving `eraYear` from prose (a separate
deferred extraction) · a spoken interviewer photo turn (the voice loop stays photo-free) · ranking in
any surface other than the draft-editor picker.
