# Product Overview — Tell Me Again

## One sentence

**Tell Me Again is a private family storykeeping app** where relatives record, keep, and share spoken memories — in their own voice — alongside photos and family relationships.

## What it is

A warm, member-only **family hub** with four pillars:

1. **Stories** — voice or text memories, browsed as a feed, timeline, or search
2. **Album** — shared family photos with captions, tags, and story attachments
3. **Family** — interactive pedigree tree, relative list, invites, and join requests
4. **Questions** — ask someone a question; they answer; the family hears it

The product helps families **gather stories only their relatives can tell**, preserve the **original recording**, and **decide who hears what** — without turning memory-keeping into homework.

## What it is not

| Not this | Why |
|----------|-----|
| A genealogy / DNA product | We have a family tree, but stories are the center — not records research |
| A social network | Private by default; no public feed |
| A one-time memoir gift (StoryWorth-style) | Ongoing archive, not a book that ships and ends |
| An AI grief bot | No synthetic conversations with the dead; retrieval-only posture for future avatar work |
| A phone-call service | Web/app first; telephony is a future adapter seam only |

## Positioning

**Emotional competitor:** the unlabeled shoebox in the attic — and the relative who "knew all the family history" and took it with them.

**Category neighbors:** StoryWorth, Remento, HereAfter AI — usually one-time memoir products. Tell Me Again is the **kept, growing, voice-true family archive**.

## Mission before UX

The mission is **keeping family voices for the people who come next**. UX exists to serve that mission:

- **Accessible** — large type, voice-first options, typed fallbacks everywhere, calm pacing
- **Low friction for storytellers** — especially elders who will not learn software
- **Not elder-exclusive** — any family member can tell, ask, browse, and steward

Elders are a **critical launch audience**, not the product definition. Roles (narrating, asking, exploring, stewarding) rotate across a lifetime.

## Primary interaction model (today)

| Surface | Who | How |
|---------|-----|-----|
| **Signed-in hub** (`/hub`) | Account-holding family members | Full app: tell stories, answer questions, browse, album, tree, invite |
| **Magic link** (`/a/[token]/[askId]`) | Account holders who prefer passwordless entry | Auto-login → same hub answer flow |
| **Link session** (`/s/[token]`) | Narrators without accounts | Minimal web page: record + approve; no sign-in |

**Phone calls are not built.** The capture pipeline accepts audio from any source behind an adapter; telephony (Twilio, etc.) is explicitly deferred.

## Brand

| | |
|---|---|
| Name | Tell Me Again |
| Domain | tellmeagain.app |
| Refrain | "Tell me again." |
| Tagline | Family voices, kept for the people who come next. |

Marketing copy: `docs/brand/Tell-Me-Again-Canva-Brief.md`

## Technical snapshot

- **Stack:** TypeScript monorepo, Next.js 15, React 19, Drizzle + Postgres (Neon prod, PGlite dev)
- **Auth:** Clerk in production; mock email/password in local dev
- **AI:** Groq Whisper (transcribe), Anthropic Claude (LLM), ElevenLabs (interviewer TTS seam)
- **Storage:** Cloudflare R2 (prod); filesystem (dev)
