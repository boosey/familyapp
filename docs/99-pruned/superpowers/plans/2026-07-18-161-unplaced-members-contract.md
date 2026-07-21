# #161 — Surface / place / remove unplaced members — build contract

Grounding: ADR-0023 + `docs/design/2026-07-18-membership-vs-kinship-and-invite-placement.md`.
Scope is the **cure** half only. The invite picker + accept-time auto-placement is **#164** and OUT of scope here.

## Slice 1 — DB + Core (`@chronicle/core`, `@chronicle/db`). Build first, TDD at the core-over-PGlite seam.

### DB delta (`packages/db/src/schema.ts`)
- `memberships` gains `nonFamily: boolean("non_family").notNull().default(false)`.
  Per-family by construction (one membership row per (person, family)). `true` ⇒ removed from the unplaced set.
- `endMembership`: **no schema change** — `membership_status` enum already has `ended`; `ended_at` column already exists.
- Run `pnpm --filter @chronicle/db db:generate`; commit BOTH the snapshot and the emitted `NNNN_*.sql` migration; keep the drift-guard green.

### Core API (new)

1. `linkExistingMember(db, ctx: AuthContext, input): Promise<LinkExistingMemberResult>` in `kinship-write.ts`
   - `input: { familyId; relation: AddRelativeRelation; anchorPersonId?; existingPersonId; nature?; coParentPersonId? }`
   - Mirrors `addRelative`'s edge-writing branch logic (parent/child/partner/grandparent/sibling incl. ADR-0017 bridge topping) but **attaches `existingPersonId`** instead of `insertMentionPerson(...)`. **Never mints a Person for the linked member** (bridges/placeholders may still be minted — they are not duplicates of the member).
   - Auth: actor must be an active member; `existingPersonId` must be an **active member of `familyId`**; anchor must be attachable (active member OR visible in projection — same rule as `addRelative`); `existingPersonId !== anchorPersonId`.
   - Result: `{ allowed; reason?; bridgePersonIds?; edgeIds? }`.

2. `listUnplacedMembers(db, ctx: AuthContext, familyId): Promise<UnplacedMember[]>` in `kinship-repository.ts` (allowlisted)
   - Active members of `familyId` who are an endpoint of **no visible kinship edge** in that family (reuse `resolveKinshipProjection`'s resolved edge set — denied/hidden edges do NOT count as placed) **and** whose membership `non_family = false`.
   - Auth: same as `resolveKinshipProjection` (actor active member).
   - `UnplacedMember: { personId; displayName: string | null; role }`.

3. `setMemberNonFamily(db, ctx: AuthContext, { familyId, personId, nonFamily }): Promise<void>` in `memberships.ts`
   - Any active member may curate. Sets `non_family` on the target's active membership. Reversible.

4. `endMembership(db, ctx: AuthContext, { familyId, personId }): Promise<void>` in `memberships.ts`
   - **Steward-only** (`families.stewardPersonId`). Sets `status='ended'` + `ended_at=now` on the target's active membership.
   - Access revocation is automatic (authorization already gates on `status='active'`). Authored stories and kinship edges are untouched.

### Core regression tests (highest seam, PGlite)
- `kinship-write.test.ts`: link an existing member ⇒ edge created, **no duplicate Person** (person count unchanged); sibling/grandparent link mints the expected bridge(s) but not a member dupe; auth rejections (non-member actor, non-member existingPersonId, self-link).
- `kinship-repository.test.ts`: `listUnplacedMembers` returns members with no edge; excludes placed members; excludes non-family-flagged; a denied-only edge still counts as unplaced.
- `memberships.test.ts`: `setMemberNonFamily` toggles; `endMembership` steward-only, sets ended+ended_at, non-steward rejected.
- `authorization.test.ts`: after `endMembership`, the removed person is denied family content, while their authored story rows and kinship edges remain.
- Keep `architecture.test.ts` + pipeline arch guard green (no `@chronicle/db/content`, no vendor SDKs).

## Slice 2 — Web (`apps/web`). Build after Slice 1 is green + reviewed.
- `lib/family-tab-data.ts`: also call `listUnplacedMembers`; add `unplaced` to `FamilyTabData`.
- `FamilyTab.tsx`: render unplaced members in BOTH views — a "not yet connected" tray on the tree canvas, a section in `KinList`. Actions: **place in tree** (link-existing modal: pick anchor + relation for this member), **leave as non-family**, steward-only **remove member**.
- `app/hub/tree/actions.ts`: server actions `linkExistingMemberAction`, `setMemberNonFamilyAction`, `endMembershipAction` — each re-validates the family against the viewer's active families before calling core.
- Copy → `app/_copy/hub.ts`; pure design values → tokens; JS-math constants → a TS constants file. No hardcoded literals in components.
- Web tests (jsdom): unplaced members supplied by the core read render as not-yet-connected nodes (tree) and rows (list); prior art `tree-slice-a.test.tsx`, `tree-slice-d-invite.test.tsx`.
