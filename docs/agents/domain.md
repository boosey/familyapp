# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary and language for Tell Me Again / Family Chronicle.
- **`docs/strategy/`** — primary product docs (overview, what's built, domain, journeys).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/engineering/DECISIONS.md`** — narrative rationale for non-obvious stack/architecture choices; complements the ADRs.

This is a **single-context** repo: one root `CONTEXT.md`, no `CONTEXT-MAP.md`. If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates and extends them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md                         ← domain glossary (single context)
├── docs/
│   ├── README.md                      ← docs index
│   ├── strategy/                      ← primary product docs
│   ├── adr/                           ← numbered ADRs
│   ├── engineering/
│   │   ├── DECISIONS.md               ← stack/architecture rationale
│   │   └── Recording-To-Story-Pipeline.md
│   ├── brand/                         ← marketing brief
│   ├── agents/                        ← agent how-tos
│   ├── runbooks/
│   └── 99-pruned/                     ← historical / superseded (not product truth)
├── packages/*                         ← source-only libraries (@chronicle/*)
└── apps/web                           ← Next.js app (hub + capture)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (stories are origin-typed, audio-canonical) — but worth reopening because…_
