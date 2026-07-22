# CONTEXT — Glossary

The canonical vocabulary of Family Chronicle / Tell Me Again. Terms only; no implementation. When code or
conversation uses a word that conflicts with a definition here, the conflict is a bug in one of them.

**Product overview and shipped features:** see `docs/strategy/`.

## Identity & membership
- **Person** — the permanent, singular human; owner of everything expressive. There is one kind of
  user. A Person normally has an Account, but two states precede one: a **provisional Person** (a
  pending invitee, created so questions can be queued for them before they accept) and the
  telephony exception.
- **Account** — the login attached to a Person. Holds only the auth provider's user id + basic
  profile; never a password. Provisioned just-in-time when a Person accepts an invitation
  (ADR-0005); a provisional invitee and a telephony Person have none.
- **Provisional Person** — a `persons` row created at invitation time for someone who has not yet
  accepted (Option A / ADR-0006). Lets Asks and other references attach to a real anchor before
  acceptance; acceptance links an Account to the *same* Person. An invitee who never joins leaves a
  provisional Person cleaned up by a housekeeping pass (never expressive, never surfaced).
- **Family (Chronicle)** — a container a family's stories are *surfaced into*. Owns nothing
  expressive. Has a **steward**.
- **Steward** — the Person who governs a Family: approves who joins, holds succession (seam), and
  **may delete any content in the Family** (member stories, photos, captions) as moderation of
  inappropriate material. The creator of a Family is its first steward.
- **Membership** — the plural, revocable link between a Person and a Family. Carries a DB role
  (`narrator` | `member` | `steward`) and status (`active` | `paused` | `ended`). At most one
  *active* membership per (Person, Family). Granted by the family — never seized. The DB role
  `narrator` marks whose stories are the *primary capture focus* of this Membership — a structural
  fact about the family relationship, not a statement about the Person's account type or identity.
- **Narrating / Asking** — actions, not user types. There is one kind of user. Any Person can
  narrate (record and share their stories) and any Person can ask (submit questions for another
  Person who is narrating). The same Person may narrate in one session and ask in another. *Narrator*
  and *asker* are shorthand for the role a Person is playing in a specific interaction — not a
  persona, not an account category, not a permanent identity.

## Kinship & the family tree
- **Kinship edge** — a Person↔Person relationship (`mother-of`, `sibling-of`, `spouse-of`, …).
  Orthogonal to **Membership** (Person↔Family): kinship says *how two humans are related*;
  membership says *which family contexts a Person participates in*. Kinship **never drives
  authorization** — a person seeing a story is decided by the single front door (membership +
  consent), never by "we are related." A tree node is always a **Person** (no separate shadow-person
  table); it may lack an Account, a Membership, or both.
- **Origin** — an **immutable creation-provenance** enum on every Person recording *why the row was
  first created*: `self` (their own account acceptance), `invitee` (a provisional Person minted
  because someone is actively inviting them — ADR-0006), or `mention` (created only because someone
  named them as kin in a tree; may be deceased, may never be contacted). Origin never flips — a
  `mention` great-uncle later invited and joined keeps `origin = mention`; only his *membership*
  changes. Current state (onboarded? member? living?) lives in `accountId` / `memberships` /
  `lifeStatus`, not here. The housekeeping reaper keys off `origin = invitee AND never accepted` —
  **never** off `mention`.
- **Dedup-on-invite** — inviting a person already present as a `mention` must **not** mint a second
  row; it reuses the existing Person and attaches the invitation. Default match heuristic is
  *name + inviter*, but a match only **offers** ("is this the same person?") for the inviter to
  confirm — never merges silently (two relatives can share a name; a mention and an invite can come
  from different people).

- **Placeholder (unidentified) Person** — a `mention` Person with **`identified = false`** and no
  name, existing only to **bridge a generation** the asserter can't or won't name (a granddaughter
  attaches to her grandmother through an "unknown father" node). Because the tree stores only
  generative edges, an intermediate node *must* exist to connect non-adjacent kin — but it may be
  deliberately anonymous. Rendered from the relation ("your father", "unknown"), **never reaped**
  (it's a structural bridge), and **never invitable until identified** (invitation needs an identity;
  filling the fields in flips `identified` true without changing `origin`). The UI may create the
  bridge **implicitly** (one-tap "add grandmother") even though the data always holds the explicit
  node. Two relatives independently adding "unknown father" create two placeholders for the same man —
  tolerated (first-asserter-wins), and the prime **reconciliation** merge candidates.
