/**
 * The base question bank — the in-house data file the interviewer draws from when no Ask is
 * pending and no follow-up thread is open. Sequencing rules live in the picker (`turn-loop.ts`);
 * this file is just structured data.
 *
 * Categories follow the spec's life-bins (childhood, family of origin, education, work, love
 * and marriage, parenthood, migration, historical events, traditions, faith and values,
 * hardships, hobbies and friendships, places lived, advice and legacy).
 *
 * Each question carries:
 *   - `category` — used by de-dup vs. the narrator's prior tags.
 *   - `sensitivity` — `low` (safe opener, e.g. childhood food), `medium` (work, marriage),
 *     `high` (loss, hardship, faith doubts). Sensitive items are GATED behind a rapport
 *     threshold in the picker; the picker NEVER asks `high` until enough rapport turns have
 *     completed AND the narrator hasn't signalled an off-ramp.
 *   - `lifePhase` — coarse age bin the question PROBES, not the narrator's current age. The
 *     picker weights toward the reminiscence bump (roughly ages 10–30) by preferring
 *     `childhood` and `young_adult` items when picking from the base bank.
 *   - `text` — the topic seed, written open-ended, concrete, non-leading per spec. The LLM
 *     phraser re-renders this in the warm persona; the seed itself is not what the narrator hears.
 *
 * ABSOLUTE DRAFTING RULES (so a future contributor doesn't drift):
 *   - Open-ended ("Tell me about…", "What was it like…"). NEVER yes/no, NEVER leading.
 *   - Concrete and grounded (a place, a person, a year), not abstract ("What is happiness?").
 *   - Non-judgmental phrasing — no "should", no implied moral framing.
 *   - One question per item; no compound asks ("Tell me about X — and also Y").
 */

export type QuestionCategory =
  | "childhood"
  | "family_of_origin"
  | "education"
  | "work"
  | "love_and_marriage"
  | "parenthood"
  | "migration"
  | "historical_events"
  | "traditions"
  | "faith_and_values"
  | "hardships"
  | "hobbies_and_friendships"
  | "places_lived"
  | "advice_and_legacy";

export type Sensitivity = "low" | "medium" | "high";

export type LifePhase = "childhood" | "young_adult" | "midlife" | "late_life" | "spanning";

export interface BaseQuestion {
  id: string;
  category: QuestionCategory;
  sensitivity: Sensitivity;
  lifePhase: LifePhase;
  text: string;
}

/**
 * The bank. Order is irrelevant — the picker selects by category + sensitivity + reminiscence
 * weighting. Phase 1 ships a sturdy starter set; expanding the bank is a data change, not code.
 */
