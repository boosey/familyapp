# Multi-family picker for chosen-audience content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every surface where an author *chooses a family audience* (self-story, answer, photo upload) the same multi-family picker, seeded consistently, with story targeting written at the share step.

**Architecture:** Reuse the existing `ask_families` seeding/resolve helpers (`apps/web/lib/compose-scope.ts`) and a new shared `<FamilyPicker>` component. Stories acquire families at approval: `approveAndShareStory` gains an explicit `familyIds` param (validated against the owner's active memberships, honored in the same transaction, overriding the default-targeting computation). Asks and photos keep their creation-time write paths; only their picker UI + default seeding change.

**Tech Stack:** TypeScript, Next.js 15 App Router (React 19 server + client components), Drizzle, PGlite (Vitest), pnpm workspaces.

**Reference spec:** `docs/superpowers/specs/2026-07-05-multi-family-picker-shared-content-design.md`

---

## File map

| File | Change |
|---|---|
| `packages/core/src/story-repository.ts` | Add `familyIds?` to `ApproveAndShareInput`; explicit-target branch in `approveAndShareStory` |
| `packages/core/test/story-repository.test.ts` (or nearest existing approve test) | Regression tests for explicit targeting |
| `apps/web/app/hub/FamilyPicker.tsx` | **New** shared checkbox component |
| `apps/web/app/hub/tabs/AskFamilyPicker.tsx` | Re-implement on top of `<FamilyPicker>` |
| `apps/web/app/hub/album/AlbumUploader.tsx` | Use `<FamilyPicker>`; seed from `scope` |
| `apps/web/app/hub/album/AlbumSurface.tsx` + `album/page.tsx` | Thread `scope` into the uploader |
| `apps/web/app/hub/ComposingEditor.tsx` | Accept `families`/`seededFamilyIds`/`familyChoiceRequired`; render picker by tier; post `familyIds` |
| `apps/web/app/hub/StoryComposer.tsx` | Pass the three new props through |
| `apps/web/app/hub/answer/[askId]/page.tsx` | Load answerer families + ask families → seed |
| `apps/web/app/hub/tell/page.tsx` + `tell/[storyId]/page.tsx` | Load families + `?scope=` → seed |
| `apps/web/app/hub/answer/[askId]/actions.ts` | `shareAnswerAction` resolves + forwards `familyIds` |
| `apps/web/app/_copy.ts` | New copy strings for the story family picker |

---

## Task 1: Core — explicit family targeting in `approveAndShareStory` (shared contract, blocking)

This is the shared contract every UI task depends on. Build and green it first.

**Files:**
- Modify: `packages/core/src/story-repository.ts` (`ApproveAndShareInput` ~412-433; targeting block ~650-684)
- Test: the existing approve/share test file. Find it first: `pnpm --filter @chronicle/core exec vitest run --reporter=verbose 2>&1 | grep -i approveAndShare` or grep the test dir for `approveAndShareStory`.

- [ ] **Step 1: Locate the existing approve test file**

Run: `grep -rl "approveAndShareStory" packages/core/test`
Use that file for the new tests. If more than one, pick the one that already builds a story to `pending_approval` and calls `approveAndShareStory` (the sharing test).

- [ ] **Step 2: Write failing regression tests**

Add to that test file. These assume the file's existing helpers for seeding a person, two families, active memberships, and a `pending_approval` story owned by that person (reuse whatever the neighbouring tests use; mirror an existing test's setup exactly).

```ts
describe("approveAndShareStory explicit familyIds (multi-family picker)", () => {
  it("writes exactly the explicit family targets, overriding the default computation", async () => {
    // owner is active in famA and famB; a self-story (no ask, originatingFamilyId null)
    // would otherwise be ambiguous → target nothing.
    const { db, owner, famA, famB, storyId } = await seedAmbiguousMultiFamilyStory();
    const res = await approveAndShareStory(db, {
      storyId,
      narratorPersonId: owner.id,
      audienceTier: "family",
      familyIds: [famB.id],
    });
    expect(res.ambiguousDefaultTarget).toBe(false);
    expect(res.targetedFamilyIds).toEqual([famB.id]);
  });

  it("rejects a family the owner is not an active member of", async () => {
    const { db, owner, storyId } = await seedAmbiguousMultiFamilyStory();
    await expect(
      approveAndShareStory(db, {
        storyId,
        narratorPersonId: owner.id,
        audienceTier: "family",
        familyIds: ["00000000-0000-0000-0000-000000000000"],
      }),
    ).rejects.toThrow(/not an active member/i);
  });

  it("falls back to default targeting when no familyIds are given (ambiguous → nothing)", async () => {
    const { db, owner, storyId } = await seedAmbiguousMultiFamilyStory();
    const res = await approveAndShareStory(db, {
      storyId,
      narratorPersonId: owner.id,
      audienceTier: "family",
    });
    expect(res.targetedFamilyIds).toEqual([]);
    expect(res.ambiguousDefaultTarget).toBe(true);
  });
});
```

