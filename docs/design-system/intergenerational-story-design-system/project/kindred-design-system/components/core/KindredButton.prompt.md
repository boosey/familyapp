The Kindred button — use for any primary or secondary action; it is 64px tall for elder-friendly touch.

\`\`\`jsx
<KindredButton label="Save this story" variant="primary" onClick={save} />
<KindredButton label="Maybe later" variant="secondary" />
<KindredButton label="Skip this question" variant="ghost" />
\`\`\`

Variants: `primary` (filled accent), `secondary` (outline), `ghost` (text-only). Hover darkens/ tints automatically. Pass any native button prop (disabled, type, aria-*).
