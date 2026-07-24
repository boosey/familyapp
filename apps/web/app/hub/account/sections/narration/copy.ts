/**
 * Account › Narration — section-level copy (ADR-0029 / #351). Section-specific strings live HERE,
 * never a shared copy module. Describes how the interviewer behaves toward THIS narrator: whether it
 * asks deepening follow-up questions, and whether it suggests better wording for the questions they
 * pose to relatives.
 */
export const narrationSectionCopy = {
  title: "Narration",
  subtitle: "How the interviewer works with you when you tell a story.",

  followUps: {
    heading: "Follow-up questions",
    label: "Ask me follow-up questions",
    on: "On",
    off: "Off",
    // Explains the value AND what turning it off costs (CONTEXT: follow-ups deepen a story).
    help: "After you answer, the interviewer may ask one gentle follow-up to draw out a detail — a name, a place, a feeling — so the story lands fuller. Turn this off and the interviewer won't ask any deepening questions; it will simply take down what you say.",
    savedOn: "Follow-up questions are on.",
    savedOff: "Follow-up questions are off.",
  },

  askSuggestion: {
    heading: "Question wording",
    label: "Suggest better wording for my questions",
    on: "On",
    off: "Off",
    help: "When you ask a relative a question, we can suggest a warmer or clearer way to phrase it before you send. You always decide whether to use the suggestion.",
    savedOn: "Wording suggestions are on.",
    savedOff: "Wording suggestions are off.",
  },

  saving: "Saving…",
  saveError: "Couldn't save. Try again.",
} as const;
