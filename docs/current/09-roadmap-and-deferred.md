# Roadmap and Deferred Work

*What's done, what's next, and what's explicitly out of scope for now.*

## Shipped (Phase 0 + Phase 1 core)

| Milestone | Status |
|-----------|--------|
| Repo + monorepo spine | ✅ |
| Schema, auth oracle, consent ledger | ✅ |
| Link-session capture (`/s/[token]`) | ✅ |
| Pipeline (transcribe → prose) | ✅ |
| Interviewer behavior + follow-ups | ✅ |
| Approval gate | ✅ |
| Family hub (stories, questions, invite) | ✅ |
| Ask relay loop | ✅ |
| In-hub answer + composing surface | ✅ |
| Clerk auth (prod live) | ✅ |
| Provider-agnostic identity | ✅ |
| Direct story creation + text origin | ✅ |
| Story imagery (album, attachments, Google Picker) | ✅ |
| Multi-family scope + targeting | ✅ |
| Kinship tree + governance | ✅ |
| Mobile-responsive hub (ADR-0024/0025) | ✅ |
| App branding (Tell Me Again, logo) | ✅ |

Track detail: `docs/PLAN.md`, `docs/PROGRESS.md` (increment log may lag feature merges).

## Near-term product gaps (known)

| Gap | Notes |
|-----|-------|
| **Notifications** | Schema + CONTEXT designed; no outbound email/SMS digest product |
| **Face tagging** | UI stub; no ML backend |
| **Ask the archive** | Chronicle search shipped; RAG Q&A deferred (consent risk if corpus wrong) |
| **Public tier read surface** | Tier stored; no external sharing URL |
| **Branch-tier enforcement** | Value preserved; behaves as `family` |
| **Engagement digests** | "This week in family history" — designed, not built |
| **Asker avatar (video)** | Voice ask recording designed; face/video later |
| **Clerk social sign-in** | Off in prod until own Google OAuth client |

## Medium-term (strategy-aligned, not scheduled)

| Initiative | Dependency |
|------------|------------|
| Telephony adapter | Twilio seam; same pipeline |
| GEDCOM / FamilySearch import | Background job + reconciliation UI |
| External record enrichment | Census, newspapers — Phase 3 in original roadmap |
| Time-gated story release | Ledger + tier extension |
| Story-will / succession | Steward handoff product |
| Posthumous avatar (retrieval-only) | Consent framework gate |
| Native iOS/Android app | Responsive web first (ADR-0024) |
| Periodic engagement engine | Notifications + triggers catalog |
| Vision photo understanding | Premium tier; caption suggestion exists |

## Explicitly deferred / won't do soon

| Item | Rationale |
|------|-----------|
| Generative grief bots | Ethical line; retrieval-only for any avatar |
| DNA integration | Sensitivity; out of scope |
| Social network features | Not the product |
| Anonymous public chronicle | `public` tier is a seam, not a launch surface |
| Background Google Photos sync | Picker-only per Google API policy 2025 |
| Apple Photos web API | No API; native app only |

## Competitive timing note (from original strategy)

The AI voice-memoir space filled rapidly. Tell Me Again's differentiation is **ongoing family storykeeping** — album, tree, questions, multi-generational hub — not a one-time memoir export.

The wedge (capture + ask loop) is shipped. The moat is the **full chronicle** compounding over time.

## How to prioritize (ADR-0022)

Current method: gated two-layer prioritization documented in wayfinder docs. See `docs/01 Strategy/Family-Chronicle-Prioritized-Backlog.md` for issue-linked queue (may need refresh against this doc set).

## Documentation maintenance

| When | Update |
|------|--------|
| New user-facing feature ships | `04-what-is-built.md`, `05-user-journeys.md` |
| New ADR accepted | `07-architecture.md` index + relevant current doc |
| Positioning change | `01-product-overview.md`, `02-vision-and-mission.md` |
| Terminology change | `CONTEXT.md` first, then `06-domain-and-data-model.md` |

**This folder (`docs/current/`) is the product truth.** When it conflicts with `docs/01 Strategy/`, trust `docs/current/` and ADRs.

## Historical docs (superseded framing)

These remain for provenance but **overstate elder/telephony centrality**:

- `docs/01 Strategy/Family-Chronicle-Vision.md`
- `docs/01 Strategy/Family-Chronicle-Personas.md`
- `docs/01 Strategy/Family-Chronicle-Journey-Map.md`
- `docs/01 Strategy/Family-Chronicle-Release-Roadmap.md`

Still useful for engagement engine ideas, consent framework depth, and identity model — read with the corrections in `02-vision-and-mission.md`.
