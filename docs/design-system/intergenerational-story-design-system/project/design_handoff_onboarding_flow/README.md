# Onboarding Flow — Developer Handoff

New-user onboarding for Kindred / Family Chronicle: the flow a person sees **after their first sign-on**, when they've joined via an invite link from an existing family member.

> Scope note: this is the flow for **any new joiner** (someone invited into an existing family). The very-first-person ("steward") setup — naming the family, creating the space — is a **separate flow, not built here.**

---

## 1. What's in this folder

| File | What it is | Use it for |
|---|---|---|
| `Onboarding Prototype.dc.html` | **The hi-fi interactive prototype** — the source of truth. Click through every state. | Exact layout, copy, component usage, interaction + state logic. |
| `Onboarding — Hybrid Flow (wireframe).dc.html` | Low-fi flow map of the chosen direction, with the branch/convergence drawn out and rationale stickies. | Understanding *why* the flow is shaped this way; the big picture. |
| `Onboarding Flow Explorations (wireframe).dc.html` | The 3 directions we explored before choosing. | Context only — **not** the spec. |
| `Account & Family Flows.dc.html` | **New.** Sign-up/sign-in, start-a-new-family (steward), find & request to join (2 directions: search+list, guided sentence), steward requests-approval, invite-someone-unknown. Grounded in the merged `feat/onboarding-and-family-flows` build in `boosey/familyapp`. Use the "JUMP TO" strip at the bottom to move between screens. | Exact layout, copy, states for the account/family flows added after the original invite-link onboarding. |
| `Story Browse (Hub).dc.html` | **New.** The hub's story browsing grown into a full read experience: Feed, Timeline, and Chronicle Search as three modes of one surface, plus the story Read+Listen view, a family-scope filter, and a font-scale control. Includes empty/loading/no-results/undated states. | Exact layout, copy, states, and font-scale behavior for the browse-and-read brief. |

**These are design artifacts, not production code.** They're built as "Design Components" (`.dc.html`) — a self-contained HTML preview format. Do not import the `.dc.html` files into the app. Re-implement the screens in the real codebase using the real Kindred component library (see §4). Open any `.dc.html` in a browser to view it.

---

## 2. The flow at a glance

```
[invite link] → [sign on] ─→  ONBOARDING (this work)  ─→  HUB
                                     │
        ┌─ 1. Welcome ─ 2. Birthday ─ 3. Two doors ─┤
        │  (confirm)     (required)    (the fork)    │
        │                                            ├─ Door 1 ──────────────→ HUB
        │                                            └─ Door 2 → Interview ──→ HUB
        │                                                        (just talk,
        │                                                       exit anytime)
        └──────────────────────────────────────────────────────────────────────
                          Persistent hub banner re-opens the interview, forever
```

**Design principles driving it** (keep these if you change anything):
- **One required ask: date of birth.** Everything else is pre-filled or optional. DOB is captured because it shapes the questions and pacing Kindred uses with this person later — so it's needed before the hub.
- **Fast to the hub.** A new user can reach the hub in ~3 taps (Welcome → Birthday → "Go to the hub").
- **The deep life-story interview is an invitation, never a gate.** It's offered at the fork and lives on permanently as a hub banner. It must never block entry.
- **No formal "elder / younger" roles.** That's a usage *pattern*, not a concept in the system. Everyone can ask and answer. Don't encode age-based roles.
- **Voice-first, but never voice-only.** Every voice step has a visible typed fallback ("Type instead" / manual date selectors).

---

## 3. Screen-by-screen spec

### Screen 1 — Welcome / confirm identity
- **Headline (serif):** "Rosa invited you to the Esposito family." (`{inviterName}` invited you to the `{familyName}` family.)
- **Identity card:** avatar + full name + **relationship label** + a "FROM THE INVITE" tag. Name and relationship are **pre-filled from the invite payload** — the user does not type them.
- **Editable relationship:** "✎ Change" turns the relationship label into a text input with a Save button. **Only the free-text label is editable here** (e.g. "Rosa's father" → "Rosa's dad"). Re-picking a different person / restructuring the relationship is explicitly **out of scope** for this screen — leave a hook for it later.
- **Primary action:** `KindredButton variant="primary" size="large"` → "Come in" → goes to Screen 2.

### Screen 2 — Birthday (the one required step)
- **Headline:** "Before we go in — when were you born?"
- **Sub:** explains *why* — it shapes the questions and pace Kindred uses with you.
- **Voice path:** `KindredVoiceButton` — "Say it out loud". Tapping it simulates listening (pulse) then fills the date. In production, wire to speech-to-text → parse to a full date.
- **Manual path:** Month / Day / Year `<select>`s. (Decision: **full date** — day, month, and year all required. No "month + year only" partial option, kept simple.)
- **Continue** (`primary`) is **disabled until all three fields are set.**
- On continue → Screen 3.

