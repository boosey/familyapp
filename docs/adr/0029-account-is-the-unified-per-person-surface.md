# ADR-0029 — Account is the unified per-person surface; setting scope is per-setting

Status: Accepted (2026-07-23)

Amends **ADR-0020** (UI constants are compile-time; only per-user app preferences vary at runtime).
Consolidates four issues that each nibble at "the user preference page" — **#328** (person-details
panel), **#331** (hide contacts), **#351** (follow-up opt-out), **#357** (memory management) — into a
single coherent surface, and settles which of them actually belong to it.

## Context

Everything a Person could manage about *themselves* was scattered: **Profile** (`/hub/profile`,
identity), **Settings** (`/hub/settings`, app preferences **and** — already — account-level notification
streams), and a fan of **family entries in the avatar dropdown** (one *Family settings* link per
stewarded family, plus *Create a family* and *Find a family*). New per-person controls (#331, #351,
#357) had no obvious home. The owner asked for "one place to go to handle all the information about him
and his usage of the app."

Two things blocked simply "adding a page":

1. **ADR-0020 declared preferences device-local (`localStorage`) only**, with a per-account (Neon) sync
   layer named as a *conscious future change, not built.* But #331/#351/#357 are inherently
   **account-level and cross-device** (a privacy choice, a narration choice, and a memory ledger must
   follow the Person across devices), while the owner *also* wants some values to stay **device-local on
   purpose** (a different text size on phone vs desktop). A single surface must therefore host both
   scopes at once — which ADR-0020's "device-local, not identity" framing did not admit.

2. **"User preference page" conflated distinct axes.** Three of the four issues are about the *Person*;
   **#328** is a redesign of a *viewing surface* (how you see **another** Person in List/Tree) and is not
   a preference surface at all; and "families" spans two orthogonal things — the **personal** membership
   slice (about the Person) and **Family governance** (a shared, steward-governed container, CONTEXT §
   *Membership* / *Steward*). Folding governance into a personal panel would violate the Person↔Family
   orthogonality the model is built on.

## Decision

**The Account is the single per-person surface. Setting *scope* is a property of each setting, not of
the surface. Person and Family remain orthogonal: only the personal membership slice lives in the
Account; Family governance stays on its own per-family surface.**

- **One surface, sectioned, at `/hub/account/[section]`.** A **left rail** on wide viewports and a
  **section drill-down** on narrow (honouring the ADR-0024/0025 native-nav / no-vertical-bloat
  discipline — the rail must not be designed without its mobile drill-down). Sections: **Profile**,
  **Appearance**, **Narration**, **Privacy**, **Notifications**, **Memories**, **Families**, plus a
  danger footer (**Log out**, **Erase account**). The old `/hub/profile` and `/hub/settings` routes
  **redirect** into sections; deep links (e.g. a notification → `/hub/account/notifications`) resolve
  directly.

- **The avatar menu collapses to one launcher.** It becomes **Account** (opens the surface) + **Log
  out** + dev **Switch-user** — nothing else. The per-stewarded-family *Family settings* rows,
  *Create a family*, and *Find a family* move **into** the Account **Families** section (N+2 dropdown
  rows → one section). This costs one extra click to reach low-frequency config; accepted for the
  de-cluttering and single-door coherence.

- **Scope is per-setting (this amends ADR-0020).** Each setting declares whether it is *this-device*
  (browser-applied app preference — reading size, palette, Look & feel, reduce motion, gesture; the
  ADR-0020 `localStorage` → pre-paint → `--var` path is unchanged) or *my-account* (server-persisted,
  cross-device — Contact visibility, Follow-up opt-out, notification streams, Narrator memories). The
  **surface is storage-agnostic**: it reads/writes both backends and does not imply a single scope.
  ADR-0020's registry stays the mechanism for device-local preferences; account-level settings use
  ordinary server persistence. "Preferences are device-local" is thereby narrowed to "**app
  preferences** are device-local," not "all per-person settings are."

- **Person and Family stay orthogonal.** The Account **Families** section holds only the *personal*
  slice: your memberships, per-viewer short-name override (CONTEXT § *Short name*), leave/pause your own
  membership, per-family notification scope. Each row **links out** to Family **governance**
  (`/families/{id}/edit`, member management, tree, album) — which is **not** absorbed into the Account.

- **Per-issue semantics settled:**
  - **#331 Contact visibility** — two independent, account-level booleans (**hide email**, **hide
    phone**), coarse (all families), suppressing the channel from **all** co-members including the
    Steward (a personal veto, like **Subject hide**) and from Invite-modal prefill. Visibility never
    disables **system delivery** — a Notification still reaches a hidden channel. Default visible.
  - **#351 Follow-up opt-out** — per-account; short-circuits the follow-up cascade at the top (no
    evaluation LLM, no ask; audited "suppressed: narrator opt-out"); **Memory extraction unaffected**;
    default ON.
  - **#357 Memories** — an **append-only** narrator-memory ledger (`extracted`|`user` origin,
    `sourceStoryId` provenance, `title`/`summary`/`tags`, `status` active|superseded|dismissed).
    User-authored/corrected facts are extraction-proof (the anchor precedence rule). **The store +
    extraction write-path are a fast-follow build**; #357's CRUD UI is designed against this contract
    now and ships managing the already-stored **Biographical anchors** until the store lands.
  - **#328 person-details panel is out of scope** — it is a viewing-surface redesign + Scrapbook
    re-skin, tracked separately.

## Consequences

- One discoverable home for "everything about me"; the avatar dropdown stops being a menu of
  destinations. Steward family-editing takes one extra hop, accepted for low-frequency use.
- ADR-0020 is not undone: device-local app preferences keep their registry, `localStorage`, and
  pre-paint applier. The change is that the *surface* no longer implies device-local scope — it hosts
  account-level settings beside device-local ones, each labelled by its own scope.
- A future reader asking "why does the Account page mix device-local and cross-device settings, and why
  isn't family management in here?" is answered here: scope is per-setting by design, and Person↔Family
  orthogonality keeps governance out of the personal surface.
- #357 does not silently become a data-model epic mid-redesign: the store is an explicit, separately
  tracked fast-follow, so the panel ships useful (anchors) and deepens (memories) without blocking.
- Adding the account-level persistence for the new settings is additive against the existing schema
  (new columns / a `narrator_memory` ledger table); the device-local registry is untouched.

## Alternatives considered

- **Keep separate pages (Profile, Settings) and just bolt on new toggles.** Rejected: leaves the
  avatar dropdown bloated, gives #331/#351/#357 no coherent home, and never resolves the
  device-vs-account scope question the owner explicitly raised.
- **One flat scrolling preferences page.** Rejected: seven concern-groups of differing scope read
  poorly as one scroll; a section rail (with mobile drill-down) matches the mental model and the
  existing native-nav discipline.
- **Fold Family governance into the Account panel** ("consolidate family pages"). Rejected: violates
  Person↔Family orthogonality — a Family is a shared, steward-governed container, not "information about
  him." Only the personal membership slice comes in; governance links out. (The owner's "families"
  request was in fact about the *avatar-menu* family entries, which this ADR does consolidate.)
- **Build the narrator-memory store as part of this redesign (#357 thick).** Rejected as an in-flight
  scope balloon: defining + persisting + extracting the broader memory model is its own project. Split
  into a contract-now / store-fast-follow sequence instead.
- **Make everything account-level (drop device-local).** Rejected: the owner wants per-device values
  (text size) on purpose; ADR-0020's device-local path is the right tool for those.
