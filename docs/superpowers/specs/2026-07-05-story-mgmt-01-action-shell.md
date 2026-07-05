# Unit 01 — Story Action Shell & Shared Contracts

**Prerequisite for:** units 02–05 (menu items) and, loosely, 06–07 (card action row).
**Migration:** none. **Blast radius:** the story detail page + one new component.

## Purpose

Build the small, shared UI + convention layer that every other unit hangs off, so the
later units don't each reinvent (and collide over) the same scaffolding. This unit ships
nothing user-visible on its own **except** an (initially empty-ish) owner menu — keep it
tiny. Resist adding features here; they belong to units 02–07.

## What this unit delivers

1. **`isOwner` computation** on the detail page.
2. **`OwnerActionMenu`** — a reusable kebab (⋮) menu component, owner-only, top-right of
   the read surface.
3. **A card action row** placeholder where favorite/like buttons (units 06/07) will sit —
   directly on the card, not in the menu.
4. **A documented server-action convention** the later units follow.

## Spec

### `isOwner`

In `apps/web/app/hub/stories/[id]/page.tsx` (`StoryDetailPage`), after the story is loaded
via `getStoryForViewer(db, ctx, id)`:

```ts
const isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId;
```

Pass `isOwner` (and `story.id`) into the header region so the menu can render conditionally.
Do **not** expose `ownerPersonId` to the client beyond this boolean.

### `OwnerActionMenu` component

- New client component, e.g. `apps/web/app/hub/stories/[id]/OwnerActionMenu.tsx`.
- Renders a kebab (⋮) icon button, positioned top-right of the view screen header
  (align with the existing back-link / meta row at page.tsx lines ~99–162).
- Opens a popover/menu of items. **Renders nothing at all when `!isOwner`.**
- Props shape (the shared contract — later units add items, they do not restructure):

```ts
type OwnerActionMenuProps = {
  storyId: string;
  isOwner: boolean;
  // later units add optional item props / children here, e.g. onDelete route,
  // current title/tags, family target data. Keep additive.
};
```

- Accessibility: the trigger is a real `<button>` with `aria-haspopup="menu"` and an
  `aria-label` like "Story options"; menu items are focusable; `Esc` closes; click-outside
  closes. **Do NOT use `window.confirm`/`alert`/native dialogs** (they block the page and,
  in browser-automation review, freeze the extension) — destructive confirms (unit 02) use
  an in-DOM confirmation, not a browser dialog.
- Styling: follow the existing Kindred design system used on this page (serif title,
  accent pills, `_kindred` components). Match the existing button idiom rather than
  inventing a new one.

### Card action row (favorite/like placeholder)

- A horizontal action row on the story card, visible to **any account viewer** (not just
  owner), where units 06 (favorite/heart) and 07 (like/thumbs-up) render their buttons.
- This unit just establishes the container + placement (near the title/meta or footer of
  the read card). If it's cleaner to introduce this container when unit 06 lands, that is
  acceptable — but document the intended placement here so 06/07 agree.

### Server-action convention (documented, mirror in every later unit)

Every mutation from these units is a Next.js server action that:
1. Is declared `"use server"` (a dedicated `actions.ts` colocated with the route, mirroring
   `apps/web/app/hub/answer/[askId]/actions.ts`).
2. Re-reads `getRuntime()` and `getCurrentAuthContext()` **on the server** — never accepts
   `personId`/ownership from the client.
3. Calls a **core** function (in `story-repository.ts` / `erasure-repository.ts`) that
   independently re-checks authorization. The server action is defense-in-depth, the core
   check is authoritative.
4. Revalidates the affected paths (`revalidatePath`) and/or `redirect`s as appropriate.

## Plan (TDD)

1. **Read** `apps/web/app/hub/stories/[id]/page.tsx` fully and
   `apps/web/app/hub/answer/[askId]/actions.ts` header for the server-action idiom. Note
   the design-system components in use (`_kindred/*`).
2. **Component test first:** add a test for `OwnerActionMenu` (React Testing Library, the
   project's existing web test setup under `apps/web/__tests__/`). Assert: renders nothing
   when `isOwner` is false; renders a labelled kebab trigger when true; opens on click;
   closes on `Esc`. (No menu items yet — those arrive with units 02–05.)
3. **Implement** `OwnerActionMenu.tsx` to pass the test.
4. **Wire** `isOwner` in `page.tsx` and mount `<OwnerActionMenu>` in the header. Confirm the
   page still renders for a non-owner (menu absent) and an owner (kebab present).
5. **Typecheck + test + lint:** `pnpm --filter @chronicle/web typecheck`, `... test`,
   `... lint`. Then `pnpm -r typecheck` to be safe.
6. **Regression test:** the component test from step 2 IS the regression guard for the
   owner/non-owner visibility rule. Keep it.

## Done when

- [ ] `isOwner` computed on the detail page, not leaking `ownerPersonId`.
- [ ] `OwnerActionMenu` renders kebab for owner, nothing for non-owner; keyboard-accessible;
      no native dialogs.
- [ ] Card action-row placement decided and documented (built here or explicitly deferred to 06).
- [ ] Server-action convention section above is the reference for units 02–05.
- [ ] `pnpm --filter @chronicle/web typecheck test lint` green; `pnpm -r typecheck` green.

## Adversarial notes

- Keep this unit boring. The temptation is to build delete "while I'm here" — don't; that's
  unit 02 and mixing them defeats the resumability goal.
- The menu must degrade to nothing for magic-link (non-account) viewers, who have no owner
  identity. `ctx.kind === "account"` guards this.
