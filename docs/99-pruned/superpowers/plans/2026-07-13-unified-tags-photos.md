# Unified Tags + Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give story authors one tokenized tag field (freeform text tags + people + families) plus photo attachment in BOTH the create flow and a consolidated inline "Edit Story" surface on the story detail page.

**Architecture:** A presentational `<TagInput>` component emits three token kinds (text / person / family) and holds no authorization. A server `loadTagSuggestionsAction` feeds its typeahead. All writes reuse EXISTING core functions via EXISTING server actions: freeform tags → `editStoryDetails`, person subjects → `tagStorySubject`/`untagStorySubject`, family sharing → `retargetStoryFamilies`. On the detail page a new `StoryEditor` client component assembles title + `<TagInput>` + prose + photos and replaces the old Edit-details form, Edit-prose form, and the bottom "Who this is about" section. In the compose flow `<TagInput>` mounts in the review phase; family tokens there only seed the existing finish-step `<FamilyPicker>` (no premature sharing).

**Tech Stack:** Next.js 15 / React 19, TypeScript strict ESM, Vitest + @testing-library/react (jsdom) for web, `@chronicle/core` for all content writes.

**Spec:** `docs/superpowers/specs/2026-07-13-unified-tags-photos-design.md`

**Key facts the implementer must respect:**
- `editStoryDetails(db, { storyId, title, tags, actorPersonId, expectedUpdatedAt? })` sets BOTH title and tags and REQUIRES a non-empty title. The unified editor always holds title, so posting tags always posts the current title too.
- `tagStorySubjectAction(formData)` ALREADY accepts either `personId` OR `newPersonDisplayName` (exactly one). No change needed for dropdown-pick vs. add-as-person.
- `retargetStoryFamiliesAction(formData)` takes the FULL set of `familyIds` (owner-only, consent-laden). Family add/remove computes the new full set and posts it.
- `listMyKin(db, ctx, familyId)` is PER-FAMILY. People suggestions = union across the author's active families, deduped by `personId`.
- Web component tests: first line `// @vitest-environment jsdom`, render via `@testing-library/react`, mock server actions with `vi.mock`. Server-action tests end in `.server.test.ts` and use the PGlite helper.
- Run web tests: `pnpm --filter @chronicle/web test`. Single file: `pnpm --filter @chronicle/web exec vitest run __tests__/<file>`.

---

## File Structure

**Create:**
- `apps/web/app/hub/tag-input-types.ts` — shared contract (`TagToken`, `TagSuggestions`, `TagInputProps`). Plain `.ts`, no `"use client"`, so actions/components/tests import types without pulling the client bundle.
- `apps/web/app/hub/tag-suggestions-actions.ts` — `loadTagSuggestionsAction(storyId)` server action.
- `apps/web/app/hub/TagInput.tsx` — presentational tokenized field + typeahead dropdown.
- `apps/web/app/hub/stories/[id]/StoryEditor.tsx` — the consolidated inline editor.
- `apps/web/__tests__/tag-input.test.tsx` — `<TagInput>` unit tests.
- `apps/web/__tests__/tag-suggestions-action.server.test.ts` — loader test.
- `apps/web/__tests__/story-editor-family-remove.test.tsx` — family-remove confirm + revoke regression.
- `apps/web/__tests__/owner-action-menu.test.tsx` — kebab items test.

**Modify:**
- `apps/web/app/_copy/hub.ts` — add a `tagInput` copy block.
- `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx` — replace old inline forms with `<StoryEditor>`; drop edit-details/edit-prose local state.
- `apps/web/app/hub/stories/[id]/OwnerActionMenu.tsx` — remove "Edit details"; add "Add Photos"; keep Manage sharing + Delete.
- `apps/web/app/hub/stories/[id]/page.tsx` — load suggestions + subjects; pass to `StoryDetailClient`; remove `<StorySubjectsSection>` render.
- `apps/web/app/hub/ComposingEditor.tsx` — mount `<TagInput>` in review; family tokens drive `pickedFamilies`.

**Delete (after Task 5):**
- `apps/web/app/hub/stories/[id]/StorySubjectsSection.tsx` — absorbed into `StoryEditor`.

---

## Task 1: Shared contract types + copy

**Files:**
- Create: `apps/web/app/hub/tag-input-types.ts`
- Modify: `apps/web/app/_copy/hub.ts`

- [ ] **Step 1: Write the contract types file**

Create `apps/web/app/hub/tag-input-types.ts`:

```ts
/**
 * Shared contract for the unified tag field (spec 2026-07-13-unified-tags-photos §1).
 * Three token kinds take three DIFFERENT write paths; they are not interchangeable:
 *   - text   → element of story.tags[]         (editStoryDetails)
 *   - person → story_subjects row              (tagStorySubject / untagStorySubject)
 *   - family → target family in consent ledger (retargetStoryFamilies) — SHARES the story
 * Plain module (no "use client") so server actions, the client component, and tests all import it.
 */
export type TagToken =
  | { kind: "text"; value: string }
  | { kind: "person"; personId: string | null; displayName: string } // null id ⇒ mint on submit
  | { kind: "family"; familyId: string; name: string };

export interface TagSuggestions {
  people: { personId: string; displayName: string }[];
  families: { id: string; name: string }[];
  tags: string[];
}

export interface TagInputProps {
  tokens: TagToken[];
  suggestions: TagSuggestions;
  /** Called when the user adds a token. */
  onAdd: (token: TagToken) => void;
  /**
   * Called when the user removes a token. The CALLER gates family removal behind a confirm
   * (create vs. edit differ); TagInput only marks family chips distinct and fires this.
   */
  onRemove: (token: TagToken) => void;
  disabled?: boolean;
}

/** Stable identity for a token, used as a React key and for de-dup. */
export function tokenKey(t: TagToken): string {
  if (t.kind === "text") return `text:${t.value}`;
  if (t.kind === "person") return `person:${t.personId ?? `new:${t.displayName}`}`;
  return `family:${t.familyId}`;
}
```