If no reusable `seedAmbiguousMultiFamilyStory` helper exists, write it inline in the test file: create one person, two families, two active memberships, and a story via the same low-level path the neighbouring passing test uses (draft → `pending_approval`), with `askId` null and `originatingFamilyId` null.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @chronicle/core exec vitest run -t "explicit familyIds"`
Expected: FAIL — the first test gets `targetedFamilyIds: []` / `ambiguousDefaultTarget: true` because `familyIds` is ignored today; the second does not throw.

- [ ] **Step 4: Add `familyIds` to the input type**

In `ApproveAndShareInput` (after the `approvalAudio` field, before `now?`):

```ts
  /**
   * Explicit family targets chosen by the author at the share step (ADR-0010; multi-family picker).
   * When present and non-empty for a `family`/`branch` tier, these REPLACE the default-targeting
   * computation: the set is validated against the owner's ACTIVE memberships (a foreign family
   * throws) and written as the story's `story_families`. Absent/empty → the existing default rule
   * (originating family / ask families / sole active family / ambiguous) applies unchanged. Ignored
   * for `public`.
   */
  familyIds?: string[];
```

- [ ] **Step 5: Honor `familyIds` in the targeting block**

In `approveAndShareStory`, replace the targeting block (the `if (input.audienceTier === "family" || input.audienceTier === "branch")` body, ~652-684) with a version that checks the explicit set first:

```ts
    let targetedFamilyIds: string[] = [];
    let ambiguousDefaultTarget = false;
    if (input.audienceTier === "family" || input.audienceTier === "branch") {
      const explicit = [...new Set(input.familyIds ?? [])];
      if (explicit.length > 0) {
        // Explicit author choice (multi-family picker) wins. Validate every target against the
        // owner's active memberships — same guard as setStoryFamilyTargets — then write the set.
        const ownerActive = await tx
          .select({ familyId: memberships.familyId })
          .from(memberships)
          .where(
            and(
              eq(memberships.personId, current.ownerPersonId),
              eq(memberships.status, "active"),
            ),
          );
        const ownerActiveSet = new Set(ownerActive.map((r) => r.familyId));
        for (const familyId of explicit) {
          if (!ownerActiveSet.has(familyId)) {
            throw new InvariantViolation(
              `approveAndShareStory: story owner ${current.ownerPersonId} is not an active member ` +
                `of family ${familyId}; cannot surface a story into a family its owner isn't in`,
            );
          }
        }
        await tx.delete(storyFamilies).where(eq(storyFamilies.storyId, input.storyId));
        await tx
          .insert(storyFamilies)
          .values(explicit.map((familyId) => ({ storyId: input.storyId, familyId })));
        targetedFamilyIds = [...explicit].sort();
      } else {
        const existing = await tx
          .select({ familyId: storyFamilies.familyId })
          .from(storyFamilies)
          .where(eq(storyFamilies.storyId, input.storyId))
          .orderBy(storyFamilies.familyId);
        if (existing.length > 0) {
          targetedFamilyIds = existing.map((r) => r.familyId);
        } else {
          const ownerActive = await tx
            .select({ familyId: memberships.familyId })
            .from(memberships)
            .where(
              and(
                eq(memberships.personId, current.ownerPersonId),
                eq(memberships.status, "active"),
              ),
            );
          const { targets, ambiguous } = computeDefaultFamilyTargets({
            originatingFamilyId: current.originatingFamilyId,
            askFamilyIds,
            ownerActiveFamilyIds: new Set(ownerActive.map((r) => r.familyId)),
          });
          ambiguousDefaultTarget = ambiguous;
          if (targets.length > 0) {
            await tx
              .insert(storyFamilies)
              .values(targets.map((familyId) => ({ storyId: input.storyId, familyId })));
            targetedFamilyIds = targets;
          }
        }
      }
    }
