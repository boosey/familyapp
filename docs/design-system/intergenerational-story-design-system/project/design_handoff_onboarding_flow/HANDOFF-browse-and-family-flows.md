# Handoff: Story Browse (Hub) + Account & Family Flows

## Overview
Two hi-fi interactive prototypes that extend Family Chronicle / Kindred:

1. **`Story Browse (Hub).dc.html`** — the member hub's story-**browsing** grown into a full read experience: a Feed, a Timeline, and Chronicle Search as three modes of *one* surface, a Read + Listen view, a reusable family-scope filter, and a font-scale (accessibility) control. Wired into the full hub tab bar (Stories / To answer / Ask / Invite).
2. **`Account & Family Flows.dc.html`** — the account and family-membership flows that run after sign-on: sign up / sign in, start a new family (steward), find & request to join a discoverable family, the steward's requests-approval screen, and invite-someone-new.

Both are grounded in the merged `feat/onboarding-and-family-flows` build of `github.com/boosey/familyapp` (routes: `/sign-up`, `/sign-in`, `/welcome`, `/families/start`, `/families/new`, `/families/find`, `/join/[token]`, `/hub`, `/hub/tabs/*`) and the product glossary in that repo's `CONTEXT.md`.

## About the Design Files
The files in this bundle are **design references authored in HTML** (as self-contained "Design Component" `.dc.html` previews) — they demonstrate intended layout, copy, and behavior. **They are not production code to copy.** Recreate these screens in the target codebase (the `familyapp` Next.js/React app) using its existing components, routing, and the real Kindred design-system package — do not import the `.dc.html` files. Open any `.dc.html` in a browser to view it; use the bottom "JUMP TO" / "preview state" strips to walk every state.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, component usage, and interaction/state logic. Recreate pixel-faithfully using the codebase's Kindred components and tokens. All values below are the design-system tokens — bind to those, don't hardcode hex.

---

## Design Tokens (Kindred — `:root` = Heirloom theme)

**Colors (semantic aliases — use these, not raw hex):**
- `--surface-page` #F4ECE0 · `--surface-card` #FBF6EE · `--surface-sunken` #EAE0D0
- `--text-body` #2E2620 · `--text-meta` #4A3F35 · `--text-muted` #6B5F54
- `--accent` #BD5B3D · `--accent-strong` #A24A2F · `--accent-soft` #F3DACE · `--accent-on` #FFFFFF
- `--support` #7C8B6F · `--support-soft` #DEE4D6
- `--border` #E2D6C5 · `--border-strong` #D6C7B2 · `--focus-ring` #BD5B3D
- Shadows: `--shadow-sm` `0 1px 2px rgba(70,50,30,.08)` · `--shadow-card` `0 2px 10px rgba(70,50,30,.10)` · `--shadow-lift` `0 8px 28px rgba(70,50,30,.16)`
- Themes `data-theme="archive"` (cool) and `data-theme="hearth"` (soft) re-skin any subtree; all components read tokens so they follow.

**Type families:** `--font-story` = Newsreader (serif — titles, prose, prompts) · `--font-ui` = Public Sans (interface/body) · `--font-mono` = DM Mono (years, places, metadata labels only).

**Type scale:** UI floor 18px, story floor 22px, buttons 24px, display titles 44px, hero 56px. Line-heights: tight 1.15, snug 1.3, body 1.55, loose 1.7 (long-form reading). Mono labels use letter-spacing ~0.04–0.1em, uppercase, sparingly.

**Shape & touch:** radii — controls/inputs 8–12px, cards 14–18px, pills/buttons 999px. Touch targets ≥44px, default 64px. Borders 1.5px, warm-toned. Motion is quiet: fades only (~0.15s), the sole ambient animation is the voice "listening" pulse — no slides/bounces.

---

# Prototype 1 — Story Browse (Hub)