- [ ] **Step 2: Add copy strings**

In `apps/web/app/_copy/hub.ts`, find the exported `hub` object and add a `tagInput` block alongside the existing blocks (e.g. near `subjects`). Add:

```ts
  tagInput: {
    label: "Tags & people",
    help: "Add a tag, or type a name to tag a person or share with a family.",
    placeholder: "Add a tag or name…",
    addAsPerson: (name: string) => `Add “${name}” as a person`,
    addAsTag: (name: string) => `Add “${name}” as a tag`,
    groupPeople: "People",
    groupFamilies: "Families (shares this story)",
    groupTags: "Tags",
    familyChipTitle: "Shared with this family",
    confirmRevoke: (name: string) => `Stop sharing this story with ${name}?`,
    remove: "Remove",
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS (no references to the new file yet, but it must compile).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/hub/tag-input-types.ts apps/web/app/_copy/hub.ts
git commit -m "feat(tags): shared TagInput contract + copy"
```

---

## Task 2: Suggestion loader server action

**Files:**
- Create: `apps/web/app/hub/tag-suggestions-actions.ts`
- Test: `apps/web/__tests__/tag-suggestions-action.server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/tag-suggestions-action.server.test.ts`. Mirror the runtime-mock pattern used by other `.server.test.ts` files (inspect `__tests__/delete-story-action.server.test.ts` for the `getRuntime` mock + PGlite seed idiom). The test seeds an account person with an active family and asserts the loader returns that family and dedupes people:

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@chronicle/db/testing";
// (Use whatever seed helpers the sibling .server.test.ts files use — persons, memberships, stories.)

let testDb: TestDb;
const auth = { getCurrentAuthContext: vi.fn() };
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: testDb.db, auth }),
}));

beforeEach(async () => {
  testDb = await createTestDb();
});
afterEach(async () => {
  await testDb.close();
  vi.clearAllMocks();
});

it("returns the author's active families and existing story tags", async () => {
  // Seed: person P (account), family F with P active, story S owned by P with tags ["Vacation"].
  // ...seed via the same helpers the sibling tests use...
  auth.getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: "P", accountId: "A" });

  const { loadTagSuggestionsAction } = await import("@/app/hub/tag-suggestions-actions");
  const res = await loadTagSuggestionsAction("S");

  expect("error" in res).toBe(false);
  if ("error" in res) throw new Error(res.error);
  expect(res.families.map((f) => f.id)).toContain("F");
  expect(res.tags).toContain("Vacation");
});
```

Note for implementer: match the EXACT seed helpers and id-generation of the sibling `.server.test.ts` files rather than the literal `"P"/"F"/"S"` placeholders above — read one sibling test first and copy its seeding style.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/tag-suggestions-action.server.test.ts`
Expected: FAIL — module `@/app/hub/tag-suggestions-actions` not found.

- [ ] **Step 3: Write the loader action**

Create `apps/web/app/hub/tag-suggestions-actions.ts`:

```ts
"use server";
/**
 * Typeahead data for the unified tag field: the author's active families, the people they know
 * (union of kin across those families, deduped), and the story's existing freeform tags.
 * Read-only; authorizes via the runtime auth context. Never trusts the storyId to grant anything —
 * story tags are read through the front door (getStoryForViewer).
 */
import {
  listActiveFamiliesForPerson,
  listMyKin,
  getStoryForViewer,
  viewerPersonId,
} from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import type { TagSuggestions } from "./tag-input-types";

export async function loadTagSuggestionsAction(
  storyId: string,
): Promise<TagSuggestions | { error: string }> {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  const person = viewerPersonId(ctx);
  if (person === null) return { error: "Not signed in." };

  const families = await listActiveFamiliesForPerson(db, person);

  // People = union of the viewer's kin across every active family, deduped by personId, identified
  // rows only (an unidentified bridge node has displayName === null and is not a taggable subject).
  const peopleById = new Map<string, string>();
  for (const fam of families) {
    const kin = await listMyKin(db, ctx, fam.familyId);
    for (const k of kin) {
      if (k.identified && k.displayName) peopleById.set(k.personId, k.displayName);
    }
  }

  // Existing tags on THIS story (front-door read; empty if not visible).
  const story = await getStoryForViewer(db, ctx, storyId);
  const tags = story?.tags ?? [];

  return {
    people: [...peopleById].map(([personId, displayName]) => ({ personId, displayName })),
    families: families.map((f) => ({ id: f.familyId, name: f.familyName })),
    tags,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/tag-suggestions-action.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/tag-suggestions-actions.ts apps/web/__tests__/tag-suggestions-action.server.test.ts
git commit -m "feat(tags): loadTagSuggestionsAction typeahead loader"
```

