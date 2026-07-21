# ADR-0009 Phase 3 — Story-from-a-photo + Ask-targets-photo (subject) — SHARED CONTRACT

Worktree: `C:\Users\boose\projects\familyapp\.claude\worktrees\story-imagery-phase2plus`
(Phase 2 is committed at HEAD; build on it.) Spec: `docs/adr/0009-...md` "Subject" (lines 67-72) +
authz (95-98); `docs/PLAN.md` Phase 3 (~line 273). Slice value: **photos become story seeds — from self
("tell the story of this photo") and from relatives (an Ask that targets photo[s], answered → a Story
from that photo).**

Two sequential slices, each coding-agent + fresh cold reviewer:
- **Slice A (DB + core):** schema + creation threading + Ask targeting + the consolidated gate + tests.
- **Slice B (web):** "tell the story of this photo" entry, Ask-attach-photo UI, answer→story carry-forward,
  caption→promptQuestion opener, web tests.

## Design decisions (LOCKED)
1. **`stories.subject_photo_id`** = nullable FK → `family_photos.id`, ≤1, NO cascade (a story stays
   semantically "about" a soft-deleted photo; bytes 404 via the existing soft-delete filter). It is the
   thin "what this is about" pointer; it rides on `getStoryForViewer`'s row so the link is visible only
   when the story is (no new read arm needed).
2. **Atomicity:** setting a subject photo at story creation ALSO inserts that photo as the story's FIRST
   `story_images` row (cover, position 0) **in the same transaction** as the story insert. Reuse the
   Phase-2 attach logic via a new tx-aware helper (below) — do NOT create a second, non-atomic path.
3. **Consolidated album-access gate:** extract the "may this person see this album photo?" check
   (currently inline in `attachPhotoToStory`, story-image-repository.ts ~82-107: contributor OR active
   member of a placed-in family) into an EXPORTED helper in the already-allowlisted
   `album-repository.ts`. Reuse it in `attachPhotoToStory`, the subject-cover insert, and `createAsk`.
   This keeps `asks.ts` from importing guarded tables.
4. **`ask_subject_photos`** = OPEN schema (like `story_families`), NOT behind `@chronicle/db/content`.
   Its bytes rely on album-membership visibility (Arm 1 of `decideAlbumPhotoRead`) — an Ask is created
   within a shared active family and the photo must be one the asker can see, so a target co-member can
   see it. **No dedicated read-seam arm for ask photos this slice** (document it in the ADR-comment).
5. **Interviewer opener:** realize "seeded from the caption" as the story's `promptQuestion`
   (e.g. "Tell the story of this photo — {caption}") set at the WEB layer. **No changes to
   `packages/interviewer`.** A dedicated interviewer photo-intent is explicitly DEFERRED.

---

## SLICE A — DB + core

### 1. Schema — `packages/db/src/schema.ts`
- Add to the `stories` table (near `askId`/`originatingFamilyId`, ~427-435):
  `subjectPhotoId: uuid("subject_photo_id").references(() => familyPhotos.id),  // ADR-0009 Phase 3, ≤1, nullable`
  (forward-reference to familyPhotos is fine — it's defined later in the same file; use the
  `(): AnyPgColumn => familyPhotos.id` arrow form if TS complains about ordering, mirroring how other
  forward FKs are done, e.g. proseRevisions.storyRecordingId at ~516).
- New OPEN join table (place near `story_families`, ~482, NOT in content.ts):
```ts
export const askSubjectPhotos = pgTable(
  "ask_subject_photos",
  {
    askId: uuid("ask_id").notNull().references(() => asks.id, { onDelete: "cascade" }),
    photoId: uuid("photo_id").notNull().references(() => familyPhotos.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.askId, t.photoId] }),
    index("ask_subject_photos_photo_idx").on(t.photoId),
  ],
);
```
- Types (inferred-types block): `export type AskSubjectPhoto = typeof askSubjectPhotos.$inferSelect;`
  `export type NewAskSubjectPhoto = typeof askSubjectPhotos.$inferInsert;`