Single member surface. Every family member signs into the same hub; asking, answering, and reading are **actions**, not user types. Accessibility is built in for everyone (large type, calm density, audio-first) — not a separate "senior mode."

## Global chrome (persists on every tab)
- **Header** (`--surface-card`, 1.5px bottom border, 20px 34px padding): left — "Family Chronicle" wordmark (Newsreader 26px) + mono context label ("SOFIA'S HUB"). Right — **font-scale control** + **account avatar** (44px circle, `--accent` bg, initials "SC").
- **Font-scale control**: segmented group of three "Aa" buttons (S / M / L) in a `--surface-sunken` rounded container. Sets a global scale level 0/1/2 that multiplies content type sizes. Active button = `--surface-card` bg + `--accent-strong` text + `--shadow-sm`.
  - Size presets (px) per level `[default, large, largest]`: card title `[26,30,34]`, body `[18,20,22]`, summary `[17,19,21]`, meta/mono `[13,14,15]`, tag `[14,15,16]`, hero title `[44,50,56]`, hero/prose body `[22,25,28]`. **Every screen must remain correct at all three levels.**
- **Hub tab bar** (below header): Stories · To answer (with count badge) · Ask · Invite. Active tab = `--accent-soft` pill + `--accent-strong`. Badge = `--accent` filled circle, mono, `--accent-on`.

## Screens / Views

### Stories tab — browse sub-nav
Shown only on the Stories tab. Two segmented controls on one row:
- **Mode**: Feed · Timeline · Search (left).
- **Family scope**: All families · Boudreaux · Carney (right) — reusable filter that applies across Feed, Timeline, and Search. "All families" default; a member may belong to several families and filter to one. Active scope = `--accent-soft` + `--accent-strong`.

### Feed (default)
Reverse-chronological stream of story cards the member may see.
- **Card** (`--surface-card`, 1.5px `--border`, radius 18px, `--shadow-card`, 22px padding, flex row, 22px gap; whole card is a button → opens Read view):
  - Left: 120×120 photo, radius 14px — **striped placeholder** `repeating-linear-gradient(135deg, #DCCFB6 0 12px, #E4D8C2 12px 24px)` until a real `<img object-fit:cover>` exists.
  - Body: narrator row (30px initials circle `--accent-soft`/`--accent-strong` + narrator name in `--font-ui` `--text-meta` + `·` dot + `--font-mono` era·place in `--support`); title (Newsreader 500, scaled title size, `--text-body`); summary (`--font-ui`, scaled summary size, `--text-muted`, max 60ch); tag row.
  - **Tag row**: content-tag pills (outline: 1.5px `--border-strong`, `--text-muted`, radius 999px) + family-tag pills (`--font-mono` uppercase, `--accent-strong` on `--accent-soft`) + right-aligned mono duration "▶ 4:12".
  - **New badge** (unread, per viewer): top-right, `--accent` 7px dot + mono "NEW" in `--accent-strong`.
- **Empty state** (member's families haven't shared anything): centered card, 📖, serif line "Nothing shared with you yet in {scope}.", muted explanatory line.
- **Loading state**: 3 skeleton cards (neutral `--surface-sunken` blocks; no animation).

### Timeline
Same visible stories arranged by the era they're **about** (not when recorded).
- Heading (serif) + a segmented toggle: **"Eleanor's life"** (default — one narrator) vs **"Whole family"** (widen). Respects the family-scope filter.
- **Decade groups** (`1950s`…`2000s`): mono uppercase decade label + hairline rule; each story is a compact row button (mono year, 70px col · serif title · narrator · mono "▶ dur").
- **"Undated" section**: always shown, never hidden. Mono "Undated" label; rows use `--surface-sunken` bg + 1.5px **dashed** `--border-strong` and "· · ·" in place of a year.

