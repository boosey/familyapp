# What Is Built — Feature Inventory

*Grounded in `apps/web` routes and `@chronicle/*` packages as of July 2026.*

## Public surfaces

| Feature | Route | Status |
|---------|-------|--------|
| Landing / marketing | `/` | ✅ Shipped |
| Privacy policy | `/privacy` | ✅ Shipped |
| Sign in / sign up | `/sign-in`, `/sign-up` | ✅ Clerk (prod) + mock (dev) |

## Authentication and onboarding

| Feature | Route | Status |
|---------|-------|--------|
| Post-auth callback (JIT provision) | `/auth/callback` | ✅ |
| Magic link redeem | `/auth/redeem` | ✅ |
| Welcome (name + DOB) | `/welcome` | ✅ |
| Create or join fork | `/families/start` | ✅ |
| Create family | `/families/new` | ✅ |
| Find family (discoverable) | `/families/find` | ✅ |
| Edit family (steward) | `/families/[id]/edit` | ✅ |
| Biographical intake | `/hub/about-you` | ✅ 6-question voice/text pass |
| Profile | `/hub/profile` | ✅ Name, DOB, anchors |
| Settings | `/hub/settings` | ✅ Text size, palette, skin, reduce motion |
| Dev sign-in / seed | `/dev/sign-in`, `/dev/seed` | ✅ Dev only |

**Post-auth routing:** no family → `/families/start` → not onboarded → `/welcome` → else `/hub`

## Hub — primary signed-in experience

Single shell at `/hub` with tab query params. Desktop: top nav + account menu. Mobile: bottom tab bar + account sheet (ADR-0025).

### Stories tab (`?tab=stories`)

| Capability | Status |
|------------|--------|
| Feed (reverse chronological) | ✅ |
| Timeline (by era year) | ✅ |
| Search (title, summary, tags, places) | ✅ |
| Column / masonry layout | ✅ |
| Family multi-select filter | ✅ |
| New / seen badges | ✅ |
| Draft reminder + resume | ✅ |
| Tell a story CTA | ✅ |
| Intake reminder | ✅ |

### Story detail (`/hub/stories/[id]`)

| Capability | Status |
|------------|--------|
| Audio playback | ✅ |
| Prose / transcript toggle | ✅ |
| Photo gallery | ✅ |
| Owner: edit title, tags, subjects, sharing | ✅ |
| Like + favorite (treasure) | ✅ |
| Follow-up question (non-owner) | ✅ |
| Multi-family share picker | ✅ |

### Album tab (`?tab=album`)

| Capability | Status |
|------------|--------|
| Upload from device | ✅ |
| Google Photos Picker import | ✅ (needs OAuth in prod) |
| Grid / masonry / list views | ✅ |
| Captions | ✅ |
| Tag people, places, subjects | ✅ |
| Photo viewer | ✅ |
| Ask about photo / tell story of photo | ✅ |
| Bulk select: ask, tell, delete | ✅ |
| Multi-family photo placement | ✅ |
| Face tagging | ⬜ Stub ("coming soon") |

### Family tab (`?tab=family`, `requests`, `invite`)

| Capability | Status |
|------------|--------|
| Interactive pedigree tree (zoom/pan) | ✅ |
| Relatives list view | ✅ |
| Add relative (parent, child, sibling, partner) | ✅ |
| Edit person details | ✅ |
| Unplaced members tray | ✅ |
| Kinship governance (steward affirm/deny) | ✅ |
| Subject hide veto | ✅ |
| Invite narrator (link) or member | ✅ |
| Join requests queue (steward) | ✅ |
| Person contributions page | ✅ `/hub/person/[personId]` |

### Questions tab (`?tab=questions`, `ask`, `asks`)

| Capability | Status |
|------------|--------|
| To answer queue | ✅ |
| Ask (person + question + optional photos) | ✅ |
| Your asks (status tracking) | ✅ |
| Ask suggestion (detect-and-offer) | ✅ |

## Story capture and composition

| Feature | Route | Status |
|---------|-------|--------|
| Tell a story (self-initiated) | `/hub/tell` | ✅ |
| Resume draft | `/hub/tell/[storyId]` | ✅ |
| Answer a question | `/hub/answer/[askId]` | ✅ |
| Multi-take recording | ✅ | Append takes; drop individual takes |
| Voice + text interleaved | ✅ | ADR-0007 |
| Composing surface (live editor) | ✅ | ADR-0014 |
| Four prose passes | ✅ | Transcription → Cleanup → Polish (opt-in) → Correction |
| Finish check (cross-take corrections) | ✅ | Detect-and-offer |
| Tap to share (audience tier + families) | ✅ | ADR-0004 |

### Link-session capture (no account)

| Feature | Route | Status |
|---------|-------|--------|
| Narrator record | `/s/[token]` | ✅ |
| Voice approval (link session only) | `/s/[token]/approve/[storyId]` | ✅ |
| Magic link → hub answer | `/a/[token]/[askId]` | ✅ |

**Note:** Signed-in users approve with a **tap** (tier picker + Share). Link-session narrators without accounts still use **spoken approval** on the minimal capture surface.

## Invitations

| Feature | Route | Status |
|---------|-------|--------|
| Accept member invite | `/join/[token]` | ✅ |
| Pending invite banner (email match) | Hub | ✅ |
| Narrator personal link | `/s/[token]` | ✅ |
| Invite delivery (email/SMS) | — | ✅ Adapters exist |

## Pipeline and AI (backend)

| Capability | Package | Status |
|------------|---------|--------|
| Transcribe (Groq Whisper) | `@chronicle/pipeline` | ✅ |
| Per-take cleanup | ✅ | |
| Opt-in polish | ✅ | |
| Story metadata derivation | ✅ | |
| Biographical anchor extraction (post-approval) | ✅ | |
| Photo ranking / nudge | ✅ | |
| Interviewer turn loop | `@chronicle/interviewer` | ✅ |
| Follow-up evaluation (audited) | ✅ | ADR-0013 |
| Gap detection follow-ups | ✅ | |
| In-process job queue | ✅ | Inngest adapter for prod |

## Authorization and data integrity

| Capability | Status |
|------------|--------|
| Single front door (`decideStoryRead`) | ✅ |
| Append-only consent ledger | ✅ DB trigger + repo |
| Story state machine | ✅ |
| Architecture guard tests | ✅ |
| Provider-agnostic identity (email anchor) | ✅ |

## Explicitly not built

| Feature | Notes |
|---------|-------|
| Phone / telephony capture | Seam only (`CaptureSource`) |
| Notifications / digests | Designed in CONTEXT; no outbound product yet |
| Ask the archive (RAG Q&A) | Chronicle search shipped; Q&A deferred |
| External sharing (`public` tier surface) | Tier stored; no anonymous reader |
| GEDCOM / FamilySearch import | Designed; not shipped |
| Posthumous avatar | Governance framework exists; feature not shipped |
| Story-will / succession | Deferred |
| Native mobile app | Responsive web (ADR-0024/0025); native later |
| Branch-tier enforcement | Stored; enforced as `family` in Phase 0 |
| Time-gated release | Deferred |
