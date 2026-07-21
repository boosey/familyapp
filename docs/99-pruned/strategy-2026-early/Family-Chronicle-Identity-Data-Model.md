# The Multi-Family Identity & Data Model — A Decision Doc

*Companion to the North Star Vision, Personas, Journey Map, Engagement Engine, Consent & Estate Framework, and Release Roadmap. This resolves the foundational question the vision flagged and the roadmap deferred to Phase 0: does a person carry one archive through life, or belong to many family chronicles at once? The answer shapes the identity graph, and the identity graph is the single most expensive thing to retrofit. This doc shows the options, makes a recommendation, and walks the edge cases.*

---

## The problem, stated plainly

The vision names this as one of two foundational questions the chronicle frame forces: *"Families are overlapping webs, not clean trees. A marriage merges two chronicles; a divorce splits one; a child belongs to several lineages at once. Does a person carry one archive through life, or belong to many family chronicles simultaneously?"*

The earlier elder/younger framing let the product ignore this — there was just "the elder" and "the family." But the perpetual-chronicle frame surfaces it immediately, because a chronicle that runs for decades will inevitably span marriages, divorces, blended families, adoptions, and estrangements. Get the model wrong and you face one of two failure modes:

- **Too rigid (one clean tree):** a person's stories are trapped in one family. A grandmother who is loved by both her children's families can only "belong" to one. A child of divorce has to pick a side. The model fights reality.  
- **Too loose (everything shared):** stories leak across family boundaries that should stay separate. An ex-spouse sees stories that were never meant for them. Privacy — the thing the Consent & Estate Framework exists to protect — breaks.

The right model has to hold a messy human truth: **a person is one continuous self, but they participate in many family contexts, and what they share can differ in each.**

---

## The key insight: separate identity from membership

Most of the difficulty dissolves once you stop conflating two things that feel like one:

**Identity — who a person *is*.** A single, continuous person across their whole life. Eleanor is one Eleanor, whether you meet her as a mother, a grandmother, an ex-wife, or a mother-in-law. Her stories, her voice, her recordings, her consent preferences — these belong to *her*, the person, not to any family.

**Membership — which family contexts a person *participates in*.** A person belongs to one or more family chronicles (or branches within them). Membership is a relationship, not an identity. Eleanor can be a member of her own family's chronicle, her son Marcus's branch, and — after her daughter married in — a second family's chronicle, all at once.

The product's earlier framing treated "the elder" and "the family" as a single unit. The chronicle frame forces them apart: **the person is the durable atom; the family is a context the person belongs to.** Once identity and membership are distinct, marriage, divorce, and blended families stop being special cases and become ordinary changes in membership — the person stays the same; their memberships change.

---

## The candidate models

Three architectures, in increasing fidelity to how families actually work.

### Model A — One person, one family (the clean tree)

Each person belongs to exactly one family chronicle. Simple, fast to build, easy to reason about.

*Why it's tempting:* it's the simplest possible Phase 0, and most families starting out *are* a single household. *Why it fails:* it breaks at the first marriage. A person who marries into another family must either abandon their birth family's chronicle or be duplicated. A child of divorce belongs to two lineages the model can't represent. It fights the vision's explicit "overlapping webs" reality and would have to be torn out the moment the product met a real extended family. **Rejected** — it's the "too rigid" failure mode by design.

### Model B — One person, many families (person-centric identity + membership)

A person is a single durable identity. Families are separate chronicles. A **membership** links a person to a family, and a person can hold many memberships at once. Stories belong to the person; the person chooses which family contexts each story is visible in.

*Why it works:* it matches reality without leaking. Eleanor is one person who participates in two families; a child of divorce is one person who belongs to both parents' chronicles; an ex-spouse simply loses a membership without anyone's stories being deleted or duplicated. It's the natural home for the Consent & Estate Framework, because consent and audience tiers already attach to the person and the story — membership just defines the available audiences. **Recommended.**

### Model C — Federated chronicles (every family fully sovereign, stories negotiated across)

Each family is a wholly independent chronicle with its own governance, and shared people/stories are synced or negotiated across family boundaries by agreement.

*Why it's tempting later:* maximum family sovereignty and a clean answer to "whose data is it." *Why it's wrong now:* it's enormously more complex — distributed consent, cross-chronicle conflict resolution, sync semantics — and solves problems the product won't have until it's large. It's a plausible *future* evolution of Model B, not a starting point. **Deferred** — build Model B with seams that could later federate, don't pay for C up front.

---

## Recommendation: Model B — person-centric identity, multi-membership

Build a model where **the person is the durable atom and family membership is a separate, plural relationship.** Concretely, four ideas carry the whole design:

**1. The Person is permanent and singular.** One identity per human, holding their stories, recordings, voice, and personal consent preferences. A person exists independently of any family — which is also what lets a person carry their archive through life, across every membership change.