```

(`memberships`, `and`, `eq`, `storyFamilies`, `InvariantViolation`, `computeDefaultFamilyTargets` are all already imported/defined in this file.)

- [ ] **Step 6: Run the new tests + the full core suite**

Run: `pnpm --filter @chronicle/core exec vitest run -t "explicit familyIds"` → PASS
Run: `pnpm --filter @chronicle/core test` → all green (the existing default-targeting tests must still pass — the `else` branch is byte-identical behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/test
git commit -m "feat(core): approveAndShareStory honors explicit family targets"
```

---

## Task 2: Shared `<FamilyPicker>` component + refactor Ask/Album to use it

**Files:**
- Create: `apps/web/app/hub/FamilyPicker.tsx`
- Modify: `apps/web/app/hub/tabs/AskFamilyPicker.tsx`
- Modify: `apps/web/app/hub/album/AlbumUploader.tsx`

- [ ] **Step 1: Create the shared component**

`apps/web/app/hub/FamilyPicker.tsx`:

```tsx
"use client";

/**
 * Shared multi-family checkbox picker for chosen-audience content (asks, album uploads, stories).
 * Controlled: the parent owns the selected set. Each checked box posts its family id under `name`
 * (default "familyIds"), read server-side via `formData.getAll(name)`. The caller decides WHEN to
 * render it — every surface hides it for a single-family actor (nothing to choose) and auto-resolves
 * the sole family server-side. When `required`, a visually-hidden focusable input mirrors "≥1 checked"
 * so native form validation blocks an empty submit; server guards backstop it.
 */
export interface FamilyOption {
  familyId: string;
  familyName: string;
}

export function FamilyPicker({
  families,
  selected,
  onToggle,
  name = "familyIds",
  disabled = false,
  required = false,
  requiredMessage,
}: {
  families: FamilyOption[];
  selected: Set<string>;
  onToggle: (familyId: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  requiredMessage?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {families.map((f) => (
        <label
          key={f.familyId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-body)",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            name={name}
            value={f.familyId}
            checked={selected.has(f.familyId)}
            disabled={disabled}
            onChange={() => onToggle(f.familyId)}
          />
          {f.familyName}
        </label>
      ))}
      {required ? (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={selected.size > 0 ? "ok" : ""}
          onChange={() => {}}
          onInvalid={(e) =>
            (e.currentTarget as HTMLInputElement).setCustomValidity(requiredMessage ?? "Choose at least one family.")
          }
          onInput={(e) => (e.currentTarget as HTMLInputElement).setCustomValidity("")}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Refactor `AskFamilyPicker` to wrap it**

Replace the body of `AskFamilyPicker` so it owns the `checked` state and the `<fieldset>`/`<legend>`/help-text chrome, delegating the checkbox rows + required input to `<FamilyPicker>`:

```tsx
"use client";
import { useState } from "react";
import { hub } from "@/app/_copy";
import { FamilyPicker } from "../FamilyPicker";

export function AskFamilyPicker({
  families,
  seeded,
  required,
}: {
  families: { familyId: string; familyName: string }[];
  seeded: string[];
  required: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(seeded));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 10 }}>
      <legend className="kin-form-label" style={{ padding: 0, marginBottom: 2 }}>
        {hub.ask.familiesLabel}
      </legend>
      {required ? (
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", color: "var(--text-muted)", margin: 0 }}>
          {hub.ask.familiesHelp}
        </p>
      ) : null}
      <FamilyPicker
        families={families}
        selected={checked}
        onToggle={toggle}
        required={required}
        requiredMessage={hub.ask.familiesRequired}
      />
    </fieldset>
  );
}
```

- [ ] **Step 3: Refactor `AlbumUploader`'s checkbox block**

In `AlbumUploader.tsx`, replace the `{families.map(...)}` rows inside its `<fieldset>` (the block ~188-213) with:

```tsx
          <FamilyPicker
            families={families}
            selected={selected}
            onToggle={toggle}
            disabled={pending}
          />
