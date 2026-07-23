/**
 * `toAnswerExcerpt` — turns a narrator's answer transcript into a short (1–2 sentence) excerpt of
 * their OWN words, for grounding a follow-up question.
 *
 * Why this exists: a system/gap follow-up (e.g. the temporal dating probe) carries only a
 * contentless seed like "about when this happened". When the phraser has nothing concrete to
 * anchor "this" to, an LLM will confabulate a subject out of the background CONTEXT anchors
 * (hometown, current location, …) — the skiing-trip → invented "move" bug. Quoting the narrator's
 * actual words in the prompt gives "this" a real referent, so the question stays on THEIR story.
 *
 * Contract: first 1–2 sentences, capped at ~240 chars, never cut mid-word (trim back to the last
 * space), no leading/trailing whitespace. Appends a "…" only on a hard char-cap cut.
 */

/** Max characters of narrator words to quote — enough to anchor the topic, short enough to stay a hint. */
const ANSWER_EXCERPT_MAX_CHARS = 240;

export function toAnswerExcerpt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // Take up to the SECOND sentence-ending punctuation (. ! ?). If we find at least two sentence
  // ends, cut after the second; that is our natural 1–2 sentence excerpt.
  //
  // A `.`/`!`/`?` only counts as a sentence end when it is followed by whitespace OR end-of-string.
  // This keeps a decimal like "4.5 miles" intact — its dot is followed by a digit, not whitespace —
  // so we never cut mid-number and quote a nonsensical fragment ("We skied 4.") into the prompt.
  // Known limitation: this does NOT split abbreviations like "Dr. Smith" correctly (the dot IS
  // followed by whitespace); that's an accepted, lower-severity trade-off — do not over-engineer.
  const sentenceEnd = /[.!?](?=\s|$)/g;
  let ends = 0;
  let cutAt = -1;
  for (let m = sentenceEnd.exec(trimmed); m !== null; m = sentenceEnd.exec(trimmed)) {
    ends += 1;
    if (ends === 2) {
      cutAt = m.index + 1; // include the punctuation
      break;
    }
  }
  let excerpt = cutAt >= 0 ? trimmed.slice(0, cutAt) : trimmed;

  // Hard char cap. If still too long (e.g. a single run-on sentence with no terminator), cut at the
  // cap and trim back to the last whitespace so we never split a word. Add a trailing ellipsis to
  // signal the cut.
  if (excerpt.length > ANSWER_EXCERPT_MAX_CHARS) {
    let sliced = excerpt.slice(0, ANSWER_EXCERPT_MAX_CHARS);
    const lastSpace = sliced.lastIndexOf(" ");
    if (lastSpace > 0) sliced = sliced.slice(0, lastSpace);
    excerpt = `${sliced.trimEnd()}…`;
  }

  return excerpt.trim();
}