- **Parent-of / Partnered-with** — the **two generative primitives** of the tree. `parent-of` is a
  directed Person→Person edge carrying a **`nature`** (`biological | adoptive | step | foster |
  unknown`); `partnered-with` is an undirected union edge. These two are the *only* stored kinship
  facts — **no new edge types** for half/step or multi-partner cases; the existing `nature` enum and
  the two primitives already cover them. **Sibling, half-sibling, step-sibling, grandparent,
  aunt/uncle, cousin, in-law** are **derived labels** by walking parent/partner edges (full sibling =
  shares two parents; half-sibling = shares exactly one; step-sibling = a parent of A is
  partnered-with a parent of B and they do **not** share a `parent-of` edge — shared `parent-of`,
  even `nature=step`, is half/full by parent count, never step-sibling), never stored — so a derived
  fact can never contradict
  a stored one.
- **Union-node ban** — a genealogy file (GEDCOM) groups a marriage-plus-children into a unit it calls
  a **`FAM`**/"family". That is **not** our **Family (Chronicle)**. We never store a union node and
  never call it "family": on import a `FAM` is **shredded** into `parent-of` + `partnered-with`
  edges. "Family" always means the chronicle container.
- **Sibling container** — because "sibling" is derived (shares a parent) and never stored, two people
  can only be *made* siblings by giving them a **shared parent**. **Add sibling** to a person with no
  full parent-couple therefore auto-creates a **placeholder parent-couple** — two unidentified bridge
  persons, partnered, each a `parent-of` both siblings (ADR-0017). That path still produces *full*
  siblings. Half-siblings are unlocked separately by an explicit **this parent only** choice when
  placing a child (one shared parent; ADR-0017 amendment) — never by inventing a stored sibling edge.
- **Multi-partner** — a Person may have more than one `partnered-with` edge. Allowed in the model and
  in placement UI; each partnership is its own undirected edge, and children attach via ordinary
  `parent-of` (with `nature` as needed). Not a new primitive.
- **Partner→children offer** — when a new partner is added to someone who already has children, the
  system **offers** (never silently writes) a step `parent-of` from the new partner to each existing
  child. Accepting writes `nature = step`; declining leaves the children attached only to the original
  parent. Same **offer-never-silent** discipline as Dedup-on-invite and Finish check (ADR-0027).
- **Family tab List** — the Family tab's **browse-only people index**: the full family projection
  (members and tree-placed kin), with a **Member** vs **tree-only** badge so membership and kinship
  stay visually distinct. No placement, no relationship governance, no unplaced queue — those live on
  the Tree (ADR-0023 amendment).
- **Family tab Tree** — the Family tab's surface for **place, relate, and govern**. Holds the kinship
  canvas, the **tree tray** (unplaced members + New person), zone-based placement with confirm, and
  edge governance. Distinct from List (ADR-0023 amendment, ADR-0027).
- **Tree tray** — the Tree's home for people not yet on the canvas: **unplaced members** (active
  membership, no kinship edge in this family) plus **New person**. Placement starts from the tray;
  governance of existing edges is on the canvas, not in the List (ADR-0023 amendment).
- **Member vs tree-only** — badge language on List (and anywhere the full family projection is shown):
  **Member** = has an active Membership in this Family; **tree-only** = appears via kinship / tree
  placement without (or no longer with) an active membership. Orthogonality of membership and kinship
  made visible — neither badge grants content access by itself.
- **Focus person** — the single person a **tree view** is centered on: the initial framing and initial
  expansion origin. Seeded by the entry point (the person whose menu opened the tree, or the logged-in
  user for a direct visit) and thereafter fixed — not selectable, not re-rootable, not visually
  distinct. Deliberately **not** called "anchor" (that word already means the *media anchor* and
  *Biographical anchors*) nor "root" (which implied the retired re-rooting).