---

## Task 3: `<TagInput>` presentational component

**Files:**
- Create: `apps/web/app/hub/TagInput.tsx`
- Test: `apps/web/__tests__/tag-input.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/tag-input.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { TagInput } from "@/app/hub/TagInput";
import type { TagSuggestions, TagToken } from "@/app/hub/tag-input-types";

const suggestions: TagSuggestions = {
  people: [{ personId: "p1", displayName: "Grandma Rose" }],
  families: [{ id: "f1", name: "The Boudreaux Family" }],
  tags: ["Vacation"],
};

afterEach(cleanup);

it("Enter with no dropdown match adds a freeform TEXT token", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  const input = getByPlaceholderText(/add a tag or name/i);
  fireEvent.change(input, { target: { value: "Fishing" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({ kind: "text", value: "Fishing" });
});

it("picking a family suggestion adds a FAMILY token", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  fireEvent.change(getByPlaceholderText(/add a tag or name/i), { target: { value: "Boud" } });
  fireEvent.click(getByText("The Boudreaux Family"));
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({
    kind: "family",
    familyId: "f1",
    name: "The Boudreaux Family",
  });
});

it("the 'Add as person' row emits a person token with a null id", () => {
  const onAdd = vi.fn();
  const { getByPlaceholderText, getByText } = render(
    <TagInput tokens={[]} suggestions={suggestions} onAdd={onAdd} onRemove={vi.fn()} />,
  );
  fireEvent.change(getByPlaceholderText(/add a tag or name/i), { target: { value: "Uncle Jim" } });
  fireEvent.click(getByText(/add .*uncle jim.* as a person/i));
  expect(onAdd).toHaveBeenCalledWith<[TagToken]>({
    kind: "person",
    personId: null,
    displayName: "Uncle Jim",
  });
});

it("removing a family chip fires onRemove with the family token", () => {
  const onRemove = vi.fn();
  const tokens: TagToken[] = [{ kind: "family", familyId: "f1", name: "The Boudreaux Family" }];
  const { getByLabelText } = render(
    <TagInput tokens={tokens} suggestions={suggestions} onAdd={vi.fn()} onRemove={onRemove} />,
  );
  fireEvent.click(getByLabelText(/remove the boudreaux family/i));
  expect(onRemove).toHaveBeenCalledWith(tokens[0]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/tag-input.test.tsx`
Expected: FAIL — cannot find `@/app/hub/TagInput`.

- [ ] **Step 3: Write the component**

Create `apps/web/app/hub/TagInput.tsx`:

```tsx
"use client";
/**
 * Unified tag field (spec 2026-07-13 §1). Tokenized input with a typeahead that suggests people,
 * families (which SHARE the story), and existing freeform tags. Presentational only — it emits
 * onAdd/onRemove intents and holds NO authorization. Family chips render distinct (they are access
 * grants); the caller decides whether removing one needs a confirm.
 */
import { useMemo, useState } from "react";
import { hub } from "@/app/_copy";
import type { TagInputProps, TagToken } from "./tag-input-types";
import { tokenKey } from "./tag-input-types";

export function TagInput({ tokens, suggestions, onAdd, onRemove, disabled }: TagInputProps) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const ql = q.toLowerCase();

  const has = useMemo(() => new Set(tokens.map(tokenKey)), [tokens]);

  const matchedPeople = useMemo(
    () =>
      q
        ? suggestions.people
            .filter((p) => p.displayName.toLowerCase().includes(ql))
            .filter((p) => !has.has(`person:${p.personId}`))
        : [],
    [q, ql, suggestions.people, has],
  );
  const matchedFamilies = useMemo(
    () =>
      q
        ? suggestions.families
            .filter((f) => f.name.toLowerCase().includes(ql))
            .filter((f) => !has.has(`family:${f.id}`))
        : [],
    [q, ql, suggestions.families, has],
  );
  const matchedTags = useMemo(
    () =>
      q
        ? suggestions.tags
            .filter((t) => t.toLowerCase().includes(ql))
            .filter((t) => !has.has(`text:${t}`))
        : [],
    [q, ql, suggestions.tags, has],
  );

  const add = (token: TagToken) => {
    onAdd(token);
    setQuery("");
  };

  const addText = () => {
    if (!q) return;
    if (!has.has(`text:${q}`)) add({ kind: "text", value: q });
    else setQuery("");
  };

  const showDropdown = q.length > 0;

  return (
    <div style={wrap}>
      {tokens.length > 0 && (
        <ul style={chipRow}>
          {tokens.map((t) => (
            <li key={tokenKey(t)} style={t.kind === "family" ? familyChip : chip}>
              <span title={t.kind === "family" ? hub.tagInput.familyChipTitle : undefined}>
                {t.kind === "text" ? t.value : t.kind === "person" ? t.displayName : t.name}
              </span>
              <button
                type="button"
                aria-label={`${hub.tagInput.remove} ${
                  t.kind === "text" ? t.value : t.kind === "person" ? t.displayName : t.name
                }`}
                onClick={() => onRemove(t)}
                disabled={disabled}
                style={chipRemove}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={hub.tagInput.placeholder}
        aria-label={hub.tagInput.label}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addText();
          }
        }}
        style={field}
      />

      {showDropdown && (
        <div role="listbox" style={dropdown}>
          {matchedFamilies.length > 0 && <p style={groupLabel}>{hub.tagInput.groupFamilies}</p>}
          {matchedFamilies.map((f) => (
            <button
              key={`f-${f.id}`}
              type="button"
              style={option}
              onClick={() => add({ kind: "family", familyId: f.id, name: f.name })}
            >
              {f.name}
            </button>
          ))}

          {matchedPeople.length > 0 && <p style={groupLabel}>{hub.tagInput.groupPeople}</p>}
          {matchedPeople.map((p) => (
            <button
              key={`p-${p.personId}`}
              type="button"
              style={option}
              onClick={() => add({ kind: "person", personId: p.personId, displayName: p.displayName })}
            >
              {p.displayName}
            </button>
          ))}

          {matchedTags.length > 0 && <p style={groupLabel}>{hub.tagInput.groupTags}</p>}
          {matchedTags.map((t) => (
            <button key={`t-${t}`} type="button" style={option} onClick={() => add({ kind: "text", value: t })}>
              {t}
            </button>
          ))}

          {/* Always-available creators. */}
          <button type="button" style={option} onClick={addText}>
            {hub.tagInput.addAsTag(q)}
          </button>
          <button
            type="button"
            style={option}
            onClick={() => add({ kind: "person", personId: null, displayName: q })}
          >
            {hub.tagInput.addAsPerson(q)}
          </button>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { position: "relative", display: "grid", gap: 10 };
const chipRow: React.CSSProperties = {
  listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8,
};
const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", fontWeight: 500,
  color: "var(--text-muted)", border: "1.5px solid var(--border-strong)",
  borderRadius: "var(--radius-pill)", padding: "4px 10px",
};
const familyChip: React.CSSProperties = {
  ...chip, color: "var(--accent-strong)", background: "var(--accent-soft)",
  borderColor: "var(--accent-strong)",
};
const chipRemove: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "inherit",
  fontSize: "0.85em", lineHeight: 1, padding: 0,
};
const field: React.CSSProperties = {
  padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--surface-card)", fontFamily: "var(--font-ui)", fontSize: "var(--text-ui)",
  color: "var(--text-body)", width: "100%", boxSizing: "border-box",
};
const dropdown: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4,
  background: "var(--surface-card)", border: "1.5px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lift)", padding: 6,
  display: "flex", flexDirection: "column", gap: 2, maxHeight: 280, overflowY: "auto",
};
const groupLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", textTransform: "uppercase",
  letterSpacing: "0.06em", color: "var(--support)", margin: "6px 8px 2px",
};
const option: React.CSSProperties = {
  textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-body)",
  padding: "8px 10px", borderRadius: "var(--radius-md)", width: "100%",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/tag-input.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/TagInput.tsx apps/web/__tests__/tag-input.test.tsx
git commit -m "feat(tags): TagInput tokenized field with typeahead"
```

