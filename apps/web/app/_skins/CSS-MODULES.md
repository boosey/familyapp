# CSS Modules convention (Phase 2 flagship migration)

Phase 1 styled everything inline. Inline styles out-specify `[data-skin]` overrides, so structural
signatures require classes. Rules:

1. **One module per migrated component**, co-located: `Foo.tsx` ↔ `Foo.module.css`.
2. **Semantic local class names** (`.card`, `.title`, `.metaRow`) — never presentational.
3. **Values come from tokens.** No hardcoded hex/px in a module except a genuinely one-off layout
   number with no token (rare; prefer adding a token). This preserves the single-source rule.
4. **Skin signatures hook hashed classes via `:global`:**
   ```css
   .card { /* base, token-driven, skin-neutral */ }
   :global(:root[data-skin="playful"]) .card:nth-child(odd) { transform: rotate(-0.6deg); }
   ```
5. **Every structural signature is suppressed under reduce-motion OR solemn:**
   ```css
   :global(:root[data-reduce-motion="on"]) .card,
   :global([data-tone="solemn"]) .card { transform: none; box-shadow: var(--shadow-card); }
   ```
   Motion (transitions, breathing) additionally collapses via the global duration guard in
   `globals.css`; static tilt/tape are killed by the rule above.
6. **Dynamic values** (a computed rotation, an audio level) → set a CSS custom property inline
   (`style={{ "--i": index }}`) and consume it in the module. JS math stays in TS.
7. **Focus:** every interactive element keeps a visible `:focus-visible` outline in the module.