- **Family-scoped edge** — a kinship edge is **surfaced into a Family**, exactly as a Story is
  (ADR-0010): the asserter creates it in a family context; it is visible to **all members of that
  family** and governed by **that family's Steward**. The *same* person-pair may be independently
  asserted in another family (its own row, its own Steward's governance) — **never auto-propagated
  across families**, because one Steward has no authority over what another family sees. "The family
  tree" is therefore a **shared per-family projection**, one per family, not a single global object
  and not a per-asserter private weave. Every edge still records **who asserted it** (`assertedBy`)
  for audit, but assertion does **not** scope visibility — family membership does.
- **First-asserter-wins** — the first assertion of an edge is shown to the whole family as
  provisional truth (no endpoint confirmation required). Governance is by **exception**, not by
  up-front consent: the **Steward** may **affirm, deny, or correct** any edge; later, any member may
  **challenge** an edge and the **Steward decides**. All of it is **append-only** — a deny/correct/
  challenge/decision **supersedes** with a new row (same discipline as the **Consent ledger** and the
  **Follow-up decision record**), never an edit; history is never lost. **Issue #256:** the edge's
  **original asserter** may also **deny (retract) that same edge** themselves, even when not the
  Steward — the one governance action a non-steward may exercise, and only over their own assertion;
  `affirm`/`correct` remain Steward-only.
- **Subject hide** — a **personal veto** available to the Person an edge is *about*, when they are a
  real account (`self`). Hiding suppresses the edge family-wide (it stops being shown as fact) and
  **overrides even a Steward affirmation** — being *depicted at all* is the subject's own consent, not
  a factual dispute the Steward adjudicates. A `mention` subject has no account to hide, so mentions
  stay purely Steward-governed. Append-only, like every other kinship transition.

- **Tree import** — bringing in a genealogy file (GEDCOM) or connecting a genealogy API
  (FamilySearch, Ancestry). **Steward-only** (for now — the Steward already governs the family tree,
  so bulk assertion is a Steward act). **Always additive**: every imported individual lands as a **new
  `mention` Person** and is **never auto-merged** onto an existing Person. Runs as a **background
  job** (the `JobQueue` seam) with per-item progress (like album import, ADR-0015); imported edges
  are asserted by the importing Steward and surfaced into that family. A **deceased-only fast path**
  lets the common low-risk case (dead ancestors) skip living-person reconciliation entirely.
- **External ref** — source provenance persisted on each imported Person: `source`
  (`gedcom | familysearch | ancestry`), `sourceId` (the source's own person id, e.g. GEDCOM `@I42@`
  or a FamilySearch PID), and `importBatchId`. Re-import / API **sync matches on `(source,
  sourceId)`** to update-in-place — foreign ids, never names, drive **idempotency**.
- **Reconciliation** — the **separate, explicit, human-confirmed** step of merging an imported
  `mention` onto a Person already known to the chronicle. **Never part of import.** The importer is
  *offered* likely matches ("these look like people you already know — merge?") and confirms each —
  the same **offer-never-silent** discipline as **Dedup-on-invite**, at bulk.

## Joining a family (the new flows)
- **Invitation** — a system-delivered link a member sends to someone (possibly unknown to the
  system). The inviter supplies the invitee's contact; the system delivers the invite over an
  **Outbound channel** and records that contact as the invitee's notification channel. Accepting it
  creates/links the invitee's Account and an active Membership. (The invitation is thus the moment
  the system learns how to reach a Person — the precondition for ever notifying them.)
- **Magic link** — a texted or emailed deep link whose token is a **passwordless login to the
  Person's existing Account**, routing straight to a specific question's answer page. Time-boxed and
  reusable within its window. The link is the password (a bearer credential), accepted deliberately
  so a Person never has to type a password. This is the primary low-friction entry for all users,
  including elderly narrators who should never see a login screen.
- **Link session** — a token-based session for the genuinely account-free case: telephony (inbound
  phone calls). The long unguessable token maps to a Person and a Family context; it is a narrow
  seam for channels where Account-based login is impossible, not a general-purpose anonymous-access
  mechanism. Web narrators use a Magic link (auto-login to their Account), not a link session.
- **Discoverable family** — a Family whose steward has opted into being found by search. Default is
  private (not discoverable).
- **Family search** — finding a *discoverable* family by name, description, steward name, or member
  names. Returns family name + steward name only; never members or stories.
- **Join request** — a discovered family is not joined, only *requested*. The steward approves
  (→ Membership) or declines. The only discovery path to membership.
- **Onboarding** — the first-sign-on flow for an Account after a family intent exists (create or
  join): confirm **display name** and **date of birth** in `/welcome`, then the **Intake**
  introduction. Gated by `Person.onboardedAt`. **Spoken name** defaults from display name here and
  may be refined later on **Profile**.
- **Profile** — the signed-in screen where a Person **later** views and edits their identity
  (display name, spoken name, date of birth, read-only email) and **Biographical anchors** inline
  (text-only, direct structured fields). Distinct from the first-time **Intake** walk at
  `/hub/about-you`, which stays unchanged in onboarding; Profile is reached from the account menu
  for post-onboarding edits.
- **Settings** — the signed-in screen for **app preferences**: text size and color palette
  (Heirloom / Archive / Hearth). Light / dark / system appearance is deferred until dark tokens
  exist. Device-local preferences, not identity (Profile) and not account actions (sign out stays
  in the account menu).
- **App preference** — a **device-local** choice a Person makes for how the app looks or reads,
  surfaced on **Settings** (today: reading size and color palette). A deliberately small, opt-in set —
  a UI value becomes an app preference only when it is promoted to one; the vast majority of UI values
  are fixed at build time and are not preferences. Distinct from **Profile** (identity) and from account
  actions. Because it is device-local, a preference does not follow a Person across devices unless it is
  later re-defined as identity-linked (a conscious change, not the current model — see ADR-0020).
- **Spoken name** — the name the interviewer speaks aloud when addressing this Person. Defaults to
  the first word of display name; editable on Profile independently of display name.