---

## Task 4: `StoryEditor` — consolidated inline editor

**Files:**
- Create: `apps/web/app/hub/stories/[id]/StoryEditor.tsx`
- Read for reference: `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx` (existing action imports + inline-form styles), `apps/web/app/hub/StoryPhotosEditor.tsx`
- Test: `apps/web/__tests__/story-editor-family-remove.test.tsx`

This component owns the editor's local token state, converts tokens ↔ server actions, and gates family removal behind a confirm. It receives the initial state from the detail page.

- [ ] **Step 1: Write the failing test (family-remove confirm + revoke)**

Create `apps/web/__tests__/story-editor-family-remove.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const { editStoryDetailsAction, tagStorySubjectAction, untagStorySubjectAction, retargetStoryFamiliesAction } =
  vi.hoisted(() => ({
    editStoryDetailsAction: vi.fn(async () => undefined),
    tagStorySubjectAction: vi.fn(async () => undefined),
    untagStorySubjectAction: vi.fn(async () => undefined),
    retargetStoryFamiliesAction: vi.fn(async () => undefined),
  }));
vi.mock("../app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
}));
// StoryPhotosEditor self-loads; stub it so this stays a pure editor test.
vi.mock("../app/hub/StoryPhotosEditor", () => ({ StoryPhotosEditor: () => null }));
// jsdom has no window.confirm by default; make it deterministic.
vi.stubGlobal("confirm", vi.fn(() => true));

import { StoryEditor } from "@/app/hub/stories/[id]/StoryEditor";
import type { TagSuggestions } from "@/app/hub/tag-input-types";

const suggestions: TagSuggestions = { people: [], families: [], tags: [] };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("removing a family chip confirms, then posts the reduced family set and touches nothing else", async () => {
  render(
    <StoryEditor
      storyId="S"
      initialTitle="My Story"
      initialTags={[]}
      initialProse="Once upon a time."
      initialPersonSubjects={[]}
      initialTargetFamilies={[{ id: "f1", name: "Fam One" }, { id: "f2", name: "Fam Two" }]}
      suggestions={suggestions}
      onClose={vi.fn()}
    />,
  );

  fireEvent.click(document.querySelector('[aria-label="Remove Fam One"]')!);

  expect(confirm).toHaveBeenCalled();
  await waitFor(() => expect(retargetStoryFamiliesAction).toHaveBeenCalledTimes(1));
  const fd = retargetStoryFamiliesAction.mock.calls[0]![0] as FormData;
  expect(fd.getAll("familyIds")).toEqual(["f2"]);
  expect(untagStorySubjectAction).not.toHaveBeenCalled();
  expect(editStoryDetailsAction).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/story-editor-family-remove.test.tsx`
