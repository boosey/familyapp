/**
 * Deterministic, dependency-free suggestion of a Family "short name" from its formal name (ADR-0021).
 * A small swappable seam (a future AI suggester is explicitly out of scope). Rules:
 *   - trim; tokenize on whitespace;
 *   - strip a leading article token "the" (case-insensitive), only if >1 token;
 *   - strip a trailing FAMILY WORD token ("family" | "clan" | "household" | "side" | "chronicle",
 *     case-insensitive), only if it leaves ≥1 token;
 *   - the remaining tokens are the CANDIDATE. Return the candidate ONLY when it is "name-shaped"
 *     (one or more uppercase-initial letter tokens, hyphens allowed); otherwise return the original
 *     trimmed input UNCHANGED.
 * Documented outcomes: "The Boudreaux family" → "Boudreaux"; "Mom's side" → "Mom's side" (unchanged,
 * because the core "Mom's" is not name-shaped).
 *
 * The name-shaped test is Unicode-aware (`\p{Lu}`/`\p{L}`), so accented surnames common in this
 * domain — "Bélangér", "Ñoño" — are suggested, not silently dropped as an ASCII-only `[A-Z]` would.
 * A token may also carry an internal apostrophe segment ONLY when it is followed by another
 * uppercase letter — so genuine surnames "O'Connor" / "D'Angelo" are name-shaped, while a possessive
 * ("Mom's" — apostrophe + lowercase) is not, keeping "Mom's side" untouched.
 */

const FAMILY_WORDS = new Set(["family", "clan", "household", "side", "chronicle"]);
// A single name-shaped token: uppercase-initial letter run (hyphens allowed), plus optional
// apostrophe-then-uppercase segments (O'Connor, O'Brien-Smith, D'Angelo).
const TOKEN = String.raw`\p{Lu}[\p{L}-]*(?:'\p{Lu}[\p{L}-]*)*`;
const NAME_SHAPED = new RegExp(String.raw`^${TOKEN}(?:\s+${TOKEN})*$`, "u");

export function suggestShortName(formalName: string): string {
  const trimmed = formalName.trim();
  if (trimmed.length === 0) return "";

  let tokens = trimmed.split(/\s+/);

  // Strip a leading "the" (case-insensitive) only if more than one token remains meaningful.
  if (tokens.length > 1 && tokens[0]!.toLowerCase() === "the") {
    tokens = tokens.slice(1);
  }

  // Strip a trailing family word only if it leaves ≥1 token.
  if (
    tokens.length > 1 &&
    FAMILY_WORDS.has(tokens[tokens.length - 1]!.toLowerCase())
  ) {
    tokens = tokens.slice(0, -1);
  }

  const candidate = tokens.join(" ");
  return NAME_SHAPED.test(candidate) ? candidate : trimmed;
}
