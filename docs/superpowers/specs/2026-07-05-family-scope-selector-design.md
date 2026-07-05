# Family Scope Selector — Create/Join Any Time, Multi‑Family Hub

**Status:** Design (approved in brainstorm 2026‑07‑05)
**Related:** ADR‑0001 (family discovery & join requests), ADR‑0010 (`story_families` targeting), `docs/superpowers/specs/2026-07-02-signup-onboarding-and-clerk-theming-design.md`

## Problem

Creating a family and requesting to join a family are currently **one‑time onboarding stops**, not repeatable actions. The router (`resolvePostAuthRoute()`) sends a user to `/families/start` only when they have *no* membership and *no* pending request; once they're in a family, that fork is unreachable and there is no in‑app entry point back to it.

The product intent: **creating a family and asking to join a family are always available**, for any authenticated user, at any time, regardless of how many families they already belong to. A person should be able to:

- On first login (no invite): create a family or find one to join. *(existing screen — unchanged)*
- While waiting on a join decision: still create a family.
- After being accepted into a family: create another family, or ask to join another.

This also reopens the deliberately‑deferred **multi‑family UX**: once you can belong to several families, the hub needs a way to view them together or one at a time.

## What already exists (reused, not rebuilt)

- **Data model:** `families`, `memberships` (role + status enums `active|paused|ended`), `invitations` (`pending|accepted|revoked|expired`), `joinRequests` (`pending|approved|declined`). A Person may hold **many** active memberships and pending requests at once — the schema already allows everything below.
- **Flows:** `createFamily` (`/families/new`), discovery + `createJoinRequest` (`/families/find`), steward approve/decline (hub Requests tab), member invite send (hub Invite tab) + accept (`/join/[token]`).
- **Routing brain:** `apps/web/lib/post-auth-route.ts` `resolvePostAuthRoute()`.
- **Hub shell:** tabbed hub (`stories|album|questions|ask|asks|invite|requests`), an account avatar menu (`KindredAccountMenu`), and a **stubbed family‑crest slot** in the header (`hub/page.tsx:221-240`) — the intended home for the selector.
- **Multi‑family content model:** `story_families` (ADR‑0010) and `family_photo_families` are already M2M.

## Core decisions

