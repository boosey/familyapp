# User Personas — Guided Narration Use Case (Mode One)

> ⚠️ **Superseded for product framing.** Personas here are elder-centric snapshots of Mode 1. Current roles and personas: **`docs/current/03-users-roles-and-personas.md`**.

*Companion to the North Star Vision. Covers the first use case: capturing one person's life history in collaboration with the rest of their family. Four personas map to the four human roles in this flow — the narrator (Mode 1), the initiator/organizer (Mode 3), the curious audience-member (Mode 4), and the family steward (Mode 5). These personas happen to be an elder and her younger relatives — a common starting constellation — but the roles are age-neutral: a narrator can be any age, and asking, organizing, and stewarding are not the province of the young. Roles rotate over a lifetime; these are snapshots of who each person is at the moment they meet the product.*

---

## How to read these personas

Each persona is written for design and product decisions, not marketing. The fields are consistent so they can be compared side by side:

- **Snapshot** — who they are in one breath  
- **Modes they live in** — which interaction modes from the vision this person actually touches  
- **Goals** — what success looks like to them  
- **Frustrations & fears** — what makes them quit, hesitate, or never start  
- **Tech comfort** — honest assessment of what they can and can't do  
- **Accessibility & emotional needs** — the constraints the UX must respect  
- **A day-in-the-life scenario** — the moment the product enters their life  
- **Key flows they must nail** — the specific interactions that make or break adoption  
- **What motivates them (research grounding)** — the deeper psychological driver, tied to the evidence base  
- **Design implications** — what this persona demands of the product

A note on the set: the narrator is the subject, but the initiator (here, a younger relative) is usually the *buyer* and the *engine*. The product fails if either one is neglected — the narrator's comfort earns the stories, the initiator's momentum keeps them coming.

---

## Persona 1 — Eleanor, the Narrator (Mode 1)

**"I'm happy to talk. I just don't want to fuss with a computer."**

### Snapshot  
Eleanor is 81, widowed four years ago, living independently in the house she and her husband bought in 1971. She has a rich life to tell — a childhood on a farm, a first job she's proud of, a marriage, four children, a move across the country — but she has never written any of it down. She's not in a hurry, and she's mildly suspicious that anything involving "an app" will be more trouble than it's worth. She loves talking to her family on the phone and lights up when a grandchild asks about the old days. Eleanor is elderly and prefers a stripped-down, login-free way in — but that is a fact about *her*, not an assumption the product makes about narrators. A narrator can be any age, and the simplified, account-free path she relies on is one preference the product offers, not the definition of the role.

### Modes she lives in  
Almost entirely **Mode 1 (Guided Narration)**. The system leads; she answers. She occasionally lands in Mode 4 when a grandchild shows her something the family added, but she is never asked to navigate, manage, or administer anything.

### Goals  
She wants to feel listened to, not processed. She wants her stories to reach her grandchildren and great-grandchildren in her own voice. She wants to be the author of her own story — to approve what's shared and correct what's wrong. Underneath it all, she wants to know her life added up to something and will be remembered.

### Frustrations & fears  
Anything that feels like homework will end her participation — a login, a password, a download, a "fill this out." She's afraid of looking foolish or "doing it wrong" in front of family. She worries about privacy: who can see this, and could it be used against her or her family. She tires more easily than she used to and dislikes being rushed or interrupted. Some memories are painful, and she fears being pushed into them.

### Tech comfort  
Low to moderate, and uneven. She can answer a phone (including a landline), tap a single large button on a tablet a grandchild handed her, and follow a spoken instruction. She cannot reliably manage accounts, multi-step menus, small text, or anything requiring her to remember a sequence. She will not troubleshoot — if it doesn't work the first time, she stops.

### Accessibility & emotional needs  
Large, high-contrast type and scalable fonts. Slow, clear, adjustable-rate speech. Generous pacing with real tolerance for long pauses — silence is thinking, not a cue to jump in. Captions on any video. A consistent, warm persona and the same voice every session so it feels like a relationship, not a tool. Always-available exits: "let's skip that," "pause," "let's talk about something happier." She must never feel she's "using software."

### A day-in-the-life scenario  
On a Tuesday at 10am — a time she chose — her tablet rings with a gentle chime, or the phone rings. A familiar warm voice greets her by name: "Good morning, Eleanor. Last week you started telling me about the farm and your sister Rosa. I'd love to hear more whenever you're ready." She settles into her chair with coffee and just talks for twenty minutes. When she trails off, the voice waits. When she says "that's enough for today," the session ends gently. She never touched a keyboard.