- `packages/db/src/index.ts`: re-export the two new types. **`subject_photo_id` needs NO content.ts
  change** (it's a column on the already-guarded `stories`). `ask_subject_photos` is OPEN → export it
  from the normal schema barrel (it already re-exports schema tables), NOT content.ts.
- Run `pnpm --filter @chronicle/db db:generate`; the regenerated `schema.sql` must include the new
  column + table. No invariants.sql change needed (no partial-unique here).

### 2. Consolidated gate — `packages/core/src/album-repository.ts`
- Add + export `assertPersonCanAccessAlbumPhoto(db, personId, photoId): Promise<void>` (throws the
  project's InvariantViolation if the person is neither the photo's contributor nor an active member of a
  family the non-deleted photo is placed in). Factor it out of `attachPhotoToStory`'s current inline
  check so there is ONE implementation. Also fine to expose a boolean twin if a UI needs it.
- Export from `packages/core/src/index.ts`.

### 3. Story creation threading — `packages/core/src/story-repository.ts`
- Add `subjectPhotoId?: string` to `TextDraftInput` (~79-89) and `DraftStoryInput` (~61-72).
- In `createTextDraft` (~102-137) and `persistRecordingAndCreateDraft` (~144-187): set
  `subjectPhotoId: input.subjectPhotoId ?? null` in the `stories` insert; and WHEN it is set, within the
  SAME transaction, call `assertPersonCanAccessAlbumPhoto(tx, ownerPersonId, subjectPhotoId)` then insert
  the first `story_images` cover row via a new tx-aware helper (below). Owner is the attacher.
- `discardDraftStory`: no new work for `subject_photo_id` (it's a column; the story_images cover row is
  already deleted by the Phase-2 child-delete). Confirm no FK-ordering issue.

### 4. tx-aware attach — `packages/core/src/story-image-repository.ts`
- Refactor `attachPhotoToStory` to delegate to a new internal `attachPhotoToStoryTx(tx, input)` (the
  current body operating on a passed tx handle); `attachPhotoToStory` wraps it in `db.transaction`.
  Export `attachPhotoToStoryTx` for `story-repository.ts` to call inside the creation tx. Keep the gate
  via the consolidated helper (§2). Signatures otherwise unchanged.

### 5. Ask targeting — `packages/core/src/asks.ts`
- `CreateAskInput` (~22-28): add `subjectPhotoIds?: string[]`.
- `createAsk` (~53-105): in the existing tx, after the co-membership gate, for each subjectPhotoId call
  `assertPersonCanAccessAlbumPhoto(tx, ctx-asker, photoId)`, then insert `ask_subject_photos` rows
  (dedupe). `asks.ts` imports `askSubjectPhotos` from the OPEN schema (NOT /content) and the gate helper
  from `@chronicle/core` album-repository — so **asks.ts does NOT need an allowlist entry**.
- Add a read `listAskSubjectPhotos(db, askId): Promise<string[]>` (the photo ids, ordered by addedAt).
  Export it. Used by the answer flow to carry photos forward.

### 6. Architecture test — `packages/core/test/architecture.test.ts`
- Likely NO allowlist change (subject write stays in the already-allowlisted `story-repository.ts`; the
  gate is in the already-allowlisted `album-repository.ts`; `ask_subject_photos` is OPEN). VERIFY the
  suite stays green; only touch it if the guard legitimately requires it (and if so, update BOTH the Set
  and the canary literal). Do NOT add `ask_subject_photos` to the `db.query.*` FORBIDDEN regex (it is
  open, not guarded content).

### 7. Core tests (PGlite; mirror album/story-image tests)
- `stories.subject_photo_id` set at creation → the story row carries it AND a first `story_images` cover
  row exists (position 0, isCover) for that photo; `listStoryImages` renders it as cover.
- The album-access gate blocks creating a story-from-a-photo the owner can't see (rejected, no story
  written) — and allows it for a photo the owner can see.