- **Family filter** — on a **browse** surface (the album, story browse, the tree), the viewer's
  selection of which of their Families' content is shown. **Multi-select** on the album and stories,
  **single-select** on the tree (until multi-family trees exist). It only **narrows what is displayed**
  — it never grants access nor targets a write. A viewer in a single Family has nothing to filter, so
  it does not appear. Distinct from the domain sense of *family-scoped* (which is about authorization,
  not display). Not to be confused with **Surfaced-into** (a Story's targeting), which is a property of
  the content, not of the viewer's current view.
- **Family designator** — on an **action** flow (inviting, asking, viewing join requests, adding
  photos), the Family the action **operates on**: a single Family for invite/ask/requests, one-or-more
  for adding photos. It is **seeded from** the current **Family filter** but held **separately** —
  changing the designator picks who you act on and does **not** alter what the viewer is browsing. The
  same visual control renders a **Family filter** or a **Family designator** depending on the surface;
  the distinction is the behaviour behind it, not the widget.
- **Short name (Family)** — an optional brief label for a Family, set by its **Steward**, shown wherever
  the formal name would crowd the layout (the hub header, the filter chips). Defaults from the formal
  name by a simple heuristic ("The Boudreaux family" → "Boudreaux") and is freely editable; falls back
  to the formal name when unset. A **per-viewer override** — for someone who belongs to two similarly
  named Families and needs to tell them apart — is a *separate*, future, account-level preference living
  where a Person manages their memberships; it is **not** the Steward's short name.

## Narrative & consent
- **Surfaced-into (family targeting)** — the set of Families a Story is shared into (many-to-many).
  A Story is owned by one Person and is **never duplicated** per family; targeting only scopes *which*
  of the owner's families may see it (it is not a per-family copy). `family`/`branch`-tier visibility
  = a viewer co-membered with the owner in a family the story is **targeted to** *and* that the owner
  still belongs to — NOT every family the owner happens to be in. This lets a Person in two families
  (e.g. Boudreaux and Carney) put the wedding story in **both** while keeping a Boudreaux-only story
  **out** of Carney. `private` = owner only (targeting irrelevant); `public` = everyone. Contrast the
  **Ask**, which carries a single family context, not a set. See ADR-0010.
- **Story** — the unit of narrative, owned by one Person, surfaced into Families per its
  **audience tier** (`private` | `branch` | `family` | `public`) **and its family targeting** (see
  *Surfaced-into*). Stories have a `kind`: **`voice`** (the draft holds at least one recorded take)
  or **`text`** (every take was typed; no audio). A person may switch between mic and keyboard freely
  *within a single draft* — takes of both origins **interleave in one ordered set** — and **any audio
  at all makes the story `voice`-kind** (ADR-0007). A voice or text draft may hold **more than one
  Take** — the narrator kept going, or an interviewer **Follow-up** drew out another. The prose is the
  **ordered concatenation** of each take's contribution (a voice take's Cleanup, or a typed take's
  words), each appended in isolation — earlier text is never re-rendered, and hand-edits are
  preserved. One approval covers the whole (possibly multi-take, possibly mixed) draft.
- **Source of truth vs. audio of record** — the story's **source of truth is its approved prose**: a
  *composite* of every input (spoken takes + typed takes + hand-corrections + Polish), sealed at
  approval. The **audio is the *original record*** — retained while its item lives for playback,
  audit, and improvement, and immutable and undetachable while attached (removed only when the item
  itself is deleted; ADR-0008) — but it is **not** the source of truth and the prose is
  **not** regenerable from it. Only a voice take's raw **transcript** is regenerable (re-run STT on
  that take's audio); the **prose is authored** (it carries typed words and human corrections that do
  not exist in any audio), so it must be persisted and **never blindly regenerated**. ("Canonical
  audio" in older ADRs means exactly this: the un-detachable-while-attached original record, *not*
  regenerable-source.)
- **Take** — one recording within a Story. A single-answer Story has one take; a Story deepened by
  **Follow-ups** has several, kept in the order they were spoken. NOTE the shift from the earlier
  glossary sense: a take used to be *the* (single) current recording that **Re-record** replaced;
  takes now **coexist**. Re-record still supersedes — but only the *latest* take being worked on,
  not the earlier consented-into-the-thread takes.
- **Draft** — a Story being **composed** but not yet consented. It is the narrator's live working
  surface: it holds the durable audio **take(s)** *and* the working, editable text (the raw
  **transcript** plus the disfluency-cleaned **prose** shown in the editor). Recording stays active
  — the narrator can record more takes (each is disfluency-cleaned in isolation and **appended**;
  earlier text is never re-rendered) and can hand-edit the prose freely; hand-edits are permanent
  and survive later appends. Composition ends at an explicit **Finish**, after which the narrator
  chooses an audience tier and gives **Consent** — a separate, deliberate act (Finish is not
  Share). (Earlier drafts held no text — the pipeline was deferred until approval to save tokens;
  that model is retired. Transcription + the disfluency pass now run per take at record time, so a
  draft that is later discarded has spent those tokens — an accepted cost of an editable working
  surface.) A draft is the narrator's *approve-later* work — it is never auto-deleted. It is
  deletable (audio blob + row) only because it was never consented; once approved, its audio can no
  longer be mutated or detached — it stays the canonical source for as long as the Story exists, and
  is removed only when the Story itself is deleted (ADR-0008). Deletion is always available (owner
  erasure, steward moderation); the guarantee is against *silent swap*, not against deletion.