### Chronicle Search
Keyword search within stories the member may see (title, summary, prose, transcript, place, tags).
- Text input (`--surface-card`, 1.5px `--border-strong`, radius 12px).
- **Idle**: helper line "Search across everything shared with you…".
- **Results**: mono count label ("N stories match") + result cards (serif title + mono era; snippet line with the **matched substring highlighted** — `--accent-soft` bg, `--accent-strong`, 600 weight, radius 3px). Clicking a result opens Read view.
- **No-results**: centered card, 🔎, "No stories match "{query}"", muted retry hint.

### Read + Listen view
Opening any card (replaces the Stories content; hub tabs stay).
- "‹ Back" link (`--accent-strong`).
- Narrator attribution row (44px initials circle + "Told by {name}" + mono era·place).
- Title (Newsreader 400, hero-title size, line-height 1.15).
- Tag row (content + family pills, as in Feed).
- **Listen bar** = the Kindred `KindredListenBar` component (title + duration + scrubber + restart/‑10/play/+10 controls; play glyph ▶/❚❚). This is the extended Kindred listen bar — reuse it.
- **Prose ↔ Transcript** segmented toggle ("Story" / "Transcript").
  - Prose: Newsreader 400, hero-body size, line-height 1.65, `text-wrap:pretty` — the reading hero.
  - Transcript: DM Mono, body size, line-height 1.7 (raw, lightly-punctuated verbatim).

## Interactions & Behavior
- Mode tabs / scope filter / font-scale / hub tabs are instant state switches (quiet, no transitions beyond token fades).
- Card or search-result click → Read view (remembers prior mode for Back).
- Search filters live on input; highlight is computed against the summary.
- Timeline widen toggle swaps narrator-scoped vs family-scoped grouping.
- **Prototype-only harness** (bottom strip, Stories/Feed only): Normal / Empty feed / Loading buttons force those feed states for review — *not* a production control.

## State (Story Browse)
`hubTab` (stories|answer|ask|invite) · `mode` (feed|timeline|search|read) · `prevMode` · `scope` (all|boudreaux|carney) · `fontScale` (0|1|2) · `selectedId` (open story) · `readTab` (prose|transcript) · `widen` (bool) · `query` (string) · `demoState` (normal|empty|loading, demo-only) · `askSent` / `inviteDone` (other-tab forms).

## Data model — each Story carries
`narrator` (name + optional avatar/initials), `title`, `summary` (1–2 sentences), `prose` (rendered readable body), `transcript` (raw), canonical `audio` + `duration`, `era` (year, **nullable → Undated**), `place` label, content `tags[]`, `families[]` (a story can belong to more than one — e.g. Boudreaux **and** Carney), and a per-viewer **unread/"New"** flag. Feed order is reverse-chronological by *shared/recorded* time; Timeline order is by *era*.

---

# Prototype 2 — Account & Family Flows

Runs after sign-on. Privacy-first: families are **private by default**; discovery is opt-in and every join is **steward-approved**. Symmetric roles — one kind of user; "steward/narrator/member" are DB roles, not personas.

## Screens / Views

1. **Sign up** — centered 520px card: wordmark, email + password inputs, primary full-width "Create account", "Sign in" link. → Families / start.
2. **Sign in** — mirror of sign up (seeded creds shown), primary "Sign in". → hub (returning users skip onboarding).
3. **Families / start** (two doors) — "Start a new family" (`--accent-soft` card, → steward flow) vs "Find my family" (paper card, → discovery). Large tappable cards, 20px radius.
4. **Families / new (steward)** — "Name your family" + centered text input + primary "Create family" (disabled until non-empty). Creator becomes the family's first **steward**. → hub (with requests to approve).
5. **Families / find** — search + list (the chosen direction). Copy: search by family name, steward, or a member's name; only **discoverable** families appear; finding never joins — it sends a **request the steward approves**. Input + a "Discoverable families" browse list by default; typing filters. Each result: initials circle + family name (serif) + "Steward: {name}" + secondary "Request to join". No-match state inline. (Search returns **family name + steward name only** — never members or stories; member names are a matching signal only.)
6. **Request sent** — confirmation: ✉️, "Your request is with {steward}.", reassurance you'll land in the family's hub on approval.
7. **Steward: requests** — "Requests to join — {family}". Each request row: initials + requester name + note; **Decline** (ghost) / **Approve** (primary) while pending; resolves to a mono "APPROVED"/"DECLINED" status. Nothing is shared with a requester until approved.
8. **Invite someone new** — name + relationship inputs, primary "Create link" → generates a **one-time** `/join/<token>` link (mono, in a sunken field) + Copy button; explanatory line (they set a password and land in onboarding). This is the entry that already flows into the existing invite-link onboarding (see `Onboarding Prototype.dc.html`).