```

Add the import: `import { FamilyPicker } from "../FamilyPicker";`. Keep the surrounding `<fieldset>`/`<legend>` and the existing `toggle`/`selected` state as-is (`AlbumFamilyOption` is shape-compatible with `FamilyOption`).

- [ ] **Step 4: Typecheck + run web tests**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS (no type errors).
Run: `pnpm --filter @chronicle/web test`
Expected: existing ask/album tests still green (behavior unchanged — pure extraction).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/FamilyPicker.tsx apps/web/app/hub/tabs/AskFamilyPicker.tsx apps/web/app/hub/album/AlbumUploader.tsx
git commit -m "refactor(web): extract shared FamilyPicker; reuse in ask + album"
```

---

## Task 3: Photo upload — seed the picker from hub `?scope=`

**Files:**
- Modify: `apps/web/app/hub/album/AlbumUploader.tsx`
- Modify: `apps/web/app/hub/album/AlbumSurface.tsx` and/or `apps/web/app/hub/album/page.tsx`

- [ ] **Step 1: Read the album surface chain**

Run: `grep -n "AlbumUploader\|currentFamilyId\|scope" apps/web/app/hub/album/AlbumSurface.tsx apps/web/app/hub/album/page.tsx`
Confirm how `AlbumUploader` receives `currentFamilyId` and whether `scope` already reaches `AlbumSurface` from `hub/page.tsx` (it is passed to tabs there — see `hub/page.tsx:280-328`).

- [ ] **Step 2: Add an optional `scope` prop to `AlbumUploader` and seed from it**

In `AlbumUploader.tsx`, add `scope` to props and change the seed. Import the helper:

```tsx
import { seedComposeFamilies } from "@/lib/compose-scope";
```

Props:

```tsx
export function AlbumUploader({
  families,
  currentFamilyId,
  scope = null,
}: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
  scope?: string | null;
}) {
```

Replace the initial seed + the re-seed-on-context-change so a scope signal wins, else fall back to the current album:

```tsx
  const familyIds = families.map((f) => f.familyId);
  const seed = () => {
    if (scope && scope !== "all") {
      const s = seedComposeFamilies(scope, familyIds);
      if (s.size > 0) return s;
    }
    return new Set([currentFamilyId]);
  };
  const showPicker = families.length > 1;
  const [selected, setSelected] = useState<Set<string>>(seed);
  const [prevKey, setPrevKey] = useState(`${scope ?? ""}|${currentFamilyId}`);
  const key = `${scope ?? ""}|${currentFamilyId}`;
  if (prevKey !== key) {
    setPrevKey(key);
    setSelected(seed());
  }
```

Also update the two `setSelected(new Set([currentFamilyId]))` calls (post-upload reset ~119) to `setSelected(seed())`.

- [ ] **Step 3: Thread `scope` from the surface into the uploader**

In `AlbumSurface.tsx` (and `album/page.tsx` if it constructs the uploader), accept `scope` where the surface is already handed the hub scope and pass `scope={scope}` to `<AlbumUploader>`. If `AlbumSurface` does not yet receive `scope`, add it to its props and pass it from `hub/page.tsx` where `<AlbumSurface .../>` is rendered (that call already has `scope` in context per `hub/page.tsx`).

- [ ] **Step 4: Typecheck + test**

Run: `pnpm --filter @chronicle/web typecheck` → PASS
Run: `pnpm --filter @chronicle/web test` → green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/hub/album
git commit -m "feat(web): seed album family picker from hub scope"
```

---

## Task 4: Story share picker (self-story + answer)

Thread families through the composer, render the picker in the review phase (only for `family`/`branch` tiers), post the chosen ids, and resolve them server-side in `shareAnswerAction`.

**Files:**
- Modify: `apps/web/app/_copy.ts`
- Modify: `apps/web/app/hub/ComposingEditor.tsx`
- Modify: `apps/web/app/hub/StoryComposer.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/page.tsx`
- Modify: `apps/web/app/hub/tell/page.tsx`, `apps/web/app/hub/tell/[storyId]/page.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts`

- [ ] **Step 1: Add copy strings**

In `apps/web/app/_copy.ts`, under the `hub.answer` block, add:

```ts
    whichFamilies: "Which families should see this?",
    whichFamiliesHelp: "Choose one or more of your families.",
    whichFamiliesRequired: "Choose at least one family for this story.",