### Key flows they must nail  
Zero-friction entry — one tap on a link, an inbound phone call she just answers, or an always-on home device with no login or download. The system calls *her* at a consistent time she set with help. The AI initiates and carries all cognitive load. Voice-only review and editing ("actually, that was 1952, not 1953"). A graceful, dignified way to skip or stop at any moment.

### What motivates them (research grounding)  
Eleanor is at Erikson's ego-integrity-versus-despair stage. Building a coherent, accepted life narrative is a genuine developmental task of her age — and the evidence (Pinquart & Forstmeier's meta-analysis of 128 studies) shows structured life review produces moderate improvements in ego-integrity and depression. Her drive to pass wisdom to her grandchildren is generativity. The product isn't extracting content from her; it's supporting meaning-making she's already wired to want.

### Design implications  
Every required login on a narrator's link-session side is a bug, not a feature. The interview engine must be built on oral-history and reminiscence technique — open-ended, concrete, non-leading, one question at a time — not generic chatbot patterns. Preserve and foreground her actual voice; synthesized prose is secondary to the recording. Build the consent and emotional-safety rails first. The narrator is the source of everything; protect that experience above all.

---

## Persona 2 — Marcus, the Initiator / Organizer (Mode 3)

**"Mom won't be around forever, and nobody's writing any of this down. I want to fix that before it's too late."**

### Snapshot  
Marcus is 52, Eleanor's son, a working professional with kids of his own. He's the one who notices time passing — who realized after his father died that a whole side of the family's story went with him. He's comfortable with technology, busy, and motivated by a quiet urgency. He'll buy the product, set it up, nudge his mother gently, and submit questions he's always wanted to ask. He is the **buyer** and the **engagement engine**, but he is not the storyteller — yet.

### Modes they live in  
Primarily **Mode 3 (Interviewer / Curious Relative)** — submitting questions, steering what gets captured, co-piloting the occasional live call. He sets up Mode 1 for his mother. Over time he drifts into **Mode 2 (Real-Time Capture)**, recording his own present, and eventually toward **Mode 5 (Steward)**. Right now, his job is to start the engine and keep it running.

### Goals  
He wants to capture his mother's stories before they're lost — that's the urgent, finite mission that gets him to sign up. He wants it to be genuinely easy *for her*, because he knows she'll quit if it's not. He wants to ask the specific questions he cares about ("How did you and Dad actually meet?") and to involve his own kids so the stories land with them. He wants reassurance the archive is safe, private, and durable.

### Frustrations & fears  
He's tried before — a blank journal, a "tell me your stories" book — and it went nowhere because it required his mother to do work she'd never do. He's afraid of nagging her or making her feel like a chore. He's time-poor and will abandon anything that demands heavy ongoing effort from him. He fears setting it up wrong, or that the stories will be captured but never turned into anything his family will actually see. And he's quietly racing a clock he can't see the face of.

### Tech comfort  
High. He can install an app, manage an account, link external services, configure permissions, and handle a video call without help. He is exactly the person who should do the setup so Eleanor never has to. His constraint isn't capability; it's time and attention.

### Accessibility & emotional needs  
Standard, but he needs the product to respect *his mother's* needs — he's evaluating the whole experience through the lens of "will this work for Mom, or embarrass her?" Emotionally, he carries the weight of "before it's too late," so the product should reduce his anxiety with visible progress, gentle automation, and proof that stories are being captured and preserved.

### A day-in-the-life scenario  
Sunday evening, Marcus opens the app for five minutes. He sees his mother completed two sessions this week — there's a new story about the farm waiting for him, in her actual voice. He smiles, listens to two minutes of it, and types a follow-up question he's always wondered about: "Ask her what Grandpa was like before the war." It's queued for her next gentle session. He shares the farm story to the family thread; his daughter replies with three heart emojis. Total time: under ten minutes. The engine stays warm.

### Key flows they must nail  
Frictionless setup-on-behalf-of — he configures everything so Eleanor's side requires nothing. Asynchronous question submission that routes into her next session without him having to schedule anything. A clear, reassuring view of what's been captured and preserved. Easy sharing to the rest of the family. Light, optional nudges he controls — never spammy, never guilt-inducing toward his mother.

### What motivates them (research grounding)  
Marcus is driven by generativity — Erikson's midlife pull to establish and guide the next generation — and by a rescue instinct sharpened by loss. The vision's "true competitor is the attic" framing is *his* lived fear: the unlabeled shoebox, the relative who took the history with them. He's also unknowingly acting on the Duke/Fivush finding — children who know their family history are more resilient — which is the strongest argument for why involving his own kids matters.

