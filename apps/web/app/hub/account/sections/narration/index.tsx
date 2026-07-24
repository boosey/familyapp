/**
 * Account › Narration (ADR-0029 / #351) — the per-narrator controls for how the interviewer works
 * with this Person. Two account-level booleans on `persons`, stored as *opt-out* (default false =
 * the behaviour is ON):
 *
 *   - Follow-up opt-out (#351) — when off, the follow-up cascade short-circuits at the top (no
 *     evaluation LLM, no ask; audited `suppressed_narrator_opt_out`). Gates only the narrator-facing
 *     ask — memory extraction (a separate post-approval pipeline) is unaffected.
 *   - Ask-suggestion opt-out — persist-only for now (no consumer built yet).
 *
 * Owns its own data load keyed on the shared-contract `personId`/`db`; toggles + save live in the
 * colocated `NarrationForm` client component and `actions.ts`. Section copy is in `./copy.ts`.
 */
import type { CSSProperties } from "react";
import { getNarrationPreferences } from "@chronicle/core";
import type { AccountSectionProps } from "../../section-props";
import { NarrationForm } from "./NarrationForm";
import { narrationSectionCopy } from "./copy";

export default async function NarrationSection({ personId, db }: AccountSectionProps) {
  const prefs = await getNarrationPreferences(db, personId);

  return (
    <section aria-labelledby="account-narration-title">
      <header style={headerStyle}>
        <h2 id="account-narration-title" style={title}>
          {narrationSectionCopy.title}
        </h2>
        <p style={subtitle}>{narrationSectionCopy.subtitle}</p>
      </header>

      <NarrationForm
        followUpsEnabled={!prefs.followUpsOptOut}
        askSuggestionEnabled={!prefs.askSuggestionOptOut}
      />
    </section>
  );
}

const headerStyle: CSSProperties = {
  marginBottom: 32,
};

const title: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "clamp(1.5rem, 3.5vw, var(--text-display))",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const subtitle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: 0,
  lineHeight: "var(--leading-snug)",
};