- **Discard / drop** — the two **deliberate** removals that delete draft audio (event-driven
  cleanup; no time-based sweep): **Discard** removes the whole draft (all takes); **Drop** removes
  one specific take (e.g. a bad take just recorded). "Record more" only ever **appends** a take and
  never deletes. Retention rule: audio is never *silently* discarded after transcription — every kept
  take keeps its canonical audio; only these explicit user actions delete (the ADR-0008 line:
  guarantee is against silent swap, not against deletion). (The earlier whole-draft "re-record"
  supersede mode is retired — append + drop replace it.)
- **Consent ledger** — append-only record of approvals/revocations. Nothing is shared until the
  author approves; revocation is a new superseding row, never an edit.
- **Ask** — a question one Person submits for another Person who is narrating; becomes the
  narrator's next prompt and, once answered + approved, the family's notification. Any user can
  submit an Ask; asking and narrating are not mutually exclusive. The target may be a **provisional
  Person** (a pending invitee): the Ask queues and surfaces to them only *after* they onboard, as a
  warm "your family is waiting" hook — never delivered pre-acceptance. The floor is the Invitation:
  no asking a total stranger (ADR-0006). Like a Story, an Ask has a **kind** (`voice` | `text`). A
  voice Ask is recorded and transcribed; the transcript is the asker's to edit, with only
  **Cleanup** (see below) applied. The question reaches the narrator in the asker's own words, framed
  warmly by the interviewer persona but never reworded. This mirrors the *answer* side: a Story's
  editor text is likewise Cleanup that preserves the speaker's actual words, never a literary
  rewrite. For both question and answer the **first version is always in the person's own words**; a
  fuller **Polish is opt-in** (the ✨ button near the edit field), not the default. **Text is always
  available** (durable record + fallback).

### The four text operations (the prose lineage)
A recorded telling passes through up to four named text stages; together they are the **prose
lineage**, recorded append-only (the immutable `prose_revisions` ledger beside the story's current
text — same discipline as the **Consent ledger**). No stage ever mutates the canonical audio.
- **Transcription** — raw speech-to-text of a **Take**, verbatim (disfluencies and all). The L1
  source; one per take.
- **Cleanup** — the **automatic**, per-take pass applied the moment a take is recorded, producing
  the text that lands in the editor. Removes filler ("uh", "um"), false starts, and accidental
  repetition; joins broken sentences; and **resolves the speaker's own self-corrections *within that
  take*** — keeps the value they landed on and drops the false start and scaffolding ("oh wait",
  "actually"), *but keeps their hedge when it is genuinely unclear which value they settled on*
  (never guesses). Cleanup is **order-preserving and faithful** and **sees only the single take** —
  the result is still the person's own words, which is why it may run automatically before review. It
  **never reorders** and never touches earlier takes. A self-correction that spans takes ("in 1985" /
  next take "no, 1987") is therefore *out of Cleanup's scope* — only **Polish** resolves it.
- **Polish** — the **human-confirmed**, holistic pass, and the **only** operation that sees the
  **whole accumulated text** at once. It may **restructure** — de-ramble and reorder circular passages
  for readability — and, because it is holistic, it is also what resolves **cross-take
  self-corrections**. Triggered two ways, both the same operation and both logged (`ai_polished`, one
  row per run): the **✨ button** in the editor, or **accepting the Finish check** (below). Never
  runs unconfirmed, always reversible (undo/redo); the audio original record is untouched. (Formerly
  the "AI re-render"; no longer deferred for stories.)
- **Finish check** — at **Finish**, a holistic scan looks for **unresolved self-corrections** the
  narrator left behind (e.g. a cross-take "1985 … no, 1987" they never Polished). It **never applies
  silently** — it *offers* ("tidy these up?") with a preview; accepting runs a Polish, declining ships
  the words as-is. Same **detect-and-offer** discipline as the **Ask suggestion** and **Follow-up
  decision record** (surfaced/stayed-silent is itself recorded).
- **The pass-scope invariant** — *automatic passes (Transcription, Cleanup) see exactly one take; every
  holistic pass is human-confirmed (the ✨ Polish button or the Finish check) — never silent.* This is
  why appending a take can never silently rewrite earlier words: nothing automatic is ever holistic,
  and nothing holistic is ever unconfirmed.
- **Correction** — the narrator's own **hand-edit** in the editor. The human-authored layer; it wins
  over any AI stage and survives later appended takes.