```

- [ ] **Step 2: Server-side — `shareAnswerAction` resolves + forwards `familyIds`**

In `apps/web/app/hub/answer/[askId]/actions.ts`, at the top add imports:

```ts
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { resolveComposeFamilies } from "@/lib/compose-scope";
```

In `shareAnswerAction`, after `audienceTier` is validated (after ~670) and before `approveAndShareStory`, resolve the chosen families — but only for `family`/`branch`:

```ts
    let familyIds: string[] | undefined;
    if (audienceTier === "family" || audienceTier === "branch") {
      const chosen = formData
        .getAll("familyIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      const active = (await listActiveFamiliesForPerson(db, ctx.personId)).map((f) => f.familyId);
      // Re-reads the answerer's OWN active families (defense in depth — core re-validates too),
      // auto-resolves the single-family case, THROWS on ambiguous-empty. A single-family author
      // sends no boxes and this yields their sole family.
      familyIds = resolveComposeFamilies(chosen, active);
    }
```

Then pass it into the approve call:

```ts
    await approveAndShareStory(db, {
      storyId,
      narratorPersonId: ctx.personId,
      audienceTier,
      ...(familyIds && familyIds.length > 0 ? { familyIds } : {}),
    });
```

`resolveComposeFamilies` throws on ambiguous-empty; that throw is inside the existing `try` and surfaces as `hub.actions.shareFailed`. (Optional polish: catch it to return a friendlier "pick a family" — not required for correctness since the client `required` guard blocks the empty submit first.)

- [ ] **Step 3: Thread props through `StoryComposer`**

In `StoryComposer.tsx`, extend `StoryComposerProps` and pass through:

```ts
  /** The author's active families for the share-step audience picker. Empty/one → no picker shown. */
  families?: { familyId: string; familyName: string }[];
  /** Family ids to pre-check, seeded from the ask (answer) or hub scope (tell). */
  seededFamilyIds?: string[];
  /** True when the author must explicitly choose ≥1 family (ambiguous "all"+several). */
  familyChoiceRequired?: boolean;
```

Add them to the destructured params (defaulting `families = []`, `seededFamilyIds = []`, `familyChoiceRequired = false`) and forward to `<ComposingEditor>`.

- [ ] **Step 4: Consume props in `ComposingEditor` + render the picker**

In `ComposingEditor.tsx`:

Add to `ComposingEditorProps`:

```ts
  families?: { familyId: string; familyName: string }[];
  seededFamilyIds?: string[];
  familyChoiceRequired?: boolean;
```

Destructure with defaults in the function signature (`families = []`, `seededFamilyIds = []`, `familyChoiceRequired = false`).

Add selection state near the other review state (after `const [tier, setTier] = useState<Tier>("family");` ~145):

```tsx
  const [pickedFamilies, setPickedFamilies] = useState<Set<string>>(() => new Set(seededFamilyIds));
  const toggleFamily = (id: string) =>
    setPickedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const showFamilyPicker = families.length > 1 && (tier === "family" || tier === "branch");
```

Import the picker + copy at top: `import { FamilyPicker } from "./FamilyPicker";` (already imports `hub` copy).

In `handleShare` (~505), append the chosen ids when the picker is active:

```tsx
      form.append("audienceTier", tier);
      if (showFamilyPicker) {
        for (const id of pickedFamilies) form.append("familyIds", id);
      }
```

Render the picker in the review UI. Find where `<TierPicker .../>` is rendered (grep `TierPicker` usage in the JSX) and immediately AFTER it insert:

```tsx
      {showFamilyPicker ? (
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 32px" }}>
          <legend
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--support)",
              marginBottom: 14,
              display: "block",
              width: "100%",
            }}
          >
            {hub.answer.whichFamilies}
          </legend>
          <FamilyPicker
            families={families}
            selected={pickedFamilies}
            onToggle={toggleFamily}
            disabled={op === "share"}
            required={familyChoiceRequired}
            requiredMessage={hub.answer.whichFamiliesRequired}
          />
        </fieldset>
      ) : null}
