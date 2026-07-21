# Unit 04 — Manage family sharing (add/remove family tags)

**Prerequisite:** Unit 01 (Story Action Shell — `isOwner`, `OwnerActionMenu`, server-action convention).
**Migration:** none. **Blast radius:** the story detail page + one server action + one new core wrapper (+ its export); reuses the existing `FamilyPicker`.

## Purpose

Let a story's **OWNER** change which of their families a shared `family`/`branch`-tier story
is targeted to, directly from the read surface. Retargeting scopes which co-members can see
the story (`story_families`, the authz INPUT the visibility function intersects). The write
primitive already exists (`setStoryFamilyTargets`); this unit adds the **owner gate** and the
**UI** on top of it. It does not touch the audience *tier* — only the family target set within
whatever tier the story already has.

## Spec

### Behavior

- **Owner:** kebab (`OwnerActionMenu`, Unit 01) → "Manage sharing" → opens a `FamilyPicker`
  pre-checked to the story's CURRENT target families → owner toggles → Save → server action →
  owner-gated core wrapper → replace-set → `revalidatePath`. The family pills near the meta
  row (`page.tsx` ~195–212) reflect the new set on reload.
- **Non-owner:** no affordance whatsoever. The menu already renders nothing for non-owners /
  magic-link viewers (Unit 01 `isOwner` guard). The server action re-checks anyway.
- **Only meaningful for `family`/`branch` tier.** For a `public` or `private` story, family
  targeting does nothing (public ignores `story_families`; private is owner-only). Either hide
  the "Manage sharing" item unless `story.audienceTier` is `family`/`branch`, OR show it disabled
  with a one-line explanation. RECOMMEND: hide it for non-family tiers to keep the menu honest.

### The new owner-gated core wrapper (REQUIRED — option (a))

`setStoryFamilyTargets(db, storyId, familyIds)` (`story-repository.ts` ~1525) takes **no
`AuthContext`** — its own doc-comment (~1466–1472) says "ACTOR AUTHORIZATION is the CALLER's
responsibility." Authorizing only in the server action is **not sufficient** for this repo's
front-door philosophy: core-level authz is the load-bearing guarantee, the Next layer is
defense-in-depth. So add a thin wrapper in `story-repository.ts`:

```ts
export async function retargetStoryFamilies(
  db: Database,
  ctx: AuthContext,
  input: { storyId: string; familyIds: string[] },
): Promise<{ targetedFamilyIds: string[] }>;
```

Contract:
1. `ctx.kind === "account"` (magic-link/session ctx cannot own → reject).
2. Load the story's `ownerPersonId` (single select).
3. Assert `ctx.personId === story.ownerPersonId`; else throw `InvariantViolation`
   (`retargetStoryFamilies: actor <personId> is not the owner of story <storyId>`) — mirror the
   wording style already used by `approveAndShareStory` (~525).
4. Reuse the existing REPLACE-SET path. Prefer wrapping the whole thing in one `db.transaction`
   and calling `replaceStoryFamilyTargetsTx(tx, "retargetStoryFamilies", storyId, ownerPersonId,
   familyIds)` so the owner-load + validate + replace are atomic (the bare `setStoryFamilyTargets`
   re-loads the owner in its own tx, which would be a second read and a TOCTOU seam). Return the
   dedup'd written set.
