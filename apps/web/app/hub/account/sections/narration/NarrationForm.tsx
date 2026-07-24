"use client";

/**
 * Account › Narration — client toggles (#351 / ADR-0029). Two independent on/off preferences,
 * rendered as segmented On/Off buttons (mirrors KindredMotionToggle) with an optimistic value and a
 * saving/error hint. Each saves on click via its server action. Values are narrator-facing ("on" =
 * the behaviour happens); the actions invert to the stored *opt-out* booleans.
 */
import { useCallback, useRef, useState, type CSSProperties } from "react";
import { narrationSectionCopy as copy } from "./copy";
import { saveFollowUpsEnabledAction, saveAskSuggestionEnabledAction } from "./actions";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { InfoTooltip } from "@/app/hub/InfoTooltip";

type SaveState = "idle" | "saving" | "error";

export interface NarrationFormProps {
  /** Narrator-facing value: TRUE = interviewer asks follow-ups (stored as followUpsOptOut = false). */
  followUpsEnabled: boolean;
  /** Narrator-facing value: TRUE = wording suggestions on (stored as askSuggestionOptOut = false). */
  askSuggestionEnabled: boolean;
}

export function NarrationForm({
  followUpsEnabled: initialFollowUps,
  askSuggestionEnabled: initialAskSuggestion,
}: NarrationFormProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <ToggleSection
        headingId="narration-follow-ups"
        heading={copy.followUps.heading}
        label={copy.followUps.label}
        help={copy.followUps.help}
        onLabel={copy.followUps.on}
        offLabel={copy.followUps.off}
        initial={initialFollowUps}
        save={saveFollowUpsEnabledAction}
      />
      <ToggleSection
        headingId="narration-ask-suggestion"
        heading={copy.askSuggestion.heading}
        label={copy.askSuggestion.label}
        help={copy.askSuggestion.help}
        onLabel={copy.askSuggestion.on}
        offLabel={copy.askSuggestion.off}
        initial={initialAskSuggestion}
        save={saveAskSuggestionEnabledAction}
      />
    </div>
  );
}

function ToggleSection({
  headingId,
  heading,
  label,
  help,
  onLabel,
  offLabel,
  initial,
  save,
}: {
  headingId: string;
  heading: string;
  label: string;
  help: string;
  onLabel: string;
  offLabel: string;
  initial: boolean;
  save: (enabled: boolean) => Promise<{ ok: true } | { error: string }>;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const savingRef = useRef(false);

  const choose = useCallback(
    async (next: boolean) => {
      if (savingRef.current || next === enabled) return;
      savingRef.current = true;
      const prev = enabled;
      setEnabled(next); // optimistic
      setState("saving");
      const result = await save(next);
      if ("ok" in result) {
        setState("idle");
      } else {
        setEnabled(prev); // roll back
        setState("error");
      }
      savingRef.current = false;
    },
    [enabled, save],
  );

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} style={sectionTitle}>
        {heading}
        <InfoTooltip label={heading} text={help} />
      </h2>
      <div style={rowStyle}>
        <span id={`${headingId}-label`} style={labelStyle}>
          {label}
        </span>
        <SegmentedControl
          variant="toggle"
          items={[
            { key: "on", label: onLabel },
            { key: "off", label: offLabel },
          ]}
          active={enabled ? "on" : "off"}
          onSelect={(k) => void choose(k === "on")}
          ariaLabel={label}
        />
      </div>
      {state !== "idle" ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: state === "error" ? "var(--accent-strong)" : "var(--text-muted)",
            marginTop: 6,
            display: "block",
          }}
        >
          {state === "saving" ? copy.saving : copy.saveError}
        </span>
      ) : null}
    </section>
  );
}

const sectionTitle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story-lg)",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 12px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
};

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  fontWeight: 600,
  color: "var(--text-body)",
};