```

Note: the picker markup lives inside whatever form/element wraps the review controls so its checkboxes participate in the same native-validation scope as the Share button. If Share is a plain button (not a `<form>` submit), the `required` hidden input has no form to block; in that case ALSO guard in `handleShare`:

```tsx
      if (showFamilyPicker && familyChoiceRequired && pickedFamilies.size === 0) {
        setActionError(hub.answer.whichFamiliesRequired);
        setOp(null);
        return;
      }
```

Add that guard unconditionally (it is a no-op when not required) right after `setOp("share")` in `handleShare` — it is the reliable check since the review Share is a button, not a form submit.

- [ ] **Step 5: Seed the ANSWER surface — load answerer + ask families**

In `apps/web/app/hub/answer/[askId]/page.tsx`:

Add imports:

```ts
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { askFamilies } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
```

After the ask is loaded (~57), compute the seed (default = ask families ∩ answerer's active families; picker offers ALL active families — the free picker):

```ts
  const answererFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const activeIds = new Set(answererFamilies.map((f) => f.familyId));
  const askFamRows = await db
    .select({ familyId: askFamilies.familyId })
    .from(askFamilies)
    .where(eq(askFamilies.askId, askId));
  // Free picker: seed with the families the question was asked into that the answerer is still in;
  // the answerer may add/remove any of THEIR OWN active families (bounded server-side).
  const seededFamilyIds = askFamRows
    .map((r) => r.familyId)
    .filter((id) => activeIds.has(id));
```

Pass to `<StoryComposer>` (the `mode="answer"` render ~212):

```tsx
        <StoryComposer
          key={draft?.storyId ?? "record"}
          mode="answer"
          ask={{ id: askId, questionText: askDetail.questionText, askerName: askDetail.askerSpokenName }}
          draft={draft}
          families={answererFamilies}
          seededFamilyIds={seededFamilyIds}
          familyChoiceRequired={false}
        />
```

(Answers are never `familyChoiceRequired` — they always have a sensible ask-derived default; if that default is empty because the answerer left every ask family, the picker still shows all their families and the server auto-resolves a single-family author or requires a choice via `resolveComposeFamilies`.)

- [ ] **Step 6: Seed the TELL surfaces — families + `?scope=`**

In `apps/web/app/hub/tell/page.tsx`, add imports:

```ts
import { listActiveFamiliesForPerson } from "@chronicle/core";
import { seedComposeFamilies, familyChoiceRequired } from "@/lib/compose-scope";
```

After the params are read (~47), compute seed from `?scope=` (validate scope against the author's own families, mirroring `hub/page.tsx`):

```ts
  const scopeRaw = typeof params.scope === "string" ? params.scope : "all";
  const tellFamilies = await listActiveFamiliesForPerson(db, ctx.personId);
  const tellFamilyIds = tellFamilies.map((f) => f.familyId);
  const scope = scopeRaw === "all" || tellFamilyIds.includes(scopeRaw) ? scopeRaw : "all";
  const seededFamilyIds = [...seedComposeFamilies(scope, tellFamilyIds)];
  const tellChoiceRequired = familyChoiceRequired(scope, tellFamilyIds);
```

Pass to `<StoryComposer mode="tell" ...>` (~98):

```tsx
        <StoryComposer
          mode="tell"
          ask={null}
          draft={null}
          subjectPhotoId={subjectPhotoId}
          promptQuestion={promptQuestion}
          families={tellFamilies}
          seededFamilyIds={seededFamilyIds}
          familyChoiceRequired={tellChoiceRequired}
        />
