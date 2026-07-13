# Unified tags + photos across create & edit — design

**Date:** 2026-07-13
**Status:** Approved (brainstorming), pending implementation plan
**Surfaces:** `/hub` compose flow (`ComposingEditor`) and `/hub/stories/[id]` detail/edit.

## Problem

Seven requested affordances, all converging on two gaps:

1. Photos can be attached only while *composing* (`StoryPhotosEditor` inside `ComposingEditor`), never while *editing* a finished story.
2. Tagging is split across two structurally different, differently-placed mechanisms:
   - **Freeform tags** — `story.tags` (`string[]`), edited via the kebab's *Edit details* form.
   - **"Who this is about"** — `story_subjects` person links, edited in a separate section at the bottom of the detail page (`StorySubjectsSection`).

The request: one tag entry field that unifies freeform tags **and** people/family entities with a typeahead dropdown, available in both create and edit; photos addable in both; and a consolidated single "Edit Story" action.

### Requirement → design map

| # | Requirement | Where handled |
|---|---|---|
| 1 | Photo affordance when creating/editing (from question or self-induced) | §2 (create — already present), §3 (edit — new) |
| 2 | Kebab "Add Photos" button | §3 |
| 3 | Remove "Edit Details"; everything editable from "Edit Story" | §3 |
| 4 | Manual tag adding when creating/editing | §1, §2, §3 |
| 5 | Author viewing a story can add/remove tags | §3 |
| 6 | One entry field for subject tags + people/family, typeahead dropdown | §1 |
| 7 | Convert "who is this about" into the all-in-one field | §1, §3 |

## Load-bearing decisions (locked during brainstorming)

- **A family chip also shares.** Adding a family to the unified field grants that family read access (a consent event, ADR-0010) — it is not merely a descriptive label. People and freeform text remain descriptive.
- **Removing a family chip confirms first.** Family chips render visually distinct; their remove control prompts "Stop sharing with the {family}?" before writing the revocation. Text/person chips remove instantly.
- **During create, family tags feed the finish-step picker.** A draft is private until Finish & Share. Families added via the field during compose become the pre-selected targets at the existing `<FamilyPicker>` step; **no sharing happens until Finish.** Person/text tags apply to the draft immediately.
- **Free-typed text is a text tag, not a person.** A person chip is created only by picking from the dropdown or via an explicit "Add as person" affordance. This prevents typos from minting ghost `mention` Persons.
- **Manage sharing stays in the kebab.** It remains the deliberate/full sharing surface; the tag field's family chips mirror the same target set, never a second source of truth.
- **Edit surface is inline on the detail page (Approach A).** No new route, no modal — matches the codebase's existing inline-edit pattern; the editor is extracted into its own component so the 641-line detail client does not balloon.

## §1 — The shared contract: `<TagInput>`

A single tokenized field with a typeahead. A token is one of three kinds; they are **not** the same data and take different write paths.

| Chip kind | Dropdown source | Persisted as | Core write path | Reversible |
|---|---|---|---|---|
| **text** | matching existing `story.tags` | element of `story.tags[]` | `editStoryDetails` | yes, instant |
| **person** (subject / "about") | `listMyKin` typeahead; explicit "Add as person" mints a `mention` | `story_subjects` row | `tagStorySubject` / `untagStorySubject` | yes, instant |
| **family** (shares!) | `listActiveFamiliesForPerson` | target family in the consent ledger | `retargetStoryFamilies` | **confirm-on-remove** |

**Typeahead:** as the user types, the dropdown groups matches into *People*, *Families*, and *Tags* (existing freeform values). Enter with no selection creates a freeform **text** tag. An explicit "Add {typed} as person" row appears in the dropdown to promote free text into a person chip.

**Component boundary:** presentational; emits intents; holds no authorization. It receives current tokens + suggestion data and calls back on add/remove. Auth and all writes live server-side in the actions (unchanged authorization surface).

**Locked TypeScript contract** (defined before any wiring, per the shared-contracts-first rule):

