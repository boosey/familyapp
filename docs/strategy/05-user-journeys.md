# User Journeys

## Journey map overview

```
         ┌─────────────┐
         │  Discover   │  Landing, invite, find family
         └──────┬──────┘
                ▼
         ┌─────────────┐
         │   Join      │  Sign up, welcome, about-you
         └──────┬──────┘
                ▼
    ┌───────────────────────────┐
    │         Hub               │
    │  Stories · Album · Family │
    │       · Questions         │
    └───────────┬───────────────┘
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
  Tell/     Browse/     Ask/
  Answer    Listen      Invite
     │          │          │
     └──────────┴──────────┘
                ▼
         ┌─────────────┐
         │   Share     │  Consent + family targeting
         └─────────────┘
```

---

## 1. New member — create a family

1. Visit `tellmeagain.app` → **Start your family**
2. Sign up (Clerk or mock dev auth)
3. `/auth/callback` provisions Account + Person
4. `/families/new` — name family, optional discoverable toggle
5. `/welcome` — confirm name and birthday (voice or type)
6. `/hub/about-you` — six biographical intake questions
7. Land in `/hub` — empty states with CTAs to invite and tell

**Steward is set** to the creator automatically.

---

## 2. New member — invited

1. Receive invite link `/join/[token]` (email, SMS, or copied link)
2. Confirm relationship label
3. Sign up or sign in (Clerk) — pending-invite cookie links acceptance
4. `/welcome` → `/hub/about-you` → `/hub`
5. Membership active; may see pending asks queued during invite (ADR-0006)

---

## 3. New member — find and request to join

1. `/families/find` — search discoverable families
2. Submit join request
3. Steward approves in `/hub?tab=requests`
4. Requester reaches hub (may be pending-only until approved)

---

## 4. Tell a story (signed-in)

1. Hub → **Tell a story** or `/hub/tell`
2. Optional: started from album photo ("tell the story of this photo")
3. Record one or more takes (voice) or type text
4. Each voice take: transcribe + cleanup runs inline → prose appends
5. Edit prose freely; optional ✨ Polish (whole text, confirmed)
6. **Finish** — metadata derived; optional finish-check for cross-take corrections
7. Choose audience tier + target families → **Share**
8. Story appears in family feed; consent ledger row written

---

## 5. Ask → Answer → Hear (core family loop)

### Asker side

1. `/hub?tab=ask` — pick person, write question, optional photos
2. Ask suggestion may offer better wording (detect-and-offer; never silent)
3. Ask queued for narrator
4. Track in **Your asks** — status: queued → answered

### Narrator side (signed-in)

1. **To answer** queue shows pending question
2. `/hub/answer/[askId]` — record takes, same composing surface as tell
3. Finish → Share with audience + family targets
4. Ask marked answered; story linked

### Narrator side (account-free link)

1. Inviter shares `/s/[token]` personal link
2. Narrator sees next ask or starter prompt
3. Hold-to-record → pipeline processes
4. `/s/[token]/approve/[storyId]` — listen + **voice approve** sharing tier
5. Story shared per consent

### Narrator side (magic link, has account)

1. `/a/[token]/[askId]` — establishes session → redirects to `/hub/answer/[askId]`
2. Same tap-to-share flow as signed-in

---

## 6. Browse and engage

1. **Stories** — feed, timeline, or search; filter by family
2. Open story — listen, read prose, view photos
3. Like or favorite; highlight text to treasure
4. Ask follow-up question (creates new Ask)
5. **Album** — browse photos; ask or tell from a photo
6. **Person page** — stories contributed, photos, mentions

---

## 7. Family tree and kinship

1. **Family** tab → tree or list view
2. Add relative — creates Person (may be `mention` origin) + kinship edges
3. Steward may affirm/deny/correct edges; subject may hide edge about themselves
4. Unplaced members — place in tree or mark not family
5. Invite from tree — member or narrator link

---

## 8. Steward governance

1. **Requests** — approve/decline join requests
2. **Family settings** — name, short name, discoverable flag
3. **Kinship** — affirm, deny, correct assertions
4. **Moderation** — delete inappropriate stories/photos (steward power)
5. **Invite** — narrator link or member invite with relationship

---

## 9. Onboarding intake and profile

| When | Surface | Purpose |
|------|---------|---------|
| First sign-on | `/hub/about-you` | Voice/text intake → biographical anchors |
| Anytime later | `/hub/profile` | Edit anchors, spoken name, demographics |
| Anytime | `/hub/settings` | Device-local display preferences |

Intake is **not a Story** — no consent tier; extracts anchors at Save.

---

## Capture path comparison

| Path | Auth | Record | Approve | Full hub |
|------|------|--------|---------|----------|
| Hub tell/answer | Account | Composing surface | Tap + Share | ✅ |
| Magic link | Auto-login | Same as hub | Tap + Share | ✅ |
| Link session `/s/[token]` | Token only | Simple recorder | Voice approve | ❌ |

**Design intent:** Account-holding family members use the **full app**. Link session is for relatives who will never sign up — not the primary path for engaged members.

---

## Dev fast path

1. `/dev/seed` → Reseed
2. `/dev/sign-in` → Become seeded user (e.g., Sofia Boudreaux)
3. `/hub` — populated family with stories, asks, tree

Zero external services in local dev (PGlite, mock AI, mock auth).