1. **A scope selector `[ All ▾ ]` owns everything "family."** The avatar menu stays purely account‑level (Profile / Settings / Log out). The stub "Manage family" avatar item is removed.
2. **`All` is the default, merged view** (today's behavior). Each family narrows the hub to that family. Selecting a scope is additive, not a rebuild of the merged view.
3. **Create / Find live at the bottom of the selector**, for every user in every non‑zero state — the single, permanent home that replaces the one‑time `/families/start` fork *for people already in the app*.
4. **Cold‑start is unchanged.** A first login with no membership and no pending request still gets `/families/start`.
5. **Every hub tab honors the selected scope** (full multi‑family filtering — "option A").
6. **Content is N‑family; relationship acts are single‑family.** Stories, album photos, and (new) asks can be tagged to one‑or‑more families; scoping is a membership test against that tag set. Invitations, join requests, and memberships stay single‑family.

---

## Section 1 — The scope selector control

**Placement.** Takes over the stubbed family‑crest slot in the hub header, left‑aligned:
`[ scope selector ]  …tabs…  [ avatar ]`.

**Open state:**
```
┌─────────────────────────────┐
│ ✓ All                       │  ← default; deduped merged view
│   The Boudreaux Family      │  ← scope row (clickable)
│   Grandma's Line            │
│ ─────────────────────────── │
│   Riverside Clan — Pending ⏳│  ← muted; not a scope; opens status/withdraw
│ ─────────────────────────── │
│ ＋ Create a family          │  → /families/new
│ 🔍 Find a family to join    │  → /families/find
└─────────────────────────────┘
```

- **Closed state** shows the current scope: `[ All ▾ ]`, `[ The Boudreaux Family ▾ ]`, or `[ No family yet ▾ ]` for a pending‑only user.
- **Two row types:** *scopes* (All + each active family — clickable, set the scope) and *pending* (muted, open a small status/withdraw view, never become a scope).
- **Actions** are pinned at the bottom in every non‑zero state.
- **Avatar menu** keeps Profile / Settings / Log out only; no family items.

---

## Section 2 — Routing

`resolvePostAuthRoute()` collapses the pending and member cases into the hub.

| Gate | Condition | Destination |
|---|---|---|
| A | zero relationship (no active membership **and** no pending request) | `/families/start` *(unchanged — cold start)* |
| B | has intent but `onboardedAt == null` | `/welcome` *(unchanged — DOB capture)* |
| ~~C~~ | ~~onboarded but awaiting approval~~ | **deleted** → falls through to `/hub` |
| — | else (member **or** pending‑only, onboarded) | `/hub` |

- The `/hub` guard (`hub/page.tsx:65-75`) is relaxed to admit anyone past cold‑start (member **or** pending‑only), not just active members.
- `/families/start`, `/families/new`, `/families/find`, `/welcome`, `/join/[token]` all keep working unchanged. `/families/find` simply stops being an auto‑park destination and becomes a place you navigate to from the selector; its "your requests" list mirrors into the selector's pending rows.

---

## Section 3 — Per‑tab scope semantics

**Governing pattern:** *reads take a **deduped** union in `All` and filter to one family when scoped; writes/steward acts are single‑family and resolve a target.*

**Read tabs** — an item tagged to N families appears **once** in `All` (deduped by id) and appears in **each** of its families' scoped views (scoping is a membership test against the tag set):

| Tab | In `All` | Scoped to Family X |
|---|---|---|
| Stories | all stories across your families, deduped | stories whose `story_families` includes X |
| Album | all family photos, deduped | photos where `family_photo_families` includes X |
| Asks (list) | all your asks, deduped | asks whose `ask_families` includes X *(new join table)* |
| Questions | unchanged (question bank is family‑agnostic) | unchanged |

**Write / steward tabs** — single‑family by nature:

| Tab | In `All` | Scoped to Family X |
|---|---|---|
| Tell a story (compose) | 1 family → auto‑target; >1 → multi‑select target step, then compose | X pre‑checked; still multi‑targetable (ADR‑0010) |
| Ask (compose) | 1 → auto; >1 → multi‑select target step, then compose | X pre‑checked; multi‑target via `ask_families` |
| Invite | 1 → invite into it; >1 → pick which **one** family; hidden if member of none | invite into X (requires active membership in X) |
| Requests (steward queue) | **aggregate**: pending requests across every family you steward, each row labeled with its family | X's pending requests only |

**Create‑targeting rule (stated once):** reads union (deduped) in `All`; **content writes accept one‑or‑more families** — the family set is auto‑resolved when you have exactly one family (or you're scoped), and an explicit **multi‑select** family step when you're in `All` with several. This reuses the ADR‑0010 multi‑target picker rather than inventing a new one. Scope only seeds the default selection.

**Pending‑only user's hub:** `All` renders an empty state ("Nothing here yet — you'll see stories once you're part of a family"). Stories / Album / Asks / Questions render empty. **Invite and Requests tabs are hidden** (not a member/steward of anything). The only live surfaces are the selector's pending row and the `+ Create` / `+ Find` actions — the waiting room, inside the hub.

**Two implementation calls:**
1. **Scope lives in the URL** (`?scope=all|<familyId>`), defaulting to `all`, so a scoped view is linkable and refresh‑safe and server components can read it to filter their queries.
2. **Steward "Requests" in `All` aggregates** (labeled per family) rather than hiding — a multi‑family steward shouldn't have to switch scopes to notice a pending request elsewhere.

---

## Section 4 — Data model change: asks become N‑family

Today `asks.familyId` is a single FK; an ask belongs to exactly one family. To make asks content‑like (N‑family), mirror the `story_families` pattern.

- **New join table `ask_families`** (`ask_id`, `family_id`, timestamps; unique on the pair), modeled in `packages/db/src/schema.ts` alongside `story_families` / `family_photo_families`.
- **Retire `asks.familyId`.**
- **Migration `NNNN_ask_families`** in the drizzle chain — additive and reversible in one direction:
  1. create `ask_families`,
  2. backfill one row per existing ask from its current `familyId`,
  3. drop `asks.familyId`.
  Applies to Neon at deploy like `0001`/`0002`; regenerate the snapshot (`schema.sql` + `invariants.sql`) so the drift‑guard test stays green.
- **Reader sweep** — every `asks.familyId` reader moves to the join table: the Ask compose path (`/hub/ask`), the Asks list tab, the `/a/[token]/[askId]` relay, and any authorization/query that keys on an ask's family. Add `ask_families` writes wherever asks are created, taking a family **set**.

**Boundary (unchanged, single‑family):** `invitations.familyId`, `joinRequests.familyId`, and `memberships.familyId` stay single‑FK. These are relationship acts, not content.

---

## Section 5 — Scope plumbing

- **Source of truth:** `?scope` query param (`all` default). A small helper resolves it to either the merged set (all of the person's active family ids) or a single validated family id (must be one the person actively belongs to — otherwise fall back to `all`, never leak).
- **Reads:** server components pass the resolved family‑id set into the existing repository queries as an `IN (...)` / join filter, with de‑duplication by item id for the union case.
- **Writes:** compose flows seed their family multi‑select from the current scope; the authoritative target set is whatever the user confirms in the compose step, not the scope itself.
- **Selector data:** the person's active memberships (families = scope rows) + their pending join requests (pending rows), both already available via `listActiveMembershipsForPerson` and `listJoinRequestsByRequester`.

---

## Section 6 — Testing

- **Router:** `resolvePostAuthRoute` — pending‑only onboarded user now → `/hub` (was `/families/find`); zero‑relationship → `/families/start`; member → `/hub`. Regression test for the deleted Gate C.
- **Scope filtering:** a story/photo/ask tagged to two families appears **once** in `All` and in **both** scoped views; an item in only Family A does not appear when scoped to Family B.
- **Create‑targeting:** compose in `All` with one family auto‑targets; with several requires a selection; scoped compose pre‑checks the scope and still allows adding families.
- **Pending‑only hub:** empty read tabs, hidden Invite/Requests, visible pending row + Create/Find.
- **`ask_families` migration:** drift‑guard test (snapshot vs. chain) stays green; backfill produces exactly one `ask_families` row per pre‑existing ask; a companion regression test for the retired `familyId` reader paths.
- **Leak‑safety:** `?scope=<familyId>` for a family the person is *not* an active member of falls back to `all` and never returns that family's content.

## Out of scope

- Profile / Settings pages (avatar‑menu stubs stay stubs; only "Manage family" is removed).
- Steward console / membership management (edit roles, pause/end, transfer stewardship, edit family name/description/discoverability).
- Real LLM family search (the deterministic keyword impl stays).
- Family crest/avatar imagery (letter placeholder remains inside the selector's closed state).