```ts
type TagToken =
  | { kind: "text"; value: string }
  | { kind: "person"; personId: string | null; displayName: string } // null id ⇒ mint on submit
  | { kind: "family"; familyId: string; name: string };

interface TagSuggestions {
  people: { personId: string; displayName: string }[];
  families: { id: string; name: string }[];
  tags: string[];
}

interface TagInputProps {
  tokens: TagToken[];
  suggestions: TagSuggestions;
  onAdd(token: TagToken): void;
  onRemove(token: TagToken): void; // caller gates family removal behind a confirm
}
```

Family removal confirmation is the **caller's** responsibility (create vs. edit differ), so `<TagInput>` exposes `onRemove` and marks family chips distinct; it does not itself decide consent.

## §2 — Create flow (items 1, 4)

`ComposingEditor` already mounts `StoryPhotosEditor` against the draft (`draft.storyId`); item 1 is essentially present — verify it reads as an "Add photos" affordance and keep it. **New:** mount `<TagInput>` in the review phase.

- **text + person** tokens apply immediately to the draft via `editStoryDetails` / `tagStorySubject`.
- **family** tokens do **not** share yet. They seed the finish-step `<FamilyPicker>` selection (single shared list; two views). Sharing is committed only when the narrator Finishes.

Suggestion data (`listMyKin`, `listActiveFamiliesForPerson`, existing tags) is loaded server-side and passed in, mirroring how `StoryPhotosEditor` self-loads.

## §3 — Edit surface (items 2, 3, 5) — Approach A

Extract a new **`StoryEditor`** client component. "Edit Story" from the kebab expands it inline on `/hub/stories/[id]` with, in order: **title · `<TagInput>` · prose · photos** (`StoryPhotosEditor`).

`StoryEditor` **replaces**:
- the current *Edit details* inline form (title + comma tags),
- the current *Edit prose* inline form,
- the bottom *"Who this is about"* section (`StorySubjectsSection` is absorbed into the unified field).

On an already-published story, **family chips share/revoke immediately** via `retargetStoryFamilies` (revoke behind the confirm). `retargetStoryFamilies` takes the full target set — the field computes the new set and posts it, identical to how *Manage sharing* writes today, so the two never diverge.

**Kebab (`OwnerActionMenu`) becomes:**
- `Edit Story` → opens `StoryEditor`
- `Add Photos` → opens `StoryEditor`, scrolled to the photos block
- `Manage sharing` → unchanged (kept as the deliberate/full sharing surface)
- `Delete story` → unchanged

*Edit details* is removed.

## §4 — Safety / consent behavior

- Family = a consent write everywhere it appears. **Add is casual; remove always confirms.** Person and text edits are free — no re-consent, append audit revision as today.
- The tag field is never a second source of truth for sharing: it reads and writes the same target set as *Manage sharing* through `retargetStoryFamilies`.
- No change to the single-front-door authorization surface or the append-only consent ledger; all writes go through existing core functions.

## §5 — Testing

- `<TagInput>` unit tests: typeahead classification into people/families/tags; the three chip kinds; Enter-creates-text-tag; "Add as person" promotion; family chips marked distinct; `onRemove` fires for each kind.
- Family-removal confirm gate (caller-side) in both create and edit contexts.
- Regression test: removing a family chip on a published story revokes exactly one family via `retargetStoryFamilies` and leaves `story.tags` and `story_subjects` untouched.
- Existing core coverage for `editStoryDetails`, `tagStorySubject`/`untagStorySubject`, `retargetStoryFamilies` is reused, not duplicated.
- Per the post-bugfix rule, any bug found during build gets a companion regression test.

## Non-goals / out of scope

- No new data model. `story.tags`, `story_subjects`, and family targeting stay as they are; this is a UI/interaction consolidation over existing write paths.
- No multi-file inline upload change (the separate `project_story_photo_multiattach_todo` item); photos here reuse `StoryPhotosEditor` as-is.
- No change to favorite/like affordances.
- No new migration expected (no schema change).