export const QUESTION_BANK: ReadonlyArray<BaseQuestion> = [
  // ---------- Childhood (reminiscence-bump zone) ----------
  {
    id: "child_home",
    category: "childhood",
    sensitivity: "low",
    lifePhase: "childhood",
    text: "Tell me about the house you grew up in — what do you remember most about it?",
  },
  {
    id: "child_food",
    category: "childhood",
    sensitivity: "low",
    lifePhase: "childhood",
    text: "What's a meal from when you were a child that you can still picture clearly?",
  },
  {
    id: "child_play",
    category: "childhood",
    sensitivity: "low",
    lifePhase: "childhood",
    text: "How did you and the other kids spend a whole afternoon when school let out?",
  },
  {
    id: "family_origin_table",
    category: "family_of_origin",
    sensitivity: "low",
    lifePhase: "childhood",
    text: "Who was at the table when you were small, and what was a typical evening like?",
  },
  {
    id: "family_origin_sibling",
    category: "family_of_origin",
    sensitivity: "medium",
    lifePhase: "childhood",
    text: "Tell me about a brother, sister, or cousin you were close to growing up.",
  },

  // ---------- Education & young adult (reminiscence-bump zone) ----------
  {
    id: "school_teacher",
    category: "education",
    sensitivity: "low",
    lifePhase: "childhood",
    text: "Was there a teacher who made a difference to you? What were they like?",
  },
  {
    id: "school_friends",
    category: "education",
    sensitivity: "low",
    lifePhase: "young_adult",
    text: "Tell me about the friends you had in your school years.",
  },

  // ---------- Work ----------
  {
    id: "first_job",
    category: "work",
    sensitivity: "low",
    lifePhase: "young_adult",
    text: "What was your first paying job, and what do you remember about your first day?",
  },
  {
    id: "career_pride",
    category: "work",
    sensitivity: "medium",
    lifePhase: "midlife",
    text: "Looking back on your working years, is there a stretch you're particularly proud of?",
  },

  // ---------- Love & marriage (reminiscence-bump zone) ----------
  {
    id: "meeting_partner",
    category: "love_and_marriage",
    sensitivity: "medium",
    lifePhase: "young_adult",
    text: "If there's someone you spent your life with — how did the two of you first meet?",
  },
  {
    id: "wedding_day",
    category: "love_and_marriage",
    sensitivity: "medium",
    lifePhase: "young_adult",
    text: "If you were married, tell me about that day — even the small details.",
  },

  // ---------- Parenthood ----------
  {
    id: "first_child",
    category: "parenthood",
    sensitivity: "medium",
    lifePhase: "midlife",
    text: "If you had children, what do you remember about the first time you held one of them?",
  },

  // ---------- Migration / places lived ----------
  {
    id: "moving_away",
    category: "migration",
    sensitivity: "medium",
    lifePhase: "young_adult",
    text: "Was there a move — a town, a country — that changed things for you?",
  },
  {
    id: "place_belonging",
    category: "places_lived",
    sensitivity: "low",
    lifePhase: "spanning",
    text: "Is there a place that has always felt like yours? What's it like?",
  },

  // ---------- Historical events ----------
  {
    id: "historical_witness",
    category: "historical_events",
    sensitivity: "medium",
    lifePhase: "spanning",
    text: "Is there a big event in the world's history that you remember exactly where you were?",
  },

  // ---------- Traditions ----------
  {
    id: "holiday_tradition",
    category: "traditions",
    sensitivity: "low",
    lifePhase: "spanning",
    text: "Tell me about a holiday or tradition your family kept that you still think about.",
  },

  // ---------- Faith & values ----------
  {
    id: "guiding_value",
    category: "faith_and_values",
    sensitivity: "medium",
    lifePhase: "spanning",
    text: "Is there something you came to believe over time that you'd want others to know?",
  },

  // ---------- Hardships (HIGH sensitivity — rapport-gated) ----------
  {
    id: "hard_year",
    category: "hardships",
    sensitivity: "high",
    lifePhase: "spanning",
    text: "If you're up for it, was there a stretch of your life that was particularly hard? Only as much as you want to share.",
  },
  {
    id: "loss_remembered",
    category: "hardships",
    sensitivity: "high",
    lifePhase: "spanning",
    text: "Is there someone you've lost whom you'd like the family to remember? What were they like?",
  },

  // ---------- Hobbies & friendships ----------
  {
    id: "hobby_love",
    category: "hobbies_and_friendships",
    sensitivity: "low",
    lifePhase: "spanning",
    text: "What's something you've loved doing — for its own sake — over the years?",
  },
  {
    id: "old_friend",
    category: "hobbies_and_friendships",
    sensitivity: "low",
    lifePhase: "spanning",
    text: "Tell me about a friend you've kept the longest. What's a memory you have of them?",
  },

  // ---------- Advice & legacy ----------
  {
    id: "advice_young_self",
    category: "advice_and_legacy",
    sensitivity: "medium",
    lifePhase: "late_life",
    text: "If you could tell your younger self one thing, what would it be?",
  },
  {
    id: "advice_grandchildren",
    category: "advice_and_legacy",
    sensitivity: "low",
    lifePhase: "late_life",
    text: "What do you hope your grandchildren — or the family to come — will know about you?",
  },
];

/**
 * The reminiscence bump (ages roughly 10–30) is over-represented in autobiographical memory
 * and produces the richest, most self-defining stories. The picker uses these lifePhases as a
 * "prefer first" set when picking from the base bank — set membership rather than a numeric
 * weight, so the policy is auditable as a list of categories rather than tuned magic numbers.
 */
export const REMINISCENCE_BUMP_PHASES: ReadonlySet<LifePhase> = new Set<LifePhase>([
  "childhood",
  "young_adult",
]);