Expected: FAIL — cannot find `@/app/hub/stories/[id]/StoryEditor`.

- [ ] **Step 3: Write `StoryEditor`**

Create `apps/web/app/hub/stories/[id]/StoryEditor.tsx`:

```tsx
"use client";
/**
 * Consolidated story editor (spec 2026-07-13 §3). One inline surface: title · TagInput · prose ·
 * photos. Replaces the old Edit-details form, Edit-prose form, and the "Who this is about" section.
 * Each token kind writes through its OWN existing server action; family removal (a consent revoke)
 * confirms first. This component names WHICH story; the server actions re-resolve auth + ownership.
 */
import { useMemo, useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { TagInput } from "@/app/hub/TagInput";
import { StoryPhotosEditor } from "@/app/hub/StoryPhotosEditor";
import type { TagSuggestions, TagToken } from "@/app/hub/tag-input-types";
import {
  editStoryDetailsAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
} from "./actions";

export interface StoryEditorProps {
  storyId: string;
  initialTitle: string;
  initialTags: string[];
  initialProse: string;
  initialPersonSubjects: { personId: string; displayName: string }[];
  initialTargetFamilies: { id: string; name: string }[];
  suggestions: TagSuggestions;
  onClose: () => void;
  /** When true, StoryPhotosEditor scrolls into view on mount (kebab "Add Photos"). */
  focusPhotos?: boolean;
}

export function StoryEditor(props: StoryEditorProps) {
  const { storyId, suggestions, onClose } = props;
  const [title, setTitle] = useState(props.initialTitle);
  const [tags, setTags] = useState<string[]>(props.initialTags);
  const [prose, setProse] = useState(props.initialProse);
  const [people, setPeople] = useState(props.initialPersonSubjects);
  const [families, setFamilies] = useState(props.initialTargetFamilies);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tokens: TagToken[] = useMemo(
    () => [
      ...tags.map((value): TagToken => ({ kind: "text", value })),
      ...people.map((p): TagToken => ({ kind: "person", personId: p.personId, displayName: p.displayName })),
      ...families.map((f): TagToken => ({ kind: "family", familyId: f.id, name: f.name })),
    ],
    [tags, people, families],
  );

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) setError(res.error);
      else setError(null);
    });

  const saveTags = (nextTags: string[]) => {
    setTags(nextTags);
    const fd = new FormData();
    fd.set("storyId", storyId);
    fd.set("title", title);
    for (const t of nextTags) fd.append("tags", t);
    run(() => editStoryDetailsAction(fd));
  };

  const saveFamilies = (nextFamilies: { id: string; name: string }[]) => {
    setFamilies(nextFamilies);
    const fd = new FormData();
    fd.set("storyId", storyId);
    for (const f of nextFamilies) fd.append("familyIds", f.id);
    run(() => retargetStoryFamiliesAction(fd));
  };

  const onAdd = (token: TagToken) => {
    if (token.kind === "text") {
      saveTags([...tags, token.value]);
    } else if (token.kind === "family") {
      saveFamilies([...families, { id: token.familyId, name: token.name }]);
    } else {
      // person: optimistic add, then tag by id or by new name.
      const fd = new FormData();
      fd.set("storyId", storyId);
      if (token.personId) fd.set("personId", token.personId);
      else fd.set("newPersonDisplayName", token.displayName);
      // Optimistic: show a chip immediately; the personId for a minted person is unknown client-side,
      // so use a temporary null id — the page revalidation reloads the authoritative subject list.
      setPeople((cur) => [...cur, { personId: token.personId ?? `pending:${token.displayName}`, displayName: token.displayName }]);
      run(() => tagStorySubjectAction(fd));
    }
  };

  const onRemove = (token: TagToken) => {
    if (token.kind === "text") {
      saveTags(tags.filter((t) => t !== token.value));
    } else if (token.kind === "family") {
      if (!confirm(hub.tagInput.confirmRevoke(token.name))) return;
      saveFamilies(families.filter((f) => f.id !== token.familyId));
    } else {
      setPeople((cur) => cur.filter((p) => p.personId !== token.personId));
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("personId", token.personId ?? "");
      run(() => untagStorySubjectAction(fd));
    }
  };

  const saveTitleAndProse = () => {
    const fdD = new FormData();
    fdD.set("storyId", storyId);
    fdD.set("title", title);
    for (const t of tags) fdD.append("tags", t);
    const fdP = new FormData();
    fdP.set("storyId", storyId);
    fdP.set("prose", prose);
    run(async () => {
      const d = await editStoryDetailsAction(fdD);
      if (d && "error" in d && d.error) return d;
      return editStoryProseFallback(fdP);
    });
  };

  // Local alias so the import list stays explicit about what StoryEditor calls.
  const editStoryProseFallback = (fd: FormData) =>
    import("./actions").then((m) => m.editStoryProseAction(fd));

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <label style={fieldLabel}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          style={textField}
        />
      </label>

      <div style={{ display: "grid", gap: 6 }}>
        <span style={fieldLabel}>{hub.tagInput.label}</span>
        <p style={helpText}>{hub.tagInput.help}</p>
        <TagInput tokens={tokens} suggestions={suggestions} onAdd={onAdd} onRemove={onRemove} disabled={pending} />
      </div>

      <label style={fieldLabel}>
        Story
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          disabled={pending}
          rows={12}
          style={{ ...textField, fontFamily: "var(--font-story)", resize: "vertical" }}
        />
      </label>

      <StoryPhotosEditor storyId={storyId} />

      {error && <p role="alert" style={errText}>{error}</p>}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} disabled={pending} style={ghostBtn}>
          Done
        </button>
        <KindredButton
          type="button"
          label={pending ? "Saving…" : "Save title & story"}
          disabled={pending}
          onClick={saveTitleAndProse}
        />
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "grid", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", fontWeight: 600,
  color: "var(--text-body)",
};
const helpText: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-muted)", margin: 0,
};
const textField: React.CSSProperties = {
  padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--surface-card)", fontSize: "var(--text-ui)", color: "var(--text-body)",
  width: "100%", boxSizing: "border-box",
};
const errText: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-danger, #b00)", margin: 0,
};
const ghostBtn: React.CSSProperties = {
  padding: "8px 16px", borderRadius: "var(--radius-pill)", border: "1px solid var(--border)",
  background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontWeight: 600,
};
```