- **Asker-avatar** — the asker's actual recording (voice now; face/video later) delivered to the
  teller in-session, so the narrator hears the real relative ask rather than a synthetic voice. The
  asker opts in per Ask (`deliveredToTeller`); if they don't, the teller gets the text. The
  recording is a Media linked to the Ask — immutable and undetachable while the Ask lives, removed
  only when the Ask is deleted (ADR-0008; consent scope deferred; until designed it
  travels asker→teller only, not family-wide).

## Engagement & notification
- **Notification** — an outbound message the system pushes to a Person to pull them back into the
  chronicle between sessions (e.g. "a new story was shared," "someone asked you a question"). The
  counterpart to the pull-only hub. Every notification names a **channel** (`email` | `sms` |
  `voice`) reflecting how that Person is reachable; a Person's reachable channels differ by role
  (a member reads email; an elder narrator may only be reachable by text or phone).
- **Outbound channel** — the seam through which a Notification is delivered. A vendor seam like the
  others (interface + mock in our code; the provider SDK only in an adapter). Distinct from the
  **Magic link**, which is a *credential inside* a notification, not the delivery mechanism itself.
- **Digest** — a batched, scheduled Notification summarizing recent chronicle activity, softened and
  aggregated ("Grandma shared about Sunday dinner and 3 other stories"). Reaches the whole family —
  every member, not only the asker — to spur engagement, but is built **per recipient through the
  audited authorization read**, so each person's digest contains only what they may see, and never
  their own activity. Contrast with an event Notification, which fires on a single triggering event.