```

- [ ] **Step 7: Seed the TELL RESUME surface**

Read `apps/web/app/hub/tell/[storyId]/page.tsx`. It renders `<StoryComposer mode="tell" draft={...}>` for a resumed draft — the review (share) phase happens HERE, so it MUST also pass the picker props. Apply the SAME block as Step 6 (load `listActiveFamiliesForPerson`, read `?scope=`, compute seed) and pass `families`/`seededFamilyIds`/`familyChoiceRequired` to its `<StoryComposer>`. (The resume page may not have `?scope=` in its URL; if absent, `scopeRaw` defaults to `"all"` → for a multi-family author the picker shows unchecked and `familyChoiceRequired` is true, forcing an explicit pick before share. That is the correct fail-safe.)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.

- [ ] **Step 9: Write a web test for the share action forwarding**

Add a test (mirror an existing `shareAnswerAction` test if one exists; else the nearest actions test). Assert that for a multi-family author, posting `familyIds` results in the story being targeted into exactly those families. If actions are hard to unit-test in isolation, instead add/extend a core-level test already covered in Task 1 and cover the WEB layer with a `FamilyPicker` render test:

```tsx
// apps/web/__tests__/family-picker.test.tsx
import { render } from "@testing-library/react";
import { FamilyPicker } from "@/app/hub/FamilyPicker";

it("renders a checkbox per family and posts under the given name", () => {
  const { container } = render(
    <FamilyPicker
      families={[{ familyId: "a", familyName: "Alpha" }, { familyId: "b", familyName: "Beta" }]}
      selected={new Set(["a"])}
      onToggle={() => {}}
      name="familyIds"
    />,
  );
  const boxes = container.querySelectorAll('input[type="checkbox"][name="familyIds"]');
  expect(boxes.length).toBe(2);
  expect((boxes[0] as HTMLInputElement).checked).toBe(true);
});
```

Run: `pnpm --filter @chronicle/web test` → green.

- [ ] **Step 10: Manual smoke (dev server)**

Run: `pnpm --filter @chronicle/web dev`. As a multi-family account: (a) `/hub/tell` → record/type a self-story → in review the "Which families should see this?" picker appears for `family`/`branch`, is required, and after picking + Share the story lands only in the chosen family/families; (b) answer an ask → picker pre-checks the ask's families, is editable across your families. Confirm a `public` share hides the picker.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): multi-family picker on self-story + answer share step"
```

---

## Task 5 (follow-up, display-only): suppress ask attribution on a divergent target

The approved design says: when an answer is targeted into a family the ask was never asked into, suppress the originating-question context in that family's feed. This is display-only and touches the story-render-in-feed path, which this plan has not yet mapped. Treat as a scoped follow-up.

**Files:** TBD — determined by Step 1.

- [ ] **Step 1: Locate where a story renders its originating ask context in a family feed**

Run: `grep -rn "questionText\|askerName\|answeredAsk\|ask\?\." apps/web/app/hub/tabs apps/web/app/hub/stories 2>/dev/null` and inspect the stories/feed components. Identify the component that shows "In answer to: <question>" (or equivalent) on a shared story tile/detail.

- [ ] **Step 2: Decide the data source**

Determine whether that component already knows (a) the story's `story_families` and (b) the ask's `ask_families`. If not both are in scope, extend the feed query to include a boolean `askContextVisible = story targets ⊆ ask families` (or per-family: visible only when the viewing family ∈ ask families).

- [ ] **Step 3: Gate the attribution block**

Wrap the ask-attribution JSX in that visibility condition so the question is shown only in a family the ask was actually asked into.

- [ ] **Step 4: Test + commit** (regression test asserting the attribution is hidden for a divergent-target family; commit).

> If the render path proves larger than a small gate, STOP and report back — do not expand scope. The picker (Tasks 1-4) is the deliverable; this suppression can ship separately.

---

## Self-review notes

- **Spec coverage:** self-story picker (Task 4 Steps 6-7), answer free picker (Task 4 Step 5), photo seed-from-scope (Task 3), shared component (Task 2), share-step timing + core contract (Task 1), leakage suppression (Task 5). All spec sections mapped.
- **Out of scope confirmed untouched:** link-session `/s/[token]`, intake, follow-up takes.
- **Type consistency:** `FamilyOption`/`AlbumFamilyOption`/`listActiveFamiliesForPerson` rows all use `{familyId, familyName}`; `families`/`seededFamilyIds`/`familyChoiceRequired` prop names identical across StoryComposer ↔ ComposingEditor; `familyIds` param name identical across web action ↔ core input.
- **Known soft spot:** Task 4 Step 4 assumes the review Share is a button, not a `<form>` submit — hence the explicit `handleShare` guard rather than relying on the hidden `required` input. Verify during implementation and keep the JS guard regardless.