### Design implications  
The initiator is the buyer; the narrator is the source. Design the purchase and setup flow around Marcus while designing the *use* flow around Eleanor — they are different humans with different needs in the same transaction. Make his ongoing effort near-zero: automate nudges, surface progress, and make sharing one tap. Give him the satisfaction of seeing stories accumulate, because his momentum is what keeps Eleanor engaged between sessions. He is the engagement engine the vision says a perpetual chronicle must manufacture.

---

## Persona 3 — Sofia, the Curious Grandchild / Audience (Mode 4)

**"Wait, Grandma did *what* before she was a grandma?"**

### Snapshot  
Sofia is 16, Marcus's daughter, Eleanor's granddaughter. She's a digital native — fluent, fast, and skeptical of anything that feels like a boring school assignment. She loves her grandmother but mostly knows her as "Grandma," not as the young woman who once worked a job she was proud of or crossed the country with four kids. When a story surprises her — when Grandma turns out to have been a whole person — she's hooked. She's the future steward of this chronicle, though she doesn't know it yet.

### Modes they live in  
Primarily **Mode 4 (Explorer / Audience)** — browsing, listening, watching, asking the archive. She dips into **Mode 3** when something sparks a question she wants to send Grandma. Decades from now she may become the **Steward (Mode 5)** and eventually a **Narrator (Mode 1)** herself. She is the payoff surface — the person the whole chronicle is ultimately *for*.

### Goals  
She wants to be surprised and to feel connected to where she came from. She wants stories that feel alive — voice, photos, a map of where it all happened — not a wall of text. She wants to ask her own questions and get real answers. Lower down, though she couldn't name it, she wants to understand herself by understanding her family.

### Frustrations & fears  
Anything that feels like homework or a museum exhibit loses her instantly. Long unbroken text is a non-starter. If it's not as easy and lively as the apps she already uses, she won't come back. She may feel awkward not knowing what to ask, or worry that her questions are too small or silly. She's privacy-aware in her own way and will notice if something feels surveillant or cringe.

### Tech comfort  
Very high — higher than anyone else in the family. She'll discover features the adults miss. Her constraint is attention and interest, not ability. If the experience is rich, she'll use it more fluently than its designers expected.

### Accessibility & emotional needs  
Mobile-first, fast, visually rich, calm rather than cluttered. Bite-sized, browsable, immersive — timeline, map, photos, audio, short clips. Emotionally she needs an easy on-ramp to participation: suggested questions so she's never staring at a blank box, and a sense that her contribution matters and is welcomed by older relatives.

### A day-in-the-life scenario  
Sofia's dad shares a two-minute clip in the family thread: Grandma, in her own voice, describing the day she got her first paycheck and what she spent it on. Sofia listens twice. She opens the family hub on her phone, scrolls the timeline, and sees a photo from that year, restored and in color. There's a prompt: "Sofia, your grandmother would love to know what *you* want to ask her." She taps a suggested question — "What music did you love when you were my age?" — and sends it. It'll reach Grandma in her next gentle session. Sofia feels, unexpectedly, close to her.

### Key flows they must nail  
A rich, immersive, mobile-first explore surface — timeline, map, tree, story feed, "ask the archive." Frictionless async questions with suggested prompts so she never faces a blank box. Easy, shareable moments — clips and stories she'd actually want to send. A sense of two-way connection: she asks, Grandma answers, the loop closes.

### What motivates them (research grounding)  
Sofia is the living proof of the Duke/Fivush "Do You Know?" finding: children and teens who know more about their family history show higher self-esteem, resilience, internal locus of control, and lower anxiety. She is *why* the audience side of the product exists and the evidence that justifies a whole-family subscription rather than a one-narrator gift. She's also the engine behind the engine — her questions are what keep Eleanor engaged between sessions, and her wonder is what keeps Marcus motivated.

### Design implications  
This persona justifies building Mode 4 as a first-class payoff surface, not an afterthought to capture. Make exploration lively and mobile-native or lose her. Lower the barrier to her participation with suggested questions and one-tap sharing — her engagement is load-bearing for the whole system. Remember she is the future custodian: the chronicle she explores at 16 is the one she may steward at 50, so the experience should quietly build attachment, not just deliver content.

---

## Persona 4 — Diane, the Family Steward (Mode 5)

**"Someone has to make sure this is handled right — and that it's still here in fifty years."**

### Snapshot  
Diane is 58, Marcus's older sister, Eleanor's eldest daughter. In every family there's one person who ends up holding things together — the executor, the keeper of the photo albums, the one everyone calls about logistics. That's Diane. She's conscientious, a little protective, and acutely aware that this archive will one day outlive her mother and needs someone to govern it: who can see what, who gets added, what's released when, and who holds the keys after she's gone.

