# Kindred Design System

A design language for **capturing a life, one conversation at a time** — built elders-first for an intergenerational story app. Large type, a gentle pace, voice over typing, and the warmth of an heirloom rather than a database.

> **Sources.** This system was distilled from the in-project Kindred seed materials provided to this project (`uploads/readme.md`, `uploads/SKILL.md`, `uploads/styles.css`), which describe an original Kindred showcase (`Kindred Design System.dc.html`) and its component set. The original `.dc.html` showcase and any Kindred-licensed font binaries were **not** included; where noted below, the closest substitutes are used and flagged. No external Figma or GitHub source was provided.

## What Kindred is
Kindred helps families record an elder's life stories through short, spoken conversations. A family member receives a gentle prompt ("A question for Sal"), the elder taps one large microphone and simply talks, and the answer is saved as an audio story — gathered over time into a warm timeline of memories. The product is designed to feel like an heirloom: paper, serif type, and a calm pace, not a productivity app or a database.

## How it's organized
- **`styles.css`** (root) — the single entry point consumers link. It `@import`s every token + font file. Keep it as `@import` lines only.
- **`tokens/`** — `fonts.css`, `colors.css` (three themes), `typography.css`, `spacing.css`, `motion.css`.
- **`components/core/`** — six React primitives (`.jsx` + `.d.ts` + `.prompt.md`): `KindredButton`, `KindredVoiceButton`, `KindredPromptCard`, `KindredChip`, `KindredListenBar`, `KindredStoryCard`, plus `core.card.html`.
- **`ui_kits/kindred-app/`** — tablet recreations: `Conversation`, `StoryDetail`, `Timeline`, driven by an interactive `index.html`.
- **`guidelines/`** — foundation specimen cards that populate the Design System tab (Colors, Type, Spacing, Brand).
- **`SKILL.md`** (root) — Agent-Skill-compatible front door.

## Theming
`:root` is **Heirloom** (cream paper, terracotta, sage — the recommended elder palette). Wrap any subtree in `data-theme="archive"` (cool, museum) or `data-theme="hearth"` (soft, intimate) to re-skin it. All components read tokens, so they follow automatically.

---

## Content fundamentals
How Kindred writes.

- **Voice & person.** Warm, plain-spoken, and in the *second person to the family member* — "A question for Sal", "Type instead", "Save story". The elder is always spoken about with respect, never managed or processed.
- **Tone.** Like a kind grandchild, not a clinician or a coach. Never productivity-flavored ("optimize", "capture data", "complete your profile"). Prompts are short, specific, human: *"What was your mother like when you were small?"*, *"Tell me about the summer you moved to Naples."*
- **Casing.** Sentence case everywhere — buttons, titles, prompts. No ALL-CAPS shouting; the only uppercase is the small mono metadata label (`NAPLES · CHILDHOOD`), used sparingly.
- **Stories are the hero; chrome recedes.** Interface copy is minimal and quiet so the elder's words carry the screen. When in doubt, remove a sentence.
- **Metadata is mono and factual.** Years, places, durations, "Recorded May 1961" — set in DM Mono, never embellished.
- **Emoji.** Not used as decoration. A few Unicode affordances stand in for icons (▶ 📍 📷 ⌨) — see Iconography. Never an emoji in body or story copy.
- **Examples.** ✓ "Tap the circle and just start talking." ✓ "A question for Sal." ✗ "Capture your memories today!" ✗ "Profile 60% complete."

## Visual foundations
The look and feel, answered concretely.