5. Family-validity (each target ∈ owner's ACTIVE memberships) is already enforced inside
   `replaceStoryFamilyTargetsTx` — do not re-implement it.

Export `retargetStoryFamilies` from `packages/core/src/index.ts`.

### Consent-event decision (do NOT silently skip)

`approveAndShareStory` appends a `consent_records` row on first share (`approved_for_sharing`,
~576). Retargeting **changes the effective sharing scope** of an already-shared story — it can
newly expose the story to a family, or withdraw it from one. The ledger enum already has a fitting
action: **`set_audience_tier`** (schema ~100–104; the enum is "shaped to accept more without
migration"), and a scope-change is squarely a consent-relevant event.

**RECOMMENDATION (implement this):** append ONE `consent_records` row per successful retarget,
inside the same transaction as the replace-set, via `recordConsent`
(`packages/core/src/consent.ts` ~31) — or a direct `tx.insert` if we need it in the same tx the
wrapper opens. Shape:
- `personId` / `actorPersonId` = the owner (`ctx.personId`).
- `storyId` = the story.
- `action` = `"set_audience_tier"` (reuse; the resulting family set IS the audience scope). If a
  dedicated `retargeted_families` action reads truer, adding an enum value is migration-free per
  the schema comment — but that is a naming call, flag below.
- `resultingState` = a serialization of the new target set (e.g. sorted family-id CSV, or the
  story state). Keep it a string; the column is `text`.
- `approvalAudioMediaId` = `null` (a tap/click retarget has no voiced clip, exactly like a tap
  approval — precedent at ~583).

**OPEN DECISION (flag, do not block):** (i) reuse `set_audience_tier` vs. add a
`sharing_scope_changed` enum value; (ii) whether a no-op retarget (new set === current set)
should still write a ledger row. RECOMMEND: reuse `set_audience_tier`; and SKIP the ledger write
when the dedup'd new set equals the current set (no scope change, no consent event) — compute the
current set inside the tx before replacing.

### Un-share / empty-set semantics

Passing `familyIds: []` is legal and clears targeting — the story becomes **owner-only at family
tier** (no co-member can see it; the visibility function has no `story_families` row to intersect).
`replaceStoryFamilyTargetsTx` already handles `[]` (delete-all, no insert). The **story state /
`assertStoryTransition` does NOT care** — `state` stays `shared` and `audienceTier` stays
`family`/`branch`; only the target set changes. This is deliberately distinct from erasure (Unit
02) and from a state transition. Note the known-limitation comment at `approveAndShareStory`
~653–658: an explicit empty set is indistinguishable from "never chosen" *at approval time* — but
that only matters to the approval defaulter, which does not run on retarget, so retarget-to-empty
is safe and durable here. Surface a confirmation affordance for "remove all families" in the UI
(it silently un-shares), but no browser-native dialog (Unit 01 rule).

### UI seeding

- Reuse `apps/web/app/hub/FamilyPicker.tsx` (controlled; parent owns a `Set<string>`; each checked
  box posts under `name` for `formData.getAll`).
- **Option list = the OWNER's OWN active families**, via `loadViewerFamilies(db, ctx)`
  (`apps/web/lib/hub-data.ts` ~121 — verified export; returns `{id,name}[]`, empty for non-account).
  Reasoning: the picker's options are exactly the families the owner *could* target, i.e. the
  owner's active memberships — the same validity set `replaceStoryFamilyTargetsTx` enforces.
  Because the owner IS the viewer here, `loadViewerFamilies` returns precisely that set; do NOT
  use the leak-safe intersection `loadStoryFamilyTargets` (~138) for the OPTION list — that helper
  is for rendering pills to arbitrary viewers and would (for the owner) coincide but conceptually
  narrows to current targets, not available options.
- **Pre-checked set = the story's CURRENT targets.** Seed from the story's `story_families` rows.
  Since the owner is in every family the story can target, the owner's view of current targets is
  complete — read them owner-scoped (either `loadStoryFamilyTargets(db,[story.id], ownerFamilyIds)`
  with the owner's own family-id list, or a direct current-target read). Pass into the picker as
  the initial `Set`.
- Single-family owner: the picker convention hides itself for a single-family actor and
  auto-resolves — but retarget-to-empty (un-share) is still a meaningful choice for a single-family
  owner, so provide at minimum a "shared with <family> ▸ remove" toggle rather than nothing.

## Plan (TDD)

Tests first, in order:

1. **Read** (done): `story-repository.ts` ~1450–1550 (`setStoryFamilyTargets`,
   `replaceStoryFamilyTargetsTx`, the authz doc-comment), `approveAndShareStory` ~502–716,
   `computeDefaultFamilyTargets` ~486–500; `consent.ts` `recordConsent`; schema
   `consentActionEnum` ~100; `FamilyPicker.tsx`; `hub-data.ts` `loadViewerFamilies` /
   `loadStoryFamilyTargets`; `page.tsx` pills ~195–212. Note the Unit 01 server-action convention.
2. **Core test (`packages/core/test/...`, PGlite):**
   - owner CAN retarget → `story_families` becomes exactly the new set (add + remove in one call).
   - **non-owner REJECTED** → `retargetStoryFamilies` throws `InvariantViolation`, `story_families`
     unchanged.
   - non-account `ctx` (magic-link/session) REJECTED.
   - **invalid family REJECTED** → a family the owner isn't active in throws (delegated to
     `replaceStoryFamilyTargetsTx`); state unchanged.
   - **empty set CLEARS** → `familyIds: []` leaves zero `story_families` rows; story `state`
     stays `shared`, `audienceTier` unchanged.
   - **consent:** a scope-changing retarget appends exactly one `consent_records` row
     (`action` = chosen value, `storyId` set, `approvalAudioMediaId` null); a no-op retarget
     appends none. Ledger append-only trigger still holds (no UPDATE/DELETE).
3. **Implement** `retargetStoryFamilies` in `story-repository.ts`; export from `core/src/index.ts`.
4. **Web action test (`apps/web/__tests__/...`):** the server action re-reads `getRuntime()` +
   `getCurrentAuthContext()`, ignores any client-supplied personId, calls `retargetStoryFamilies`,
   and `revalidatePath`s the detail (and hub) paths. Assert a non-owner ctx is rejected before any
   write. Mirror the idiom in `apps/web/app/hub/answer/[askId]/actions.ts`.
5. **Implement** the server action (`actions.ts` colocated with the route) + the "Manage sharing"
   menu item + picker dialog (in-DOM, no native dialog), pre-seeded per "UI seeding" above.
6. **Regression test (project rule):** the non-owner-rejected core test AND the empty-set-clears
   test are the regression guards for the two footguns (missing actor gate; accidental un-share).
   Keep both. Add a component/action test asserting the menu item is absent for non-`family`-tier
   stories if that hiding rule is implemented.
7. **Green:** `pnpm --filter @chronicle/core test`, `pnpm --filter @chronicle/web typecheck test
   lint`, then `pnpm -r typecheck`.

## Done when

- [ ] `retargetStoryFamilies(db, ctx, {storyId, familyIds})` exists in `story-repository.ts`,
      exported from `core/src/index.ts`, asserts account-owner, reuses `replaceStoryFamilyTargetsTx`
      atomically, and (unless no-op) appends one consent row.
- [ ] Core tests: owner-retargets / non-owner-rejected / non-account-rejected / invalid-family-rejected
      / empty-clears / consent-append + no-op-no-append — all green.
- [ ] Server action re-derives auth server-side, never trusts client personId, revalidates.
- [ ] Owner sees "Manage sharing" (family-tier stories only) → picker pre-checked to current targets
      → save updates the pills. Non-owner sees nothing.
- [ ] No browser-native dialog. Consent-naming + no-op open decisions resolved or explicitly logged.
- [ ] `pnpm --filter @chronicle/core test` and `pnpm --filter @chronicle/web typecheck test lint`
      and `pnpm -r typecheck` green.

## Shell fallback

If Unit 01 has not landed, this unit still ships the core wrapper + server action + tests (the
load-bearing authz). Wire a temporary owner-only inline "Manage sharing" button in the detail
header behind the same `isOwner` computation Unit 01 specifies (`ctx.kind === "account" &&
ctx.personId === story.ownerPersonId`), and migrate it into `OwnerActionMenu` when Unit 01 merges.
Do not block the core work on the menu shell.

## Adversarial notes

- **The unauthenticated primitive is a footgun.** `setStoryFamilyTargets` takes no `AuthContext`
  BY DESIGN — its blast radius is "bounded" (it can only ever target the OWNER's own families, so a
  missing gate can never widen visibility beyond the owner's reach), but "bounded" is not "safe": a
  missing actor check would let ANY caller re-scope ANOTHER owner's story among that owner's
  families (e.g. un-share it, or surface it into a family the owner is in but didn't want it in).
  That is a real integrity/consent violation even though it can't leak to strangers. The core
  wrapper (option a) is therefore mandatory; do not authorize only in the server action.
- **Consent must be recorded.** Changing sharing scope on an already-shared story is a
  consent-relevant act; skipping the ledger row would make the audit trail lie about who the story
  is shared with over time. Precedent: `approveAndShareStory` writes a row on the initial share.
  The one defensible skip is a true no-op (new set === current set) — otherwise, write the row.
- **Retarget-removing-a-family silently withdraws access.** A co-member who could see the story
  loses it the moment the family is removed from the target set — no notification, no tombstone.
  That is the correct default (owner controls their own sharing), but it is invisible to the person
  who lost access AND to the owner (the pill just disappears). Surface at least an owner-facing
  confirmation ("This will remove <family> — members there will no longer see this story") in the
  in-DOM dialog. Whether to notify affected members is out of scope here; flag it as a follow-up.
- **Do not touch `audienceTier` or `state`.** This unit only edits `story_families`. Re-tiering
  (family↔public↔private) and un-sharing-as-state-change are separate concerns; conflating them
  reintroduces the approval-defaulter's empty-set ambiguity that ~653–658 warns about.