Implementer note: `editStoryDetailsAction` requires a non-empty title — the field is `required` in the UI; if empty, the action returns an error that surfaces in `error`. Title & prose are committed via the explicit "Save" button; tag/person/family changes autosave on each add/remove (they are individually reversible and match the old per-section behavior).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/story-editor-family-remove.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/stories/[id]/StoryEditor.tsx apps/web/__tests__/story-editor-family-remove.test.tsx
git commit -m "feat(tags): StoryEditor consolidated inline editor"
```

---

## Task 5: Wire `StoryEditor` into the detail page; remove old forms + subjects section

**Files:**
- Modify: `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx`
- Modify: `apps/web/app/hub/stories/[id]/page.tsx`
- Delete: `apps/web/app/hub/stories/[id]/StorySubjectsSection.tsx`

- [ ] **Step 1: Load suggestions + subjects and pass them down (page.tsx)**

In `apps/web/app/hub/stories/[id]/page.tsx`:
- Import `loadTagSuggestionsAction` from `@/app/hub/tag-suggestions-actions`.
- After computing `subjects`, call `const suggestions = await loadTagSuggestionsAction(story.id);` and coerce an error result to empty suggestions: `const tagSuggestions = "error" in suggestions ? { people: [], families: [], tags: [] } : suggestions;`
- Pass two new props to `<StoryDetailClient>`: `initialPersonSubjects={subjects}` and `tagSuggestions={tagSuggestions}`.
- Remove the `<StorySubjectsSection ... />` block and its surrounding wrapper `<div>` (lines ~118-124), and remove its import.

- [ ] **Step 2: Replace inline edit forms with `<StoryEditor>` (StoryDetailClient.tsx)**

In `apps/web/app/hub/stories/[id]/StoryDetailClient.tsx`:
- Add props to the component's props interface: `initialPersonSubjects: { personId: string; displayName: string }[];` and `tagSuggestions: TagSuggestions;` (import the type from `@/app/hub/tag-input-types`).
- Add one state: `const [editorOpen, setEditorOpen] = useState(false);` and `const [focusPhotos, setFocusPhotos] = useState(false);`
- Delete the `isEditingDetails` / `isEditingProse` state and their inline `<form>` blocks (the Edit Details form ~308-386 and the Edit prose form). Keep the `isEditingSharing` (Manage sharing) block untouched.
- Change the kebab wiring: `onEditStory={() => { setFocusPhotos(false); setEditorOpen(true); }}` and add `onAddPhotos={() => { setFocusPhotos(true); setEditorOpen(true); }}`. Remove `onEditDetails`.
- Where the Edit Details form used to render, render:

```tsx
{editorOpen ? (
  <StoryEditor
    storyId={storyId}
    initialTitle={title}
    initialTags={tags}
    initialProse={prose}
    initialPersonSubjects={initialPersonSubjects}
    initialTargetFamilies={targetFamilies}
    suggestions={tagSuggestions}
    focusPhotos={focusPhotos}
    onClose={() => setEditorOpen(false)}
  />
) : (
  <>
    {/* existing read-only title + tags/targeting pills + prose render stays here */}
  </>
)}
```

Ensure `targetFamilies` (already in the client from `initialTargetFamilies`) has the `{ id, name }` shape `StoryEditor` expects; if it's a different local name, map it.

- [ ] **Step 3: Delete the absorbed section**

```bash
git rm apps/web/app/hub/stories/[id]/StorySubjectsSection.tsx
```

- [ ] **Step 4: Typecheck + run the story detail tests**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.
Run: `pnpm --filter @chronicle/web exec vitest run __tests__ -t "story"`
Expected: PASS (no test still references `StorySubjectsSection`; if one does, update it to drive `StoryEditor` instead).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/stories/[id]/
git commit -m "feat(tags): detail page uses StoryEditor; drop separate details/prose/subjects UI"
```

---

## Task 6: OwnerActionMenu — remove "Edit details", add "Add Photos"

