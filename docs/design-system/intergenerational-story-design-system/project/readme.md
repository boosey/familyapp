# Kindred Design System

A design language for **capturing a life, one conversation at a time** — built elders-first for an intergenerational story app. Large type, a gentle pace, voice over typing, and the warmth of an heirloom rather than a database.

> Sources: this system was distilled from the in-project Kindred showcase (\`Kindred Design System.dc.html\`) and its component set.

## How it's organized
- **\`styles.css\`** — the single entry point consumers link. It \`@import\`s every token + font file.
- **\`tokens/\`** — \`colors.css\` (three themes), \`typography.css\`, \`spacing.css\`, \`motion.css\`, \`fonts.css\`.
- **\`components/core/\`** — six React primitives (\`.jsx\` + \`.d.ts\` + \`.prompt.md\`): KindredButton, KindredVoiceButton, KindredPromptCard, KindredChip, KindredListenBar, KindredStoryCard.
- **\`ui_kits/kindred-app/\`** — tablet recreations: Conversation, StoryDetail, Timeline.
- **\`guidelines/\`** — specimen cards for the Design System tab.

## Theming
\`:root\` is **Heirloom** (cream paper, terracotta, sage — the recommended elder palette). Wrap any subtree in \`data-theme="archive"\` (cool, museum) or \`data-theme="hearth"\` (soft, intimate) to re-skin it. All components read tokens, so they follow automatically.

## Content fundamentals
- **Tone:** warm, plain-spoken, second person to the family member ("A question for Sal"), respectful of the elder. Never clinical or productivity-flavored.
- **Copy:** short, human prompts ("What was your mother like when you were small?"). Years and metadata in mono. No emoji in product chrome beyond the pin/photo affordances.
- **Stories are the hero;** chrome recedes.

## Visual foundations
- **Type:** Newsreader (serif) for stories — reads like a memoir; Public Sans for interface — drawn for accessibility; a mono face only for years/metadata/labels. UI floor 18px, story floor 22px.
- **Color:** warm or cool *paper* backgrounds with a single emotional accent; neutrals are brown- or slate-toned, never pure gray.
- **Shape & depth:** soft corners (12–24px); warm, low, brown-toned shadows. Touch targets 44 min / 64 default / 96 voice.
- **Motion:** one ambient "listening" pulse on the voice button; everything else fades quietly (.15s).

## Iconography
Kindred uses very few icons and **draws none custom**. Affordances lean on Unicode (▶ play, 📍 place, ⌨ keyboard, 📷 photo) and simple CSS shapes (the mic glyph, waveform bars). Photos are the real imagery — shown as striped placeholders here, replaced with \`<img>\` in production. If a richer icon set is needed later, adopt a single thin-stroke library (e.g. Lucide) rather than mixing styles.

## Index
- \`styles.css\`, \`tokens/*\`
- \`components/core/*\` (+ \`core.card.html\`)
- \`ui_kits/kindred-app/*\` (+ \`index.html\`)
- \`guidelines/*.html\` (color / type / spacing cards)
- \`SKILL.md\`
