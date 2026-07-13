# Album photo enhancements — plan & contract

**Date:** 2026-07-13
**Worktree/branch:** `.claude/worktrees/album-photo-enhancements` → `worktree-album-photo-enhancements`
**Base:** branched from `feat/unified-tags-photos` HEAD (`5a9ef70`) — builds on the unified `TagInput`/`StoryEditor` work.
**Delivery:** phased on this branch, each phase green + committed; one HITL review at the end. No push/merge without human sign-off.

## Source request (9 items)

1. Move "Manage connections" menu to the right, same line as the other album buttons.
2. Thumbnail hover mini-toolbar: edit, create question, create story, tag people, tag faces, delete (with confirm). Tag-people functional (Phase B); tag-faces = visible no-op.
3. Same actions in the photo viewer. Replace "Add caption" button with a caption entry field (placeholder "Caption"); action buttons on one line below it.
4. Tag management in view + edit: **Subjects, People, Family, Places** — like a story (Places is net-new; add it).
5. Family selector on a photo, like stories (editable placement).
6. Multi-select bulk ops: ask one question about selected, tell one story about selected, delete selected.
7. View selector: **Grid**, **Masonry** (the "catalog with offset pictures of different sizes"), **List** (photo, caption, uploader, families, tags columns).
8. Thumbnail size slider that works in all views.
9. Search + filter: by people, places, time period (EXIF capture date).

## Decisions (from the user, 2026-07-13)

- **Places = structured entity**, family-scoped, deduped by name. Carries optional GPS. `exifGps` (already stored) is a *seed*, not the filter key. Add a `PlaceSuggester` vendor seam (GPS → local place / landmark) with a **mock only** now; real reverse-geocode + AI later.
- **Face tagging**: people tagging fully functional now; face-region (box + hover label) deferred (needs ML). "Tag faces" button is a visible no-op.
- **Subjects and People are SEPARATE** on photos → two person-link tables. (Diverges from stories, where they're one.)
- Phased delivery, all on this branch.

## Data model contract (Phase B) — packages/db/src/schema.ts

All new tag tables mirror `storySubjects` (content-guarded; accessed only via `packages/core` album-repository, added to the architecture allowlist). Person-link tables cascade on photo hard-delete and are hidden when the photo is soft-deleted (`deletedAt`).

```
photo_subjects        (id, photo_id FK→family_photos ON DELETE CASCADE, person_id FK→persons,
                       tagged_by_person_id FK→persons, created_at)   UNIQUE(photo_id, person_id)
photo_people          (same shape as photo_subjects)                 UNIQUE(photo_id, person_id)
places                (id, family_id FK→families, name text NOT NULL,
                       exif_gps jsonb {lat,lng} NULL, created_by_person_id, created_at)
                       UNIQUE(family_id, lower(name))   -- dedup within a family
photo_places          (id, photo_id FK→family_photos ON DELETE CASCADE, place_id FK→places,
                       tagged_by_person_id, created_at)  UNIQUE(photo_id, place_id)
```

No freeform text-tag column on photos — the list-view "tags" column is the union of subject/people/place chips.

### Core functions (mirror story-repository, SEE-gated on album read auth)

- `tagPhotoSubject` / `untagPhotoSubject` / `listPhotoSubjects`  (supports mint-new-person inline, like `tagStorySubject`)
- `tagPhotoPerson` / `untagPhotoPerson` / `listPhotoPeople`
- `tagPhotoPlace` (by placeId OR new name) / `untagPhotoPlace` / `listPhotoPlaces` / `listPlacesForFamily` (suggestions)
- `retargetPhotoFamilies(ctx, photoId, familyIds)` — replace `family_photo_families` set; contributor-or-steward; keep ≥1 family. (Item 5)
- Extend the album read view to include contributor display name + families + tag summaries (for List view + filtering).
- `PlaceSuggester` seam + mock (GPS → suggested place). Not wired to a real vendor.

Gating: tag writes require album **read** access (co-member) — mirrors story subject tagging. Untag idempotent.

## Phase breakdown

### Phase A — pure UI, NO migration (items 1, 2, 3, 7, 8)
Shared contract first: a `PhotoActionBar` (Edit caption · Create question · Create story · Tag people · Tag faces · Delete-with-confirm) used in BOTH the thumbnail hover toolbar (compact) and the viewer (labeled). Deep-link helpers for ask/tell already exist (viewer's "Tell story of this photo").
- A1: AlbumUploader — reposition "Manage connections" right, same line (item 1).
- A2: AlbumPhotoViewer — caption entry field w/ "Caption" placeholder; `PhotoActionBar` row below it (item 3).
- A3: Grid rendering — hover mini-toolbar on thumbnails (item 2); view selector Grid/Masonry/List (item 7); thumbnail-size slider (item 8). List view uses placeholder columns for uploader/families/tags until Phase B fills them.
Tag-people / tag-faces buttons are no-ops in Phase A (wired in Phase B / left no-op for faces).

### Phase B — tagging + places + family data model, ONE migration (items 4, 5)
Shared contract (schema + core types) landed FIRST, then fan out actions + UI.
- Schema + migration (drift-guarded); core functions above; architecture allowlist update.
- Tag-management UI (reuse `TagInput`, extend token kinds to subject/person/place; reuse `FamilyPicker` for item 5) in viewer + editor.
- Wire "Tag people" button (Phase A) to real people tagging; hover face labels deferred.

### Phase C — bulk + search/filter (items 6, 9)
- Multi-select in grid/all views; bulk bar: ask-one-question / tell-one-story / delete-selected.
  - Ask: `/hub?tab=ask` already accepts repeated `subjectPhotoIds`; add query-param preselection.
  - Tell: extend `/hub/tell` to accept `subjectPhotoIds[]` (currently single) → composer.
  - Delete: bulk soft-delete action (per-item auth).
- Search/filter bar: people, places, time period (exifCapturedAt range), caption text.

## Baseline
Album tests green at start: 6 files / 103 tests (`pnpm --filter @chronicle/web exec vitest run __tests__/album`).