**Files:**
- Modify: `apps/web/app/hub/stories/[id]/OwnerActionMenu.tsx`
- Test: `apps/web/__tests__/owner-action-menu.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/owner-action-menu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
vi.mock("../app/hub/stories/[id]/actions", () => ({ deleteStoryAction: vi.fn(async () => undefined) }));
import { OwnerActionMenu } from "@/app/hub/stories/[id]/OwnerActionMenu";

afterEach(cleanup);

it("shows Edit story, Add photos, Manage sharing, Delete — and NOT Edit details", () => {
  const { getByText, queryByText, getByLabelText } = render(
    <OwnerActionMenu
      storyId="S"
      isOwner
      onEditStory={vi.fn()}
      onAddPhotos={vi.fn()}
      onManageSharing={vi.fn()}
    />,
  );
  fireEvent.click(getByLabelText(/story options/i));
  expect(getByText(/edit story/i)).toBeTruthy();
  expect(getByText(/add photos/i)).toBeTruthy();
  expect(getByText(/manage sharing/i)).toBeTruthy();
  expect(getByText(/delete story/i)).toBeTruthy();
  expect(queryByText(/edit details/i)).toBeNull();
});

it("Add photos fires onAddPhotos", () => {
  const onAddPhotos = vi.fn();
  const { getByText, getByLabelText } = render(
    <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={onAddPhotos} onManageSharing={vi.fn()} />,
  );
  fireEvent.click(getByLabelText(/story options/i));
  fireEvent.click(getByText(/add photos/i));
  expect(onAddPhotos).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/owner-action-menu.test.tsx`
Expected: FAIL — prop `onAddPhotos` does not exist / "Edit details" still present.

- [ ] **Step 3: Edit `OwnerActionMenu.tsx`**

- Change `OwnerActionMenuProps`: remove `onEditDetails`, add `onAddPhotos: () => void;`.
- Remove `onEditDetails` from the destructure; add `onAddPhotos`.
- Replace the "✏️ Edit details" menu button with an "Edit story" item that calls `onEditStory`, and add a new "📷 Add photos" item that calls `onAddPhotos`. Keep the existing "📝 Edit story" from being duplicated — the final ordered items are: **Edit story** (calls `onEditStory`), **Add photos** (calls `onAddPhotos`), **Manage sharing** (`onManageSharing`), **Delete story**. Each item mirrors the existing `itemBaseStyle` button pattern:

```tsx
<button type="button" role="menuitem" onClick={() => { setOpen(false); onEditStory(); }} style={itemBaseStyle}
  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-soft)"; }}
  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
  📝 Edit story
</button>
<button type="button" role="menuitem" onClick={() => { setOpen(false); onAddPhotos(); }} style={itemBaseStyle}
  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-soft)"; }}
  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
  📷 Add photos
</button>
```

(Manage sharing and Delete story buttons stay exactly as they are.)

- [ ] **Step 4: Update the caller**

In `StoryDetailClient.tsx`, the `<OwnerActionMenu>` usage must now pass `onAddPhotos` and no longer pass `onEditDetails` (done in Task 5 Step 2 — verify it compiles here).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/owner-action-menu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/hub/stories/[id]/OwnerActionMenu.tsx apps/web/__tests__/owner-action-menu.test.tsx
git commit -m "feat(tags): kebab drops Edit details, adds Add photos"
```

---

## Task 7: Create flow — TagInput in the compose review phase

**Files:**
- Modify: `apps/web/app/hub/ComposingEditor.tsx`

Behavior (spec §2): mount `<TagInput>` in the review phase. **text + person** tokens write to the draft immediately (reuse the same actions as the editor). **family** tokens do NOT share — they toggle into the existing `pickedFamilies` set, which the finish-step `<FamilyPicker>` already reads.

- [ ] **Step 1: Add suggestion + token state to ComposingEditor**

Near the other review-phase state (around the `pickedFamilies` state, ~line 159), add:

```tsx
const [tagSuggestions, setTagSuggestions] = useState<TagSuggestions>({ people: [], families: [], tags: [] });
const [draftTags, setDraftTags] = useState<string[]>([]);
const [draftPeople, setDraftPeople] = useState<{ personId: string; displayName: string }[]>([]);
```

Load suggestions once the draft has a stable id (mirror how `StoryPhotosEditor` self-loads — use `composingStoryId`):

```tsx
useEffect(() => {
  if (!composingStoryId) return;
  void loadTagSuggestionsAction(composingStoryId).then((res) => {
    if (!("error" in res)) setTagSuggestions(res);
  });
}, [composingStoryId]);
```

Add imports at the top: `import { TagInput } from "./TagInput";`, `import { loadTagSuggestionsAction } from "./tag-suggestions-actions";`, `import type { TagSuggestions, TagToken } from "./tag-input-types";`, and the story actions `editStoryDetailsAction, tagStorySubjectAction, untagStorySubjectAction` from `./stories/[id]/actions`.

- [ ] **Step 2: Wire token add/remove**

Add handlers. Family tokens route to `pickedFamilies` (via the existing `toggleFamily`); text/person write to the draft:

```tsx
const composeTokens: TagToken[] = [
  ...draftTags.map((value): TagToken => ({ kind: "text", value })),
  ...draftPeople.map((p): TagToken => ({ kind: "person", personId: p.personId, displayName: p.displayName })),
  ...[...pickedFamilies].map((id): TagToken => {
    const fam = families.find((f) => f.familyId === id);
    return { kind: "family", familyId: id, name: fam?.familyName ?? id };
  }),
];

