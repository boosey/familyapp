# Account panel redesign — build spec

**Date:** 2026-07-23
**Branch:** `feat/account-panel` (based on `origin/master` @ `e5766f1`)
**Decision record:** ADR-0029 · **Glossary:** CONTEXT.md §§ Account, Profile, Appearance, App preference,
Contact visibility, Narrator memory (+ management), Follow-up opt-out
**Issues folded:** #331, #351, #357 (UI+contract) · **Parked separately:** #328

## Goal

One signed-in surface — **`/hub/account/[section]`** — where a Person manages everything about
themselves and their use of the app. Left rail on wide viewports; section drill-down on narrow. The
avatar dropdown collapses to a single **Account** launcher (+ Log out + dev Switch-user).

## Information architecture

| Section | Scope | Contents | Source today |
|---|---|---|---|
| **Profile** | account | display/spoken name, DOB, sex, read-only email, biographical anchors | relocate `/hub/profile` |
| **Appearance** | **device** | text size, palette, Look & feel, reduce motion, gesture | relocate `/hub/settings` app-prefs (ADR-0020) |
| **Narration** | account | follow-up opt-out (#351), Ask-suggestion on/off | new |
| **Privacy** | account | hide email / hide phone (#331) | new |
| **Notifications** | account | 3 streams × frequency | `notificationStreamPrefs` (relocate) |
| **Memories** | account | narrator-memory CRUD (#357) | new UI; anchors day-1, store fast-follow |
| **Families** | account | memberships, per-viewer short-name override, leave/pause, steward *Family settings* links-out, Create, Find | consolidate from avatar menu |

Danger footer: **Log out** · **Erase account** (`eraseAccount()`, ADR-0016).

## Routing

- New route `app/hub/account/[section]/page.tsx` (or a single `account/` page that switches on a
  `?section=` / segment). Section slugs: `profile`, `appearance`, `narration`, `privacy`,
  `notifications`, `memories`, `families`.
- **Redirects:** `/hub/profile` → `/hub/account/profile`; `/hub/settings` → `/hub/account/appearance`
  (or an account landing). Preserve deep links.
- `/families/{id}/edit` unchanged — Families section links out to it.
- Left rail is a shared layout around the section panels; on narrow viewports the rail becomes a
  section list and each section is a pushed panel with a back affordance (ADR-0024/0025 — verify at
  360/393, no vertical bloat, à la the HubTabs lesson).

## Avatar menu change

Edit `app/_kindred/load-account-menu.ts`: replace the `profile` / `settings` / `familyEditItems` /
`create-family` / `find-family` rows with a single `{ key: "account", href: "/hub/account" }`. Keep
`switch-user` (dev) and `log-out`. The family/steward/create/find logic moves into the **Families**
section loader.

## Data model (account-level additions)

All additive against `packages/db/src/schema.ts`.

- **#331 Contact visibility** — two booleans on the Person/Account (e.g. `persons.hideEmail`,
  `persons.hidePhone`, default false). Enforced at every co-member-facing contact read and at
  invite-modal prefill (`lib/person-invite-targets.ts` / wherever contacts resolve). **Not** read by the
  notification delivery path.
- **#351 Follow-up opt-out** — one boolean, per-account (e.g. `persons.followUpsOptOut`, default false =
  ON). Read at the **top** of the follow-up cascade (`packages/interviewer/src/follow-up-cascade.ts`),
  short-circuiting before probes/LLM, writing an audited disposition to the Follow-up decision record.
- **#357 Narrator memory** — new **append-only** table `narrator_memory`:
  `id, personId, title, summary, tags[], origin('extracted'|'user'), sourceStoryId?, confidence?,
  status('active'|'superseded'|'dismissed'), supersededBy?, createdAt`. Interviewer reads `active` via
  the existing `listNarratorMemoryForInterviewer` seam. **Store + extraction write-path are a
  fast-follow** (separate issue) — the CRUD UI ships against this contract, managing biographical
  anchors until the store lands.

## Per-issue semantics (locked)

- **#331:** two independent booleans; account-level/coarse (all families); hidden from all co-members
  incl. Steward; delivery unaffected; no prefill of hidden channels; default visible.
- **#351:** per-account; top-of-cascade short-circuit (no eval, no ask, audited); extraction untouched;
  default ON.
- **#357:** design CRUD + record contract now (append-only supersession; `extracted`|`user` origin;
  source-story provenance surfaced; user-authored allowed & extraction-proof); store/extraction as
  fast-follow (new issue).

## Sequencing

1. Route scaffold + rail/drill-down layout + old-route redirects.
2. Relocate **Profile** and **Appearance** (move existing components, no behaviour change) — verify
   parity + mobile.
3. Consolidate **Families** section + collapse avatar menu.
4. Relocate **Notifications**.
5. **Privacy** (#331): schema boolean(s) + enforcement + prefill respect + regression test.
6. **Narration** (#351): schema boolean + cascade short-circuit + audited disposition + regression test.
7. **Memories** (#357): CRUD UI against the memory contract (anchors-backed day-1).
8. Fast-follow issue: narrator-memory store + extraction write-path (respect post-approval /
   intake-at-save consent gating).

Each behaviour change (5, 6) gets a companion **regression test** (owner rule: regression test after a
bug/behaviour fix; cascade tests seed full fixtures).

## Out of scope

- **#328** person-details panel redesign + Scrapbook re-skin — separate session.
- Family **governance** consolidation — stays on the per-family surface.
- The broader narrator-memory **store/extraction** — fast-follow issue.

## Verification

`pnpm -r test` after shared-component changes (avatar menu / layout touch shared surfaces). Manual
verify at 360 + 393 widths, multi-family account (owner's mobile-verify rule).