- **Type.** Newsreader (serif) for stories and prompts — it reads like a memoir; Public Sans (sans) for interface — drawn for accessibility; DM Mono only for years / metadata / labels. **UI floor 18px, story floor 22px.** Display titles 44–56px. Story line-height runs loose (1.55–1.7) for easy elder reading; UI is snug.
- **Color.** Warm or cool *paper* backgrounds with a single emotional accent per surface. Neutrals are brown-toned (Heirloom/Hearth) or slate-toned (Archive) — **never pure gray**. One accent does the emotional work; the rest is paper and ink.
- **Backgrounds.** Flat warm paper (`--surface-page`). No photographic hero washes, no bluish-purple gradients, no busy textures. The one repeating pattern in the system is the **striped photo placeholder** (a 135° terracotta/sage stripe) standing in for a real `<img>`.
- **Shape & depth.** Soft corners — 8px (controls/inputs), 12–18px (cards), 24px (hero prompt), pill (buttons, chips, voice). Shadows are **warm, low, and brown-toned** (`rgba(70,50,30,…)`), never neutral gray drop-shadows. Three steps: `--shadow-sm` (rest), `--shadow-card` (raised), `--shadow-lift` (modal/sheet).
- **Cards.** Paper fill (`--surface-card`), a 1.5px warm border (`--border`), soft radius, and a low warm shadow. They feel like pages, not chips.
- **Borders.** 1.5px, warm-toned. Used to define paper edges, not to box everything — many groupings rely on space alone.
- **Touch targets.** 44px minimum, 64px default, **96px for the one voice action**. Generous spacing between targets so a less-steady hand can't mis-tap.
- **Motion.** Quiet by default. The only ambient animation is the **"listening" pulse** that breathes around the voice button while recording (`--dur-pulse` 2.4s). Everything else simply **fades** at `--dur-fade` (0.15s) on the `--ease-quiet` curve. No bounces, no slides, no parallax. `prefers-reduced-motion` collapses durations to 0.
- **Hover.** Subtle — primary buttons deepen toward `--accent-strong`; secondary/ghost shift background gently. No lift-on-hover, no glow.
- **Press.** A quiet color deepen (toward `--accent-strong`); no aggressive shrink. The voice button switches its glyph to a waveform while active.
- **Transparency & blur.** Used almost never. Surfaces are opaque paper. No glassmorphism — it would fight the heirloom feel.
- **Imagery vibe.** Real photographs (family snapshots), shown warm — slightly faded, like prints in an album. Until supplied they are the striped placeholder; in production they are plain `<img>` with `object-fit: cover`.
- **Layout.** Single-column, centered, roomy. One idea per screen — a prompt, an answer, a story. Fixed elements are rare; the voice action sits where the thumb expects it.

## Iconography
Kindred uses very few icons and **draws none custom**.

- **No icon font, no SVG icon set** ships with this system. Affordances lean on **Unicode glyphs**: `▶` play, `❚❚` pause, `📍` pin/place, `📷` photo, `⌨` keyboard ("Type instead").
- **CSS shapes** carry the two bespoke marks: the microphone glyph on `KindredVoiceButton` (a rounded capsule + stand, built from `<span>`s) and the waveform bars on the voice button and `KindredListenBar`. No hand-rolled icon SVGs.
- **Emoji** are affordances only (pin/photo), never decoration or bullets.
- **Photos are the real imagery.** Shown as the striped placeholder here; replaced with `<img>` in production.
- **If a richer set is needed later,** adopt a *single* thin-stroke library (e.g. Lucide) rather than mixing styles — and document it here. Don't blend systems.

> ⚠️ **Substitution flag — fonts.** Kindred-licensed binaries weren't provided, so `tokens/fonts.css` loads the closest Google Fonts matches (Newsreader, Public Sans, DM Mono) from Google's CDN. Because they're CDN-hosted rather than local `@font-face` files, the compiler reports **0 bundled fonts** — that's expected. Drop in the real binaries + local `@font-face` rules when available and the count will populate.

---

## Index / manifest
Root folder:
- `styles.css` — global entry (links all tokens + fonts)
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `motion.css`
- `components/core/` — `KindredButton`, `KindredVoiceButton`, `KindredPromptCard`, `KindredChip`, `KindredListenBar`, `KindredStoryCard` (each `.jsx` + `.d.ts` + `.prompt.md`) + `core.card.html`
- `ui_kits/kindred-app/` — `index.html` (interactive) + `Conversation.jsx`, `Timeline.jsx`, `StoryDetail.jsx`
- `guidelines/` — `colors-heirloom`, `colors-neutrals`, `colors-themes`, `type-story`, `type-ui`, `type-mono`, `spacing-scale`, `spacing-touch`, `brand-shape`, `brand-imagery`, `brand-wordmark` (`.html` specimen cards)
- `readme.md`, `SKILL.md`

**Components** (namespace resolved by the compiler): `KindredButton`, `KindredVoiceButton`, `KindredPromptCard`, `KindredChip`, `KindredListenBar`, `KindredStoryCard`.

**UI kits:** `kindred-app` (Conversation → record → Timeline → Story detail).