const onTagAdd = (t: TagToken) => {
  if (t.kind === "family") { toggleFamily(t.familyId); return; }
  if (t.kind === "text") {
    const next = [...draftTags, t.value];
    setDraftTags(next);
    const fd = new FormData();
    fd.set("storyId", composingStoryId!);
    fd.set("title", titleValue); // the compose title state — use whatever the review title field is bound to
    for (const v of next) fd.append("tags", v);
    void editStoryDetailsAction(fd);
    return;
  }
  setDraftPeople((cur) => [...cur, { personId: t.personId ?? `pending:${t.displayName}`, displayName: t.displayName }]);
  const fd = new FormData();
  fd.set("storyId", composingStoryId!);
  if (t.personId) fd.set("personId", t.personId); else fd.set("newPersonDisplayName", t.displayName);
  void tagStorySubjectAction(fd);
};

const onTagRemove = (t: TagToken) => {
  if (t.kind === "family") { toggleFamily(t.familyId); return; } // staged only — no confirm needed pre-share
  if (t.kind === "text") {
    const next = draftTags.filter((v) => v !== t.value);
    setDraftTags(next);
    const fd = new FormData();
    fd.set("storyId", composingStoryId!);
    fd.set("title", titleValue);
    for (const v of next) fd.append("tags", v);
    void editStoryDetailsAction(fd);
    return;
  }
  setDraftPeople((cur) => cur.filter((p) => p.personId !== t.personId));
  const fd = new FormData();
  fd.set("storyId", composingStoryId!);
  fd.set("personId", t.personId ?? "");
  void untagStorySubjectAction(fd);
};
```

Implementer note: `titleValue` above is a stand-in — bind it to the compose review-phase title state (the existing `title`/`editTitle` variable in this component). `editStoryDetails` needs a non-empty title, so only call it once the review title is set; if the review has no title field yet at the point TagInput renders, gate tag writes until title exists, or place `<TagInput>` in the same review section that already collects the title.

- [ ] **Step 3: Render `<TagInput>` in the review section**

Place it in the review/share fieldset near the `<FamilyPicker>` (~line 749), so families added via tags visibly reflect in the picker below:

```tsx
<div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
  <span className="kin-form-label">{hub.tagInput.label}</span>
  <TagInput
    tokens={composeTokens}
    suggestions={tagSuggestions}
    onAdd={onTagAdd}
    onRemove={onTagRemove}
    disabled={otherMutationInFlight}
  />
</div>
```

- [ ] **Step 4: Typecheck + compose tests**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.
Run: `pnpm --filter @chronicle/web exec vitest run __tests__ -t "compos"`
Expected: PASS (existing compose tests still green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/ComposingEditor.tsx
git commit -m "feat(tags): TagInput in compose; family tags feed the finish picker"
```

---

## Task 8: Full-suite green + verification

**Files:** none (verification task).

- [ ] **Step 1: Run the full web suite**

Run: `pnpm --filter @chronicle/web test`
Expected: PASS. If any prior test referenced the deleted `StorySubjectsSection` or the removed `onEditDetails` prop, fix it to drive the new `StoryEditor`/`OwnerActionMenu` surface (do NOT delete coverage — port it).

- [ ] **Step 2: Run core + db suites (unchanged, must stay green)**

Run: `pnpm --filter @chronicle/core test && pnpm --filter @chronicle/db test`
Expected: PASS (no core/db changes were made; this confirms nothing regressed via shared types).

- [ ] **Step 3: Typecheck + lint the workspace**

Run: `pnpm -r typecheck && pnpm --filter @chronicle/web lint`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, via /run)**

Start the dev server (`pnpm --filter @chronicle/web dev`) and confirm on `/hub/stories/[id]` as the owner: kebab shows Edit story / Add photos / Manage sharing / Delete; Edit story opens the unified editor; typing a name offers "Add as person" + family/tag suggestions; adding a family shows a distinct chip; removing it prompts a confirm. In compose review, adding a family reflects in the finish picker.

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test(tags): port existing coverage to StoryEditor/OwnerActionMenu; suite green"
```

---

## Self-Review notes (author)

- **Spec §1 (unified field, 3 kinds):** Tasks 1+3. **§2 (create):** Task 7. **§3 (edit surface, kebab):** Tasks 4–6. **§4 (safety/confirm):** Task 4 (family confirm) + Task 7 (staged, no confirm pre-share). **§5 (tests):** Tasks 2,3,4,6 + Task 8 regression via story-editor-family-remove.
- **Requirement coverage:** #1 photos-in-create (Task 7 keeps StoryPhotosEditor; already present) & #2 kebab Add Photos (Task 6) & #3 remove Edit Details / one Edit Story (Tasks 5,6) & #4 manual tags create+edit (Tasks 4,7) & #5 add/remove tags while viewing (Task 4) & #6 one field + typeahead (Task 3) & #7 convert "who is this about" (Task 5 deletes StorySubjectsSection, absorbed into TagInput).
- **No new migration** — no schema change; all writes reuse existing core functions.
- **Known imperfection to watch:** optimistic person chips use a `pending:` placeholder id until page revalidation returns the authoritative subject list. On the compose surface there is no automatic revalidation of the TagInput props, so a minted person may show as `pending:` until the suggestions reload — acceptable for the draft surface; if it reads poorly, reload suggestions after `tagStorySubjectAction` resolves.
