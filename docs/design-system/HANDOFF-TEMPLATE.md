# Flow Handoff Template

Copy this file to `<flow-name>/README.md` for every new flow you design, and fill every
section. This document — not the `.dc.html` prototype, not a screenshot — is the
contract Claude Code builds from. A screen built from this is faithful by construction
because every decision is pinned to a *named* artifact (a route, a component, a prop, a
token). A screen built from pixels is improvised.

Model answer to copy the rigor of: `intergenerational-story-design-system/project/design_handoff_onboarding_flow/README.md`.

---

## 0. Identity (the labels that connect design → code)

- **Flow name:** <kebab-case, e.g. `first-time-login`>
- **App route(s):** the real Next.js path(s) this becomes, e.g. `apps/web/app/(auth)/sign-in/page.tsx`.
  Every screen below MUST name the route file it lands in. This is the load-bearing link.
- **Design source of truth:** the `.dc.html` prototype file in this folder. List it. Note that
  `.dc.html` is a preview format — **do not import it into the app**; re-implement using real components.

## 1. Scope fence

- **In scope:** <what this flow covers>
- **Explicitly NOT in scope:** <adjacent flows that look related but are separate work>

## 2. Flow at a glance (the state machine)

Draw the states and transitions as a diagram. Name each state — these names should appear in
the implementation (route segments, a state enum, etc.).

```
[entry] → state-a → state-b → (state-c | state-d → state-e) → [exit]
```

**Design principles driving it** (carry these forward if the flow is changed):
- <principle 1>
- <principle 2>

## 3. Screen-by-screen spec

Repeat this block per screen. Be exact — copy text verbatim, name every interactive element.

### Screen N — <name>  →  *route: `apps/web/app/.../page.tsx`*
- **Headline (font-story):** "<exact copy, with {placeholders} for dynamic data>"
- **Body / sub:** "<exact copy>"
- **Elements:** for each control, name the **real component + the props**:
  - `KindredVoiceButton` — `listening` (bool), `label`, `onClick`. Paired with typed fallback.
  - `KindredButton variant="primary" size="large"` → "<button text>" → goes to Screen N+1.
- **Gating:** what must be true to advance (e.g. "primary disabled until all fields set").
- **Empty / error / loading states:** describe each, don't leave them implied.

## 4. Components used (the API contract)

Reuse these REAL app components — do not rebuild them. **Source of truth: `apps/web/app/_kindred/`**
(NOT the loose design-system `.jsx` reference files — those can lag the real prop APIs).
For each, list the exact current props you rely on:

- `KindredVoiceButton` — `listening`, `saving`, `disabled`, `label`, `size`, `onClick`.
- `KindredButton` — `variant`, `size`, `disabled`, ...
- <others>

### Tokens
Pull from `apps/web/app/_kindred/tokens.css` (the single source of truth, ported from the
canonical `_ds` export). **Never hardcode hex.** Key tokens this flow uses:
- Color: `--accent`, `--accent-strong`, `--accent-soft`, `--surface-page`, `--surface-card`, `--text-body`, `--text-muted`, ...
- Type: `--font-story` (serif, stories/headlines), `--font-ui` (interface), `--font-mono` (years/metadata).
- Sizing/motion: `--touch-voice` (96), `--touch-default` (64), `--space-*`, `--ease-quiet`, `--dur-settle`.

## 5. State & data

- **Inputs** (from auth / invite / prior flow): name each.
- **Persisted by this flow:** name each field, mark required vs optional, note what gates progression.
- **State machine reference:** point at the logic in the prototype if it has a reference implementation.

## 6. Stubs & open follow-ups

- **Stubbed in the prototype, needs real wiring:** voice → real STT, mock data → real APIs, etc.
- **Designed-but-deferred / not yet designed:** list so nobody assumes it exists.

---

## How to build from this (the workflow)

1. In the Claude Code session, invoke the `kindred-design` skill first — it loads brand rules,
   token names, and the elder-first sizing floors before any code is written.
2. Point the session at this README.
3. Build the named route(s), composing from `apps/web/app/_kindred/`.
4. **Verify visually:** screenshot the built route and diff it against the `.dc.html` reference.
   "Looks right" is not the bar — adjacent-to-the-reference is.
