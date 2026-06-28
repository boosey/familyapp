# ADR-0001 — Family discovery is opt-in and joining is always steward-approved

Status: Accepted (2026-06-28)
Context: Phase 1 younger-generation onboarding & family flows.

## Context

The spec models families as private containers: Membership is the only link between a Person and a
Family, and in the spec it is only ever *seeded* — there is no modeled way for a stranger to find a
family or ask to join one. The product now needs three things the spec deliberately omits:

1. Sign up and **create** a new family (the steward / first-person flow — explicitly *not* designed
   in the onboarding handoff).
2. Sign up and **request to join** a family that can be found by steward name, by member search, or
   by natural-language description.
3. **Invite someone unknown to the system** (an account-creating member invite).

Item 2 is in direct tension with the spec's privacy-first principle ("Consent is owned by the
person... nothing is shared until the author approves"). Making families *discoverable by strangers*
is the kind of structural decision that is expensive to walk back once data and UI assume it.

## Decision

**Discovery is opt-in; joining is always approval-gated; discovery exposes the minimum.**

- `families.discoverable` defaults to **false**. A stranger's search NEVER returns a non-discoverable
  family. Families are private until the steward explicitly opts in.
- Search may **match on** family name, family description, steward name, and active member names, but
  a result row exposes **only family name + steward display name** — never member identities, never
  stories. Member names are a matching signal, not output.
- Finding a family does not join it. A discovered family yields a **JoinRequest** (`join_requests`),
  which the family **steward must approve or decline**. Approval is the only path that creates a
  Membership via discovery. This preserves "membership is granted by the family, never seized."
- **Natural-language search is a seam** (`FamilySearch` interface) with a deterministic keyword
  implementation now; a real LLM slots in behind the same interface later, so no vendor call is on
  the offline-test path.
- **Member invitations** (`invitations`) are modeled **distinctly from elder session tokens**
  (`elder_sessions`). An invitation creates a younger-generation Account and a Membership on accept;
  an elder session is anonymous capture identity with no Account. Fusing them would conflate "a login
  the family member owns" with "a token that IS the elder's identity" — the exact Person/Account
  split the spec calls load-bearing.

## Consequences

- Two new approval-gated entities (`invitations`, `join_requests`) and two opt-in columns on
  `families` (`discoverable`, `description`). All additive; no existing invariant weakened.
- The single-front-door content rule is untouched: none of this reads Story/Media, so nothing enters
  the authorization allowlist.
- A steward gains a real responsibility (a request queue) earlier than the Phase-4 steward console —
  but it is a thin approve/decline surface, and the `stewardPersonId` seam already existed.
- Rejected alternatives: *open global search* (weaker privacy, and a stranger could enumerate
  members) and *invite-only, no search* (contradicts the explicit product ask). Opt-in + approval is
  the seam that satisfies the ask without hard-coding away privacy.
