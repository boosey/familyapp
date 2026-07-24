"use client";

/**
 * Account › Privacy — client toggle form (ADR-0029 §#331). Two INDEPENDENT contact-visibility toggles
 * (hide email / hide phone). Optimistic local state + fire-and-forget server action, mirroring the
 * Profile section's auto-save pattern (`ProfileForm`). The checkbox is worded "Hide my …", so checked
 * === hidden === the persisted `hideEmail`/`hidePhone` boolean is true.
 */
import { useCallback, useRef, useState, type CSSProperties } from "react";
import { privacySectionCopy as copy } from "./copy";
import { saveHideEmailAction, saveHidePhoneAction } from "./actions";

type SaveState = "idle" | "saving" | "saved" | "error";

export interface PrivacyFormProps {
  hideEmail: boolean;
  hidePhone: boolean;
}

export function PrivacyForm({
  hideEmail: initialHideEmail,
  hidePhone: initialHidePhone,
}: PrivacyFormProps) {
  return (
    <div style={fieldStack}>
      <PrivacyToggle
        label={copy.hideEmailLabel}
        help={copy.hideEmailHelp}
        initial={initialHideEmail}
        save={saveHideEmailAction}
      />
      <PrivacyToggle
        label={copy.hidePhoneLabel}
        help={copy.hidePhoneHelp}
        initial={initialHidePhone}
        save={saveHidePhoneAction}
      />
    </div>
  );
}

function PrivacyToggle({
  label,
  help,
  initial,
  save,
}: {
  label: string;
  help: string;
  initial: boolean;
  save: (value: boolean) => Promise<{ ok: true } | { error: string }>;
}) {
  const [checked, setChecked] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const savingRef = useRef(false);

  const onToggle = useCallback(
    async (next: boolean) => {
      const previous = checked;
      setChecked(next);
      if (savingRef.current) return;
      savingRef.current = true;
      setState("saving");
      const result = await save(next);
      savingRef.current = false;
      if ("ok" in result) {
        setState("saved");
        window.setTimeout(() => {
          setState((s) => (s === "saved" ? "idle" : s));
        }, 2000);
      } else {
        // Revert the optimistic flip so the UI never claims a state that didn't persist.
        setChecked(previous);
        setState("error");
      }
    },
    [checked, save],
  );

  const hint =
    state === "saving"
      ? copy.saving
      : state === "saved"
        ? copy.saved
        : state === "error"
          ? copy.saveError
          : null;

  return (
    <div>
      <label style={toggleRow}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            void onToggle(e.target.checked);
          }}
          style={{ marginTop: 3, flexShrink: 0 }}
        />
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={toggleLabel}>{label}</span>
          <span style={helpText}>{help}</span>
        </span>
      </label>
      {hint ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            color: state === "error" ? "var(--accent-strong)" : "var(--text-muted)",
            marginTop: 6,
            display: "block",
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

const fieldStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const toggleRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  cursor: "pointer",
};

const toggleLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui)",
  color: "var(--text-body)",
  lineHeight: "var(--leading-snug)",
};

const helpText: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-label)",
  color: "var(--text-muted)",
  lineHeight: "var(--leading-snug)",
};
