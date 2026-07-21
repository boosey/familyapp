# Domain and Data Model

*Summary of the executable model in `packages/db/src/schema.ts`. Canonical vocabulary: `CONTEXT.md`.*

## Three independent dials

Every authorization and sharing decision separates:

| Dial | Question | Primary tables |
|------|----------|----------------|
| **WHO** | Which human? | `persons`, `accounts` |
| **WHERE** | Which family context? | `memberships`, `families` |
| **WHAT** | What is shared how? | `stories.audience_tier`, `story_families`, `consent_records` |

**Kinship** (`kinship_assertions`) is a fourth graph — **orthogonal to authorization**. Seeing a story is never decided by "we are related."

## Core entities

### Person

The permanent human spine. Owns all expressive content.

| Field / concept | Purpose |
|-----------------|---------|
| `displayName`, `spokenName` | UI vs interviewer address |
| `birthDate` | Pacing, era inference |
| `origin` | `self` \| `invitee` \| `mention` — immutable creation provenance |
| `biographical_anchors` | JSONB: hometown, occupation, etc. |
| `onboardedAt` | Gates hub after welcome |
| `lifeStatus` | Living / deceased |

**Provisional Person:** created at invite time so Asks can queue before acceptance (ADR-0006).

### Account

Login attached to Person. Provider-agnostic: `account_identities` + `account_contacts` anchor on verified email (PR #99).

Provisioned **just-in-time** at `/auth/callback` (ADR-0005).

### Family (Chronicle)

Container stories are **surfaced into**. Owns nothing expressive. Has one **steward**.

| Field | Purpose |
|-------|---------|
| `name`, `shortName` | Display; short name for chips |
| `discoverable` | Opt-in search visibility (ADR-0001) |
| `stewardPersonId` | Governance |

### Membership

Person ↔ Family. Role: `narrator` \| `member` \| `steward`. Status: `active` \| `paused` \| `ended`.

At most one active membership per (Person, Family).

### Story

Unit of narrative. Owned by one Person.

| Concept | Values / notes |
|---------|----------------|
| `kind` | `voice` (any audio present) \| `text` |
| `state` | `draft` → `pending_approval` → `approved` → `shared` → `archived` |
| `audienceTier` | `private` \| `branch` \| `family` \| `public` |
| Family targeting | M2M via `story_families` (ADR-0010) |
| Multi-take | `story_recordings` — ordered takes |
| Prose lineage | `prose_revisions` — append-only |

**Source of truth:** approved **prose** (composite of takes + corrections + polish). **Audio** is the original record, immutable while attached (ADR-0008).

### Media

Binary storage reference. Kinds include `story_audio`, `approval_audio`, `photo`, `intake_audio`.

Write-once object storage; consent-scoped immutability (ADR-0002).

### Consent ledger

Append-only `consent_records`. Sharing requires latest row = `approved_for_sharing`. Revocation = new superseding row.

### Ask

Question from one Person to another. Status: `queued` → `routed` → `answered`.

- Single family context via `ask_families` (M2M)
- May target provisional Person
- Optional subject photos (`ask_subject_photos`)
- Links to answered Story on completion

### Family album

| Table | Purpose |
|-------|---------|
| `family_photos` | Shared photo pool |
| `family_photo_families` | M2M photo ↔ family |
| `story_images` | Photos accompanying a story |
| `story_subjects` | Who a story is about |
| `google_photos_connections` | OAuth refresh for Picker import |

Contributor uploads = consent for family members to view/use within targeted families (ADR-0009).

### Kinship

Per-family, steward-governed graph (ADR-0016):

| Primitive | Stored | Derived (never stored) |
|-----------|--------|------------------------|
| `parent_of` | ✅ with `nature` | grandparent, aunt/uncle |
| `partnered_with` | ✅ | in-law (via walk) |
| — | — | sibling (shared parent; ADR-0017 placeholder couple) |

Append-only assertions; deny/correct = new row. Subject hide = personal veto.

### Engagement (schema present; product partial)

`story_views`, `story_favorites`, `story_likes` — shipped in UI.

Notifications, digests — designed, not productized.

### Link session

Token → Person + Family for account-free capture. **Telephony seam** — not general anonymous access.

## Story state machine

```
draft → pending_approval → approved → shared
  ↓           ↓              ↓         ↓
archived ← archived ← archived ← archived
```

Enforced by `assertStoryTransition` in `@chronicle/core`.

## Authorization summary

**AuthContext:** `anonymous` | `account` | `link_session`

**Non-owner read requires:**
1. Story state `approved` or `shared`
2. Latest consent ledger row = `approved_for_sharing`
3. Tier check:
   - `private` — owner only
   - `family` / `branch` — co-membership with owner in a **targeted** family
   - `public` — anyone (no read surface yet)

**Owner** always sees own content in any state.

## Multi-family targeting (ADR-0010)

A Person in families A and B can:
- Share wedding story to **both** (`story_families`)
- Keep a sensitive story in **A only**

Visibility = intersection of: viewer memberships ∩ owner memberships ∩ story's targeted families.

## Prose operations (four passes)

| Pass | Scope | Automatic? |
|------|-------|------------|
| Transcription | One take | Yes (on record) |
| Cleanup | One take | Yes (on record) |
| Polish | Whole draft | No — ✨ or finish-check confirm |
| Correction | Human edit | User-initiated |

See ADR-0014 and `CONTEXT.md` § Narrative.

## Follow-ups (ADR-0012, ADR-0013)

Follow-up questions append **takes to the same Story** — one approval. Every evaluation logged in `follow_up_decisions`.

## Key invariants

1. Person owns expressive content; Family owns none
2. All story/media reads through `decideStoryRead` — no bypass
3. Consent ledger append-only at DB + repository layer
4. Kinship never authorizes content reads
5. Audio never silently swapped after consent
6. Origin enum never flips on Person

## ER diagram (simplified)

```
Person ──owns──> Story ──has──> Media (recording)
  │                │
  │                ├──targets──> Family (story_families)
  │                ├──prompted by──> Ask
  │                └──illustrated by──> StoryImage ──> FamilyPhoto
  │
  ├──member of──> Family (memberships)
  ├──asks / answers──> Ask
  └──related via──> Person (kinship_assertions, per family)
```
