# Consent, Privacy, and Governance

## Privacy principle

> Your family's memories belong to your family.

- Private by default
- Nothing shared without explicit author approval
- No sale of personal information
- No use of user content to train third-party advertising or AI models

Published policy: `tellmeagain.app/privacy` — copy in `apps/web/app/_copy/legal.ts`

## Consent model

### Append-only ledger

Every sharing decision is recorded in `consent_records`:

| Property | Rule |
|----------|------|
| Mutability | **Never** UPDATE or DELETE — DB trigger enforces |
| Revocation | New superseding row only |
| Sharing gate | Non-owners require latest row = `approved_for_sharing` |

### Author approval

The **story owner** (narrator) approves before family sees content.

| Surface | Approval UX |
|---------|-------------|
| Hub (signed-in) | Tap: tier picker + **Share** (ADR-0004) |
| Link session | Listen + **spoken approval** (account-free path) |

Finish (end composing) and Share (consent) are **separate acts** (ADR-0014).

### Audience tiers

| Tier | Who can read (non-owner) |
|------|--------------------------|
| `private` | Owner only |
| `branch` | Stored; enforced as `family` in Phase 0 |
| `family` | Co-members in a **targeted** family |
| `public` | Anyone — **no read surface shipped** |

Family targeting (`story_families`) further scopes which families see a `family`-tier story (ADR-0010).

## Media immutability (ADR-0002)

| State | Audio deletable? |
|-------|------------------|
| Draft (no consent row) | Yes — discard/drop |
| Consented / shared | No — immutable while attached |
| Story deleted | Audio removed with story |

Guarantee is against **silent swap**, not against deletion.

## Memory extraction

| Source | When extracted | Consent |
|--------|----------------|---------|
| Story | Post-approval only | Sharing = consent to family-visible memory |
| Intake (`/hub/about-you`) | On Save | Answering direct question = consent |
| Discarded draft | Never | — |

Transcripts retained for audit regardless; extraction is consent-gated.

## AI disclosure posture

| Operation | User visibility |
|-----------|-----------------|
| Transcription | Automatic; raw STT |
| Cleanup | Automatic; labeled in prose lineage |
| Polish | Opt-in ✨ or finish-check confirm |
| Follow-up questions | Spoken by interviewer persona |
| Ask suggestion | Detect-and-offer on compose |

**Future:** synthesized prose, restored images, avatars — visibly labeled (MyHeritage watermark model per consent framework).

## Kinship governance (ADR-0016)

Kinship is **not** a privacy boundary for stories — it is a **family tree fact** with its own governance:

| Actor | Power |
|-------|-------|
| Asserter | Create edge (first-asserter-wins provisional) |
| Steward | Affirm, deny, correct any edge |
| Subject (account holder) | Hide edge about themselves — overrides steward |
| Any member | Challenge → steward decides |

All transitions append-only.

## Steward moderation

Steward may **delete any content in the Family** — inappropriate stories, photos, captions. This is moderation, not ownership transfer.

Steward also:
- Approves join requests (ADR-0001)
- Manages family settings and discoverability
- Holds succession seam (not fully productized)

## Identity and erasure

- Provider-agnostic identity anchored on verified email
- `erasure-repository.ts` — audited deletion paths
- Google Photos: connect-once Picker; user picks specific photos; Limited Use policy

## What we do not build (governance)

| Feature | Status |
|---------|--------|
| Posthumous narrator avatar | Governance framework in strategy docs; **not shipped** |
| Interactive "talk to Grandma" | Explicitly out — retrieval-only future |
| Story-will / digital estate | Designed; not shipped |
| Time-gated release | Schema-ready; not shipped |
| Law-enforcement data policies | Standard privacy policy; no special portal |

## Elder-specific protections (without elder-only product)

- No login required on link-session path
- Emotional-door rule: interviewer never opens grief unprompted
- Off-ramp always available ("skip", "pause", "something happier")
- Large type, voice + type on every capture step
- No homework framing — questions come to them, not journals to fill

These protect vulnerable narrators while applying to **any** storyteller who wants a gentle path.