- **Notification stream** — a category of Notification a Person sets a frequency for independently
  (`every item` | `daily digest` | `weekly digest` | `off`). Three streams: **questions-for-me**,
  **answers-to-my-asks**, and **family activity** — all default to `every item` (absent preference
  means every item; `off` is first-class silence for that stream). One event may feed two streams
  (an answered Ask rewards the asker *and* enters everyone else's family-activity digest),
  de-duplicated so no one is told twice.
- **Social loop** — the retention pattern where one Person's contribution (a shared Story, an Ask)
  generates a Notification to the rest of the family, whose response (listening, asking back)
  generates the next. The family's own warmth is the fuel; no external data source is required.

## Story imagery
- **Family album** — a Family-scoped shared pool of photos. A photo in the album is visible to and
  usable by any Person sharing an **active membership** with its contributor (the same rule the
  `family` audience tier already uses). Modeled like a shared Apple/Google album: contributed, not
  owned. A photo belongs to **one *or more* family albums** (photo↔family is many-to-many, mirroring
  ADR-0010's multi-family Story targeting): the wedding *photo* can live in both Boudreaux and Carney
  just as the wedding *story* can, and attaching a photo to a Story that targets a new family
  **extends** its album membership into that family (the contributor's deliberate attach+target act is
  the consent). It still never escapes into families the contributor has *not* placed it in — NOT
  "anywhere in the system". **Every** uploaded photo lands in at least one album regardless of path
  (direct add, during story creation, during Ask creation); there is no photo stored outside an album.
  Being in a family's album *is* the contributor's consent for that family to see it — so there is no
  "private photo". (See ADR-0009.)
- **Photo import** — the single way a photo enters the album, from one of several **sources**
  (`upload` | `google_picker` | ... ). Import always **copies the bytes** into the family album
  (write-once object storage); it never stores a live reference to an external library. **Google
  Photos** is a *Picker* import backed by a connect-once **Connection**: the user authorizes once (an
  encrypted refresh token is stored so they need not re-authorize each import), then picks items in
  Google's hosted picker and we copy those bytes. No background sync, no whole-library browse — Google
  removed the broad Library-API read scopes in 2025. **Apple Photos** has no web API at all, so on web
  it is simply the OS file picker (which already offers the device photo library) — indistinguishable
  from an `upload`. A true on-device PhotoKit integration is possible only inside a future native iOS
  app and is out of scope. The photo's `source` is recorded for provenance; it changes nothing about
  how the album row behaves afterward.
- **Connection** — an account-level, revocable authorization linking a **Person** to an external photo
  **Source** (currently only Google Photos), holding an encrypted refresh token so imports need not
  re-authorize each time. **Not family-scoped** (unlike **Membership**): one Person, at most one active
  Connection per source, independent of any Family. *Connect* establishes it (OAuth, connect-once);
  *disconnect* revokes the token at the provider and deletes the stored credential. A Connection enables
  Picker imports; it never grants background access to the external library. Managed by the Person who
  owns it — surfaced in the album (where it is used) though it belongs to the Account, not the Family.
- **Contributor** — the Person who uploaded a photo. A photo has a contributor, **not an owner**:
  uploading IS consent for any family member to view or use it, and no further consent is asked to
  reuse it on any story within that family. (This is the one asset that departs from the CONTEXT
  rule "a Person owns everything expressive" — a Family-album photo is a *shared* asset with a
  contributor, not sole-owned expressive content.) Deletable by the contributor, by the family
  **steward**, and by anyone the contributor grants that permission. Deletion removes it everywhere
  it is used (any story cover/gallery loses it).
- **Story image** — a picture that **accompanies** a Story to illustrate the words (decoration
  alongside the narrative). A Story may have *several*. This is distinct from a **Subject photo**,
  which the text is *about*. Every Story image carries a **provenance** that fixes what kind of
  thing it is — never blurred:
  - **Family photo** — an authentic photograph from the family album (uploaded by any member; later,
    a linked Apple/Google library). It depicts something real; an authenticity claim is being made.
  - **Illustration** — an external, openly-licensed image chosen only to *represent* the story's
    subject (e.g. a stock photo of red beans and rice). Nobody in the family owns it; it makes **no**
    authenticity claim and the surface must label it as illustrative, never as a family photo.
- **Cover** — the single Story image shown on the story card in a feed. The others appear when the
  story is opened. Every Story image is either the cover or a non-cover member of the story's set. A
  Story with **no** attached image shows **no placeholder** on its card — a text-only card is a
  first-class layout, never a decorated-with-a-stock-blank one.
- **Suggested image** — a candidate surfaced to the narrator based on the story's content, family-
  album sources preferred over external ones. A suggestion is not attached until a narrator picks it.
  It has two surfacings, both **editor-time** (never a spoken interviewer turn — the voice loop stays
  photo-free): a **silent** ranked candidate in the photo-picker, and a **photo nudge** — an
  editor-time prompt ("you mentioned the wedding — add a photo?") that is the *system-initiated*
  ("asked") counterpart to the narrator self-attaching. Both are the same engine; the nudge merely
  frames a suggestion as a question. Suggestion is **ranking layered over browse**: a narrator can
  always browse the album and pick unaided, so the engine is additive, never a gate.
- **Caption** — the short descriptive label **on a photo itself** ("Mardi Gras with friends, 1987").
  Photo metadata on the `family_photos` row: contributor-authored, freely editable, **not a Story**,
  off every ledger (mutable presentation, like the attachment links). Addable at import, during album
  browse, or at attachment time. It doubles as **alt text** and is the primary human-authored signal
  the suggestion engine matches story text against. **Adding a caption does NOT place the photo in the
  stories feed** — only turning the photo into a Story does. (A caption is a label, not a Story — see
  ADR-0009.)
- **Story from a photo** — an ordinary **Story** whose **subject** is a photo
  (`stories.subject_photo_id`), created by a deliberate "tell the story of this photo" act (distinct
  from merely *captioning* it). Full Story — same author/approval/consent path — and it is what lands
  in the stories feed. A photo may carry a cheap **Caption** *and*, separately, be the subject of a
  **Story from a photo**; different layers. An **Ask** may likewise target one or more subject photos
  ("tell me about these"), and the answer is a Story from that photo.
- **Subject photo** — the photo a Story (or Ask) is *about* (`stories.subject_photo_id` / the
  `ask_subject_photos` join), as opposed to a **Story image**, which merely *accompanies*. The subject
  relationship is separate from the accompaniment relationship — the same photo can play either role on
  different items.

## Interviewer
- **Biographical anchors** — a named-field record on Person with known keys: `hometown`,
  `siblingContext`, `currentLocation`, `occupationSummary`, `hasChildren`, `hasGrandchildren`.
  Populated by the intake pass (direct answers) or by LLM extraction from approved stories (never
  overwrites a directly-answered field). Used by the interviewer to personalize phrasing and
  skip redundant questions.
- **Memory extraction** — the step, present in **every** capture mode, that mines what a Person said
  into what the system remembers about them: **anchor augmentation** (into still-empty anchor fields,
  as above) now, and a **broader narrator memory** later (the deferred "picture of the person" model;
  the seam is ready because transcripts are retained). Governing principle: **audit retention is
  unconditional, but memory extraction is consent-gated.** For a **Story** it fires **only
  post-approval** (a discarded or never-shared draft never feeds memory, even though its audio is
  still retained). **Intake** is the one exception — it extracts at **Save**, because answering a
  direct biographical question *is* the consent to build the profile. Best-effort throughout.
- **Intake** — a structured 6-question first pass that populates **Biographical anchors**. Run once
  during onboarding at `/hub/about-you` (after `/welcome`): one question at a time, voice-first with
  typed fallback, LLM extraction into the anchor fields. Resumable until complete; the hub reminder
  links here until the four text facts plus `hasChildren` are set (`hasGrandchildren` conditional).
  **Later edits** to anchors happen on **Profile** (direct structured fields, text-only). Intake is
  **not a Story**: no follow-ups, audience tier, or consent. Answer audio/transcript is retained for
  audit; extracted values feed the interviewer.
- **Deeplink session** — a session initiated from a notification that carries a specific `askId`.
  The interviewer routes to that Ask first, then continues into the normal session flow. Always
  priority over warm callbacks and intake.
- **Warm callback** — the interviewer's opening on turn 0 when prior stories exist: a brief,
  concrete reference to something the user said in a previous session. Makes sessions feel like
  a continuing relationship. Fires after any deeplink ask is handled; intake resumes from turn 1.
- **Follow-up** — a gentle deepening question the interviewer asks *after evaluating* an answer,
  within the same sitting, to draw out a thread the narrator just opened. Distinct from an **Ask**
  (which comes from a relative) and from a **base** question (pre-authored bank): a follow-up is
  *generated from what the narrator just said*. Its answer is another **Take** on the *same* Story,
  not a new Story. The narrator can always decline a follow-up and move on — declining is a
  first-class path, never a dead end.
- **Emotional-door rule** — the interviewer follows an emotional thread *only when the narrator
  themselves opened it*; it never manufactures an emotional probe. A follow-up on grief, loss, or
  joy is eligible only when the narrator's own words surfaced that feeling first. This is "never
  push into pain" made mechanical, and it is the one case where policy vetoes an otherwise
  high-ranked **Follow-up** candidate.
- **Follow-up thread** — an initial prompt (Ask, base, or intake) plus the follow-ups it spawns and
  their takes, all resolving to **one Story and one approval**. A thread of length one (no
  follow-up asked) is exactly today's one-answer behaviour.
- **Follow-up decision record** — the append-only audit trail of every follow-up turn: the answer
  that was evaluated, *all* candidate threads the evaluation proposed with their tags, the
  disposition of each (kept or dropped, with a coded reason), the one selected, the line the
  narrator heard, and what the narrator did (answered / skipped / off-ramped). Nothing is discarded
  without a recorded reason — the same append-only-provenance discipline as the **Consent ledger**
  and the L1→L2→L3 prose revisions.
- **Ask suggestion** — compose-time coaching on a *drafted* Ask: the AI evaluates the asker's own
  question against the same "good question" rubric the interviewer holds *itself* to (open-ended,
  concrete, non-leading, never yes/no) and *offers* a better wording. **Detect-and-offer**: silent
  unless a clear rule violation is caught (e.g. a yes/no question). NEVER auto-applied — the asker
  accepts or keeps their own. This is the *opt-in* case of the **Ask**'s "never reworded" rule: the
  guarantee is against *silent* rewording, so an asker who taps to accept has *adopted* new words
  (they become the asker's own); reject and the original is sent verbatim. Distinct from a
  **Follow-up** (asker not narrator; before-send not after-answer; a suggested edit not a spoken
  turn). Its own on/off control, independent of narrator follow-ups. Same audited-disposition
  discipline (surfaced / stayed-silent) as the **Follow-up decision record**.

## Explore (Mode 4 — the payoff surface)
- **Explore surface** — the read/browse side of the chronicle (Mode 4): where members read, listen,
  and wander. **Exploring is an action/lens, not a user type** (like Narrating and Asking) — the same
  rich surface serves the curious grandchild and the elderly narrator alike; simplifications for an
  elder are options layered *on top*, never a lesser or separate surface. Every explorer is an
  **authenticated member** with an authorization disposition; there is no anonymous/external viewer
  and **no external sharing** in v1 (the `public` tier remains a stored seam with no read surface,
  so external sharing is not irreversibly prohibited — just not built). Everything Explore shows is
  read through the **single front door**; it adds no new authorization, only new *shapes* of the same
  authorized read, and is **family-scoped** — an explorer sees all content they are authorized to see
  across all their families in one login, filterable to a single family. See ADR-0011.
- **Story feed** — the reverse-chronological (by recording time) stream of stories an explorer may
  see. A view over the visible-story projection; not a new artifact. The per-viewer "New" badge rides
  the existing `story_views` read-state.
- **Timeline** — the same visible stories arranged by when they are *about* (their **Story date**,
  ADR-0026), not when recorded. Stories with no date gather in an explicit **Undated** section
  (never silently dropped). Default scope is one narrator's life; a whole-family toggle is the same
  projection widened.
- **Chronicle search** — keyword/full-text search *within* the stories an explorer may see (title,
  summary, transcript, prose, tags, place label). DISTINCT from **Family search**, which finds a
  *discoverable family to join*: chronicle search reads inside families you are already in; family
  search finds new families. Opposite directions.
- **Ask the archive** — a read-only question answered from the chronicle the explorer may already
  see. **NOT an Ask**: it targets the corpus, creates no Story, waits for no human, writes no consent
  event. Its one link to Ask is the **escalation** — when the archive has no answer, it offers to send
  a real Ask to the relevant narrator (closing the loop). The Q&A synthesis engine is deferred (its
  grounding corpus must equal the per-viewer visible projection or it becomes a consent leak); v1
  ships **Chronicle search** only.
- **Clip** — a time-range selection over a Story's canonical recording `(story, start, end)`, **not a
  new Media** (no re-encode, no new consent artifact) — a way to point at a moment. Trimming UI and
  any external sharing are deferred; v1 exploration is in-app and whole-story.