### Modes they live in  
Primarily **Mode 5 (Steward)** — membership, permissions, custody, consent records, gap and quality review. She also participates as an interviewer (Mode 3) and audience (Mode 4), but her defining role is governance. Hers is the institutional layer the vision calls "quietly powerful, rarely touched, absolutely essential."

### Goals  
She wants the archive handled responsibly and kept safe, private, and durable across decades. She wants clear control over who sees sensitive stories — some things are for the whole family, some for one branch, some not yet. She wants her mother's wishes honored, especially around anything sensitive or posthumous. And she wants a real answer to "who holds this when I'm gone?" — a hand-off, not a single point of failure.

### Frustrations & fears  
She fears the archive becoming a digital shoebox — preserved but abandoned, with no one tending it. She fears a privacy mistake: a sensitive story reaching the wrong relative, or an in-law gaining access they shouldn't have. She's wary of anything irreversible, especially avatars or posthumous features done without her mother's clear consent. She's frustrated by tools that assume one admin forever and have no plan for succession. And she doesn't want governance to be so heavy it becomes a second job.

### Tech comfort  
Moderate to high, and careful. She'll read the permissions settings closely, ask pointed questions about data security and ownership, and want to understand what happens to everything if the company disappears. She's not a power user for its own sake, but she'll do the homework because she takes the responsibility seriously.

### Accessibility & emotional needs  
Clarity and transparency over cleverness. She needs permission and consent controls that are legible and auditable — she wants to *see* who can access what and *why*. Emotionally, she carries the duty of honoring her mother and protecting the family; the product should make her feel like a trusted custodian of a living heirloom, not an IT administrator.

### A day-in-the-life scenario  
A cousin marries into the family and asks to join. Diane opens the steward view, adds them, and grants access to the shared family stories — but not to a painful chapter her mother marked private to the immediate family. She notices the system has flagged a gap: no one has explained why the family left their hometown, and her mother once mentioned it. She queues it as a gentle question. Before closing, she reviews the consent ledger and confirms her mother's recorded wish: a voice archive is fine, but no posthumous interactive avatar. She names her daughter Sofia as the eventual successor steward. Ten minutes, and the institution is a little more secure.

### Key flows they must nail  
Granular, legible permissions — per-story privacy across private / family / branch / public. Membership management as the family grows and changes. A consent ledger that records and enforces her mother's wishes, especially around sensitive and posthumous content. Custody hand-off — naming a successor so the chronicle survives her. Gap, contradiction, and quality review surfaced gently, not as a chore.

### What motivates them (research grounding)  
Diane is acting on the vision's hardest truth: the chronicle's defining problem is longevity, not capture. Keeping a multi-decade institution alive — engagement, custody hand-off, data durability — is harder than recording stories. Her instinct to govern responsibly is what separates a perpetual family chronicle from a one-time memoir that dies in a drawer. She's also the guardian of the consent-first, "their words only" ethic the vision treats as non-negotiable, especially for avatars and anything posthumous.

### Design implications  
Build the consent and estate framework (Mode 5) before any avatar feature ships — Diane is the human who enforces it, and she needs the tools to do so. Permissions must be granular and legible, not buried. Treat custody hand-off as a core feature, not an edge case: design explicitly for "who holds the keys in eighty years." Make stewardship feel like tending a living heirloom, with automation handling the tedium so the responsibility stays light. Answer her durability questions honestly — data portability, ownership, and business continuity are part of earning her trust.

---

## Cross-persona summary

| Persona | Role | Primary mode | Buys? | Tech comfort | The one thing the product owes them |  
|---|---|---|---|---|---|  
| **Eleanor**, 81 | Narrator | Mode 1 | No | Low/uneven | Zero-friction, dignified, voice-first listening |  
| **Marcus**, 52 | Initiator / organizer | Mode 3 | **Yes** | High | Near-zero ongoing effort; visible progress |  
| **Sofia**, 16 | Audience / member | Mode 4 | No | Very high | A lively, mobile-native payoff surface |  
| **Diane**, 58 | Family steward | Mode 5 | Sometimes | Moderate/careful | Legible governance and a real succession plan |

**The load-bearing relationship:** Marcus's momentum keeps Eleanor engaged; Sofia's questions give Eleanor a reason to return; Diane keeps the whole thing safe enough that the family trusts it with their stories. Neglect any one persona and the system quietly stalls — the narrator's comfort earns the stories, the members' curiosity sustains them, and the steward's governance lets it outlive everyone in the room.  
