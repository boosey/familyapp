# Reconciled Candidate Corpus — the master list the method runs on

*Resolves [#72](https://github.com/boosey/familyapp/issues/72) under the Wayfinder map [#69](https://github.com/boosey/familyapp/issues/69). The epic-grain, deduped backlog that "Apply eligibility + coarse-rank" ([#74](https://github.com/boosey/familyapp/issues/74)) runs the two-layer method over. Companion to the Layer-1 eligibility layer and Layer-2 value rubric (`docs/wayfinder/2026-07-15-eligibility-layer.md`, `…-value-score-rubric.md`).*

Deduped across four sources: **(1)** the 18 new ideas · **(2)** Release Roadmap Phases 2–6+ · **(3)** open GitHub issues · **(4)** agent-proposed additions. Grain is **coarse epic** (two-tier rule — NOT sliced; slicing happens near the frontier at #74).

---

## Part A — Capability vocabulary (for the dependency gate)

*(Deliverable folded in from #70. The bounded token set the Layer-1 guardrail-dependency gate checks. "Shipped" = merged to `origin/master`. Status below is **provisional** — best-known from project memory; #74 must verify each against `origin/master` at run time, since that verification IS the dependency gate.)*

| Capability token | What it is | Shipped? (provisional) |
|---|---|---|
| `capture-session` | login-free link-session voice capture surface (`/s/[token]`) | ✅ |
| `interviewer-loop` | controlled turn loop + oral-history question engine | ✅ |
| `transcribe→story-pipeline` | speech-to-story synthesis, voice preserved | ✅ |
| `story-model+authorization` | core story entry + single-front-door auth | ✅ |
| `consent-ledger` | append-only consent records | ✅ |
| `people/identity-model` | persons + accounts + link-session identity | ✅ |
| `kinship-graph` | kinship edges + visual tree | ✅ (per memory) |
| `photo-storage+album` | media storage + album surface | ✅ (per memory) |
| `hub/payoff-surface` | family hub browse/explore (timeline, feed, player) | ◑ partial |
| `auth-live` | Clerk live keys / go-live (issue #9) | ❌ |
| `notification-delivery` | a channel to push per-event pings to members | ❌ |
| `governance/steward-layer` | steward console + legible permissions map | ◑ governance *actions* built; console not |
| `their-words-only-retrieval` | retrieval-integrity constraint for testimony | ❌ |
| `external-data-harness` | integration layer for external record providers | ❌ |
| `video-storage+transcode` | video media pipeline | ❌ |
| `realtime/telephony` | phone / WebRTC live channel | ❌ |
| `estate/time-gate-instrument` | time-gated release + custody hand-off | ❌ |

---

## Part B — The master corpus (coarse epics)

*Src legend: **I#n** = idea n of the 18; **RM** = Release Roadmap phase; **GH#n** = GitHub issue; **AP** = agent-proposed.*

### Capture & the core loop
| # | Epic | Sources | Notes |
|---|---|---|---|
| C1 | **Richer AI interviewer** — two-way conversation + gap-driven follow-ups | I#7, I#8, (feeds on I#12/I#15) · RM P1 behavior | Deepens the built interviewer-loop; "AI asks about what's missing" + "two-way conversation" are the same epic. |
| C2 | **Fact & context extraction from stories** — structured facts + era/context inference | I#12, I#14, I#15 | I#14 (era) is a subset. Precursor to enrichment, timeline placement, and C1's follow-ups. |
| C3 | **Narrator onboarding / setup-by-a-relative** | AP | The "get grandma set up" inviter flow — distinct from the zero-friction session itself. A first-order adoption barrier. |
| C4 | **Capture reliability & job-failure recovery** | AP · GH#11 | A failed recording kills trust in the wedge. GH#11 (durable-job failure has no DB signal) is the infra half. |
| C5 | **Native mobile app** | I#1 | RN / Expo / PWA. A channel/packaging epic. |
| C6 | **Alternative entry channels** — phone / SMS | RM P1 (deferred) | Additional narrator entry beyond the single link channel. |

### Video & richer media capture
| # | Epic | Sources | Notes |
|---|---|---|---|
| C7 | **Video capture & delivery** — asker/teller video, video answers, video-to-album | I#2, I#3 · RM P2 asker-avatar | I#2 ≈ asker-avatar (living-person clip) generalized to video answers; I#3 video-to-album rides the same pipeline. |
| C8 | **Live family video calls + extraction** | I#9 · RM P6 live co-piloted calls | Two-way conferencing with story extraction. |
| C9 | **Ambient / dinner-table capture & extraction** | I#10 · RM Mode 6 (P6), Mode 2 | Extract stories from a family conversation. Late, consent-sensitive by mechanism. |

### Payoff surface & engagement (retention)
| # | Epic | Sources | Notes |
|---|---|---|---|
| C10 | **Payoff / explore surface** — timeline, feed, gallery, audio player | RM P2 Mode 4 | Partially shipped (album live). |
| C11 | **Social layer** — reactions, comments, threaded (Slack-like) discussions | I#4, I#5 · RM Group D (P2) | I#4 social ≈ Group D; I#5 discussions is its threaded/real-time superset. Story like/favorite partly built. |
| C12 | **Follow-up questions on published stories** | I#6 · RM P1 answer-back loop, Mode 3 | Extends the built answer-back loop to already-published stories. |
| C13 | **Notifications & re-engagement** — per-event pings, weekly digest, narrator nudges | RM P2 digest (Group A) · AP | Digest (A2) + per-event delivery + narrator "record again" nudges. The heartbeat. |

### Enrichment & moat
| # | Epic | Sources | Notes |
|---|---|---|---|
| C14 | **External-data enrichment & integrations** — record match, day-in-history, gap detection | I#16 · RM P3 (Group B) | I#16 "integrations" ≈ the whole Phase-3 moat. Big; will need decomposition + a feasibility spike. |
| C15 | **Verified family tree / kinship** | RM P3 skeleton · GH#30–39 | Much of the kinship stack is built (#30–35 shipped per memory); #36–39 are deferred epics (GEDCOM import, reconciliation, challenge-flow, tree renderer). |

### Structured family data & photos
| # | Epic | Sources | Notes |
|---|---|---|---|
| C16 | **Photo face-tagging** | I#13 | Consented-subjects form only (per #70 principle). Rides `kinship-graph` + `photo-storage`. |
| C17 | **Album & upload hardening** | GH#19, GH#20, GH#21 | Direct-to-storage presigned upload (#20 blocks real uploads), album-in-hub (#19, may be shipped), EXIF-in-batch coverage (#21). |
| C18 | **Family key-dates & coordination/events** | I#17, I#18 | Birthdays/anniversaries/deaths → prompt & digest fuel (I#17); event coordination (I#18, drifts from core loop). |

### Institution & governance
| # | Epic | Sources | Notes |
|---|---|---|---|
| C19 | **Steward console & governance** | RM P4 · GH#33/#34 | Governance *actions* (affirm/deny/hide) built; the console surface + permissions map not. |
| C20 | **Custody, estate & time-gated release** | RM P4 | Story-will, successor naming, time-gated release, AI disclosure. |
| C21 | **Narrator interactive testimony** | RM P5 · (precursors I#2/I#9) | Living-first then posthumous. Mechanism-risk: needs `governance/steward-layer` + `their-words-only-retrieval`. |

### Late north-star
| # | Epic | Sources | Notes |
|---|---|---|---|
| C22 | **DNA module** | RM P6+ | Ethics-denylisted at this stage (per #70). |
| C23 | **Mysteries / geolocation / sensory prompts** | RM Group C (P6+) | Deeper multiplayer engagement. |
| C24 | **Legacy & forward-time** — time-capsules, auto-editions, documentaries | RM Group E (P6+) | |
| C25 | **Further innovations** — heritage-language, health-adjacent reminiscence, cross-family match | RM further innovations | |

### Platform / infra (adoption enablers)
| # | Epic | Sources | Notes |
|---|---|---|---|
| C26 | **Clerk go-live + webhook sync** | GH#9 (beta-blocker), GH#10 | `auth-live` capability. Gates real families existing at all. |

---

## Part C — Mapping table (the 18 new ideas → corpus / existing items)

| Idea | Name | Corpus epic | Duplicate / superset of |
|---|---|---|---|
| I#1 | native app | C5 | new (channel) |
| I#2 | asker/teller video | C7 | superset of RM asker-avatar (P2) |
| I#3 | video-to-album | C7 | rides video pipeline |
| I#4 | full social set | C11 | ≈ RM social loop Group D (P2) |
| I#5 | Slack-like discussions | C11 | superset of Group D (threaded/real-time) |
| I#6 | follow-up on published | C12 | extends RM answer-back loop (P1) |
| I#7 | AI-missing-info questions | C1 | deepens RM interviewer (P1) |
| I#8 | two-way AI conversation | C1 | deepens RM interviewer (P1) |
| I#9 | 2-way video conferencing + extraction | C8 | ≈ RM live co-piloted calls (P6) |
| I#10 | dinner-table Q&A extraction | C9 | ≈ RM Mode 6 ambient / Mode 2 (P6) |
| I#11 | **monetization** | — | **PARKED** → strategy note (Part D); not a feature |
| I#12 | fact-extraction (structured+unstructured) | C2 | enrichment precursor; feeds C1/C14 |
| I#13 | photo face-tagging | C16 | new (consented-subjects only) |
| I#14 | era inference | C2 | subset of C2 |
| I#15 | other context inference | C2 | subset of C2 |
| I#16 | integrations | C14 | ≈ RM external-data moat, Phase 3 |
| I#17 | family key-dates | C18 | new (prompt/digest fuel) |
| I#18 | family coordination/events | C18 | new (drifts from core loop) |

---

## Part D — Parked strategy note: monetization (idea I#11)

Per the map Notes and #70: **monetization is not a feature and does not enter the corpus.** It is a strategy decision — *where the wedge meets the business / pricing / paid-conversion phase* — and the roadmap already flags it as one of its **two open questions** (the buyer and the narrator are different humans; pricing should be designed around that split). The map's Out-of-scope section explicitly rules re-deciding that open question a separate effort. Recorded here so it isn't silently dropped; it is **not** ranked by this method.

*(Note the numbering collision: idea **I#11** = monetization; **GitHub issue #11** = "durable-job failure has no DB signal" — an unrelated infra item captured in corpus epic C4.)*

---

## Part E — Open issues that are already shipped (not candidates)

These GitHub issues are **open but their work is largely on `origin/master`** (per project memory) — they are *done-but-unclosed*, not backlog candidates. Flagged so #74 doesn't rank completed work. #74 should confirm against `origin/master`:

- **#45** Family filter + FamilyChips — merged (PR #55).
- **#46** `families.short_name` — merged (PR #56).
- **#30–#35** Kinship provenance / edges / add-relative / governance / subject-tagging — built & shipped (HITL-merged).
- **#19** Album-in-hub (Album tab) — likely shipped with the album enhancements.

Genuinely-pending issue work folded into the corpus: **#9/#10** (C26), **#11** (C4), **#20/#21** (C17), **#36–39** (C15, deferred kinship epics).