## Interactions & Behavior
- Bottom **"JUMP TO"** strip navigates directly between all screens (prototype convenience).
- Find: live keyword filter over discoverable families; empty query shows the browse list; no match shows the retry line.
- Steward requests: Approve/Decline mutate each row's status independently.
- Invite: Create link swaps the form for the one-time-link panel.

## State (Account & Family Flows)
`screen` (signup|signin|start|new|find|requestSent|requests|invite) · `familyName` · `findQuery` · `requests[]` (id, name, note, status: pending|approved|declined) · `inviteDone`.

## Backend mapping (from the repo)
- Onboarding gate: `Person.onboardedAt`; required capture is **date of birth** (full date) — see `/welcome`.
- Discovery seam: `FamilySearch` interface (deterministic keyword impl now, LLM later); families need `discoverable = true`. Join = **join request** the steward approves (never seized). See `docs/adr/0001-family-discovery-and-join-requests.md`.
- Invite → `/join/[token]`; magic link is a passwordless account login (ADR-0003). Auth is mocked in the repo (`mock_auth_users`) but the `Account` row stays provider-id-only, so real Clerk swaps in unchanged.

---

## Components used (Kindred Design System — reuse, don't rebuild)
- **KindredButton** — `variant` primary/secondary/ghost; `size` small 44px / default 64px / large 76px; `disabled`, `leadingIcon`, `fullWidth`.
- **KindredListenBar** — the audio player in the Read view (scrubber + transport + duration).
- **KindredStoryCard / KindredChip / KindredVoiceButton / KindredPromptCard** — available in the package; the feed/read cards here are an *extension* of the story-card visual language (they add tags, family pills, New badge, and Listen/Read affordances), so implement them from the card's tokens rather than forcing the base component.
- Font-scale control, family-scope filter, and the browse mode/timeline/read sub-UI are **new** to this work — build them in the app using the tokens above.

## Assets
No bespoke icons ship with Kindred — affordances use Unicode glyphs (▶ ❚❚ 📍 🎙 ⌨ 🔎 📖 ✉️) and CSS shapes. Photos are real family images in production; here they're the 135° striped placeholder. Fonts load from Google Fonts (Newsreader, Public Sans, DM Mono) — swap to licensed binaries when available.

## Files in this bundle
- `Story Browse (Hub).dc.html` — prototype 1 (source of truth for the browse + read experience).
- `Account & Family Flows.dc.html` — prototype 2 (source of truth for account/family flows).
- `Onboarding Prototype.dc.html` — the earlier invite-link onboarding (welcome → DOB → two doors → interview → hub); the invite flow above feeds into it.
- `Onboarding — Hybrid Flow (wireframe).dc.html`, `Onboarding Flow Explorations (wireframe).dc.html` — lo-fi context for the onboarding shape.
- `README.md` — the original onboarding-flow handoff; `HANDOFF-browse-and-family-flows.md` — this document.
- The Kindred design-system package (tokens + components) lives at `_ds/kindred-design-system-495fbf7d-96e7-492a-aafc-cbbbd5477f79/` at the project root; the `.dc.html` files link it via `../_ds/…`.