- `createAsk` with `subjectPhotoIds`: writes `ask_subject_photos`; rejects a photo the asker can't see;
  `listAskSubjectPhotos` returns them. Co-membership gate still enforced.
- Keep `asks.test.ts`, `story-repository.test.ts`, `story-image-repository.test.ts`,
  `album-repository.test.ts`, `architecture.test.ts` green.

**Locked signatures for Slice B:**
```ts
// story creation now accepts subjectPhotoId (atomic cover insert):
createTextDraft(db, { ownerPersonId, text, promptQuestion?, askId?, originatingFamilyId?, subjectPhotoId? })
persistRecordingAndCreateDraft(db, recording, { promptQuestion?, askId?, originatingFamilyId?, subjectPhotoId? })
createAsk(db, ctx, { targetPersonId, familyId?, questionText, subjectPhotoIds? })
listAskSubjectPhotos(db, askId): Promise<string[]>
assertPersonCanAccessAlbumPhoto(db, personId, photoId): Promise<void>   // throws if not
```
Capture ingest inputs (`packages/capture/src/capture.ts` `IngestRecordingInput` ~47-56 /
`IngestTextStoryInput` ~115-123) must also thread `subjectPhotoId?` through to core (parallel to `askId`).

---

## SLICE B — web (build after Slice A is green + reviewed)

1. **"Tell the story of this photo"** — a button in `apps/web/app/hub/album/AlbumPhotoViewer.tsx`
   (per-photo modal) that starts a story about the photo: navigate to the tell surface
   (`apps/web/app/hub/tell/page.tsx` → `StoryComposer mode="tell"`) carrying the `subjectPhotoId` (query
   param) and a caption-derived `promptQuestion`. `composeStoryAction`
   (`apps/web/app/hub/answer/[askId]/actions.ts` ~261-314) → `ingestTextStory`/`ingestRecording` must
   pass `subjectPhotoId` (and `promptQuestion` from the caption). The server action re-resolves auth; the
   core gate enforces the owner can see the photo.
2. **Answer→story carry-forward** — in `recordAnswerAction`/`composeStoryAction`: when the ask has
   subject photos (`listAskSubjectPhotos`), set the new story's `subjectPhotoId` = the FIRST, and attach
   any remaining ask photos as accompaniment (`attachPhotoToStory`). The answerer is the target
   (co-member) → passes the gate.
3. **Ask-attach-photo UI** — in `apps/web/app/hub/tabs/AskTab.tsx` (`submitAsk` → `createAsk`): an
   optional photo picker (reuse the album-listing pattern from
   `answer/[askId]/photo-actions.ts` `loadStoryPhotoEditorAction`) so an asker can attach one-or-more
   subject photos to the Ask; pass `subjectPhotoIds` to `createAsk`.
4. **Display** — the subject photo already renders as the story's cover (feed) + first gallery tile
   (Phase 2). On the Ask surface (where the target sees/answers the ask), show the ask's subject
   photo(s) via the byte route. Use KindredButton + real design tokens (no phantom tokens).
5. Web tests: mirror `answer-*.server.test.ts` / `story-photo-actions.server.test.ts` — subject set at
   creation; unauthorized-photo rejected; ask carry-forward; Ask-attach happy + reject paths.

## Conventions / commands (same as Phase 2 contract)
- TS strict/ESM/verbatimModuleSyntax; domain types in @chronicle/db first; single-schema reseed (no
  migrations) — `pnpm --filter @chronicle/db db:generate` after schema edits.
- Regression test after any bug fix. Do NOT commit (main agent handles git). boosey commit identity.
- `pnpm --filter @chronicle/core test` · `pnpm --filter @chronicle/db test` · `pnpm -r typecheck` ·
  `pnpm --filter @chronicle/web test` · root `pnpm exec oxlint <files>`.