**2. A Family (Chronicle) is a context with its own governance.** Each family chronicle has its own steward, membership, and permission tiers (the Consent & Estate Framework's machinery). Branches can exist within a family for finer-grained audiences.

**3. Membership links a Person to a Family — and is plural and revocable.** A person can belong to many families at once. Membership carries a role (narrator, steward, member, in-law) and can be added (a marriage, a birth, a reconnection) or ended (a divorce, an estrangement) without touching the person's identity or stories.

**4. A Story belongs to its Person, and is *surfaced* into family contexts by audience tier.** This is the crucial move. A story is authored once, owned by the person, and carries an audience tier (private / branch / family / public, per the Consent & Estate Framework). Which families it appears in is a property of its visibility, not a copy. One story, authored once, can be visible in two family chronicles — or in neither but the author's private space — and the author (and relevant steward) controls that. No duplication, no leakage, no forced choice.

The elegance: **identity answers "carry one archive through life," membership answers "belong to many families at once," and the audience tier answers "what's shared where."** The vision's either/or ("one archive *or* many families") turns out to be a false choice — the right model is *one person, one archive, many memberships, per-story visibility.*

---

## How stories, consent, and permissions attach

This model slots directly into the Consent & Estate Framework rather than complicating it:

- **Consent attaches to the person and the story**, exactly as the framework already specifies — not to the family. A person's "their words only" guarantee, their living/deceased status, and their personal preferences travel with *them* across every membership.  
- **Audience tier attaches to the story** and is evaluated *within each family membership.* "Family" visibility means "the families this story is shared into," and the author chooses which memberships count. A story can be "family" in Marcus's chronicle and "private" everywhere else.  
- **Stewardship attaches to the family**, and each family's steward governs only that family's view. No steward can reach a person's private material or another family's stories. Custody hand-off (the story will) happens per family, while the person's own posthumous wishes travel with the person.

The result is that the hardest privacy questions — *can my ex-husband see this? can my daughter's in-laws? what happens to my stories if I leave?* — all have clean answers, because identity, membership, and visibility are three separate dials instead of one tangled one.

---

## Walking the edge cases

The test of an identity model is the messy cases. Each one below is *ordinary* under Model B — a change in membership or visibility, never a special schema.

**Marriage (two chronicles merge-ish).** Eleanor's daughter marries into the Reyes family. The daughter gains a *membership* in the Reyes chronicle while keeping her membership in the Boudreaux chronicle. Nothing merges destructively; she's simply one person now participating in two families. Stories she chooses can be surfaced into both.

**Divorce (a chronicle splits).** The daughter and her spouse later divorce. The relevant memberships end. Neither person's identity or stories are deleted or duplicated — they each simply lose a membership in the other's family. Stories previously shared into the now-ex family can have their visibility revoked going forward, governed by the author and steward. The person carries their whole archive out intact.

**Blended family.** A child has a biological parent, a step-parent, and ties to two households. The child is one person with memberships in multiple family chronicles and branches. They never have to "pick a side"; the model represents all their lineages at once, which is precisely the vision's "belongs to several lineages" case.

**Adoption.** An adopted person holds membership in their adoptive family, and — if and only if they choose and consent — can also hold ties to a birth family. Identity stays singular and theirs; memberships reflect whatever relationships they affirm.

**Estrangement.** A person cuts contact with a relative. The membership can be paused or scoped so the estranged relative loses access to that person's stories, without deleting anyone or fracturing the chronicle. Visibility is a dial, not a demolition.

**A person beloved by two families.** A grandmother adored by both her children's separate families is a *member of both* and can surface the same cherished stories into each — authored once, visible in two places, owned by her. Model A literally cannot represent this; Model B does it natively.

**Death.** The person's identity persists as a permanent record; their posthumous wishes (from the story will) travel with the person and govern all families they belonged to. Each family's steward honors those wishes within that family's context. The avatar consent gate reads the person's ledger, not any single family's.

---

## What to build in Phase 0 (and what to defer)

The Release Roadmap puts the identity graph in Phase 0 and warns it's the most expensive thing to retrofit. Concretely:

**Build now (Phase 0):**  
- The **Person** as a first-class, permanent, singular entity that owns stories, media, and personal consent — independent of any family.  
- **Membership** as a separate, plural, revocable relationship between Person and Family, carrying a role.  
- **Story** ownership by Person, with an **audience tier** evaluated per membership — so visibility is a property, never a copy.  
- These three dials (identity, membership, visibility) cleanly separated. This is the seam that makes every edge case ordinary.

**Defer (but leave seams for):**  
- Full **federation** (Model C) — only if/when families demand total sovereignty at scale.  
- Cross-chronicle **conflict resolution and sync** — not needed until shared stories span independently governed chronicles.  
- The deepest **multi-lineage genealogy** representation — the tree skeleton can deepen in Phase 3 (enrichment); Phase 0 needs only enough relationship structure to support membership.

The discipline mirrors the rest of the roadmap: build the durable atoms and the clean separations now, defer the heavy distributed machinery until the product is large enough to need it — but make sure today's model can grow into tomorrow's without a teardown.

---

## The one-line answer

The vision asked: *one archive, or many families?* The answer is **both, by separating them**: **one person, one archive, many memberships, and per-story visibility.** Identity is singular and durable; family is a context you belong to plurally; and what's shared where is a dial the person controls. That single separation turns marriage, divorce, blended families, adoption, and estrangement from architectural nightmares into ordinary, well-governed changes — and it drops straight into the consent model already designed.  