### Screen 3 — Two doors (the fork)
- **Headline:** "You're in, Sal. Where to first?" Sub reassures you can do the other one anytime.
- **Two large tappable cards:**
  - **Door 1 — "Go to the hub"** (terracotta/`accent-soft`, marked PRIMARY): → **Hub** directly.
  - **Door 2 — "Tell your story"** (paper/bordered, "ABOUT 12 MINUTES"): → **Interview**.

### Screen 4 — Interview ("just talk")
- One flowing conversation, **not a form.** Questions appear one at a time in large serif.
- **Question sequence** (current build): birthplace → places lived → big moments. Each is answered via `KindredVoiceButton` ("Tap to answer") with a "Type instead" ghost fallback.
- **Live "captured facts" ribbon** across the top: chips for Name ✓, Born ✓, then each interview fact filling in (● current, ✓ captured, · pending).
- **Always-visible exit ramp:** a "Take me to the hub →" button pinned top-right. The user can leave at **any** question — whatever they've answered is saved.
- After the last question → a short "That's a beautiful start" confirmation → "Take me to the hub".

### The Hub (destination — both doors land here)
- This is the **existing** Family Chronicle hub; onboarding just deposits the user here. The prototype includes a representative version so you can see the handoffs:
  - **Persistent interview banner** (terracotta, top of content) — "Your story is just beginning… Start ›". This is the **permanent nudge**: it re-opens the interview. **Decision: it stays — it does not retire** after N stories. Copy shifts subtly once they've done one interview ("There's always more to tell… Continue").
  - **"Your story so far"** — a timeline that fills with whatever the user seeded (birth year always; plus any interview facts). If they skipped the interview, it shows just the birth year with a gentle prompt.
  - **Family stories** — `KindredStoryCard`s of memories already in the family, to listen to now.

---

## 4. Components used (Kindred Design System)

Re-use these real components — **do not rebuild them.** All under `components/core/` in the design-system package; each has a `.prompt.md` and `.d.ts`.

- **`KindredButton`** — text actions. `variant`: `primary` (one per view) / `secondary` / `ghost`. `size`: `small` 44px / `default` 64px / `large` 76px (elder-first sizing). Props: `disabled`, `leadingIcon`, `fullWidth`.
- **`KindredVoiceButton`** — the one loud voice control per screen. Props: `listening` (bool, drives pulse/waveform), `label` (caption), `onClick`, `size`. Always pair with a typed fallback — never remove the typing path.
- **`KindredStoryCard`** — a saved memory: serif title, mono `year`/`place`, `excerpt`, `duration`, optional `imageSrc` (omit → striped placeholder), `pinned`, `onClick`.
- Also available, worth considering for the hub/interview: `KindredChip`, `KindredPromptCard`, `KindredListenBar`.

### Design tokens
Pull from the design-system token files — **don't hardcode hex.** Key ones used here:
- Color: `--accent` (terracotta), `--accent-strong`, `--accent-soft`, `--accent-on`, `--surface-page`, `--surface-card`, `--surface-sunken`, `--border`, `--border-strong`, `--text-body`, `--text-muted`, `--text-meta`, `--support`.
- Type: `--font-story` (Newsreader serif — headlines & story text), `--font-ui` (UI / body), `--font-mono` (metadata: years, places, labels).
- Also `--shadow-card`, `--shadow-sm`, spacing + motion tokens.

---

## 5. State & data notes for implementation

**Inputs (from invite + auth):** `inviterName`, `familyName`, `inviteeName`, `relationshipLabel` (editable free text). The prototype hardcodes Rosa → Salvatore Esposito ("Rosa's father") as sample data.

**Captured & persisted by this flow:**
- `dateOfBirth` — **required**, full date. Gate to the hub.
- `relationshipLabel` — confirmed or edited.
- Interview facts (all **optional**): `birthplace`, `placesLived[]`, `keyMoments[]` — each becomes a seeded item on the user's timeline so family have something to ask about.

**State machine** (see `renderVals()` / the logic class in the prototype for the reference implementation):
`welcome → dob → doors → (hub | interview → hub)`. The hub banner can re-enter `interview` at any later time. "Replay onboarding" in the prototype is a **demo-only** reset — not a production control.

**Things stubbed in the prototype that need real wiring:**
- Voice buttons simulate listening with a timeout + canned result → wire to real speech-to-text and date/answer parsing.
- The hub is a representative mock → integrate with the real hub; just consume the onboarding outputs (DOB + seeded facts) and render the persistent banner.
- `KindredStoryCard` photo placeholders → real `imageSrc`.

---

## 6. Open follow-ups (not yet designed)

- The "re-pick a different person" path behind the relationship label (only the label text is editable today).
- A real typed-answer branch for interview questions (the "Type instead" affordance is present but the prototype only demos the voice path).
- The separate **steward / first-person** setup flow (naming the family) — a distinct piece of work.
