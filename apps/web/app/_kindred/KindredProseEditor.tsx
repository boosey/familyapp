"use client";
import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { useProseHistory, type ProseHistory } from "@/lib/use-prose-history";
import { common } from "@/app/_copy";

/**
 * Multiline prose editor in Kindred chrome. Prefilled with the AI-polished prose (L2); the narrator
 * edits directly. The parent decides whether the value changed (only then is a correction saved).
 *
 * Optional toolbar (shown whenever undo/redo has anywhere to go, or `onPolish` is provided):
 *  - "Polish with AI" — opt-in re-render that tidies rambling and resolves spoken self-corrections.
 *    Provided by the parent as an async text→text call; the result is pushed as a history entry so it
 *    is fully reversible.
 *  - Undo / Redo — walk the coalesced edit history, back to the original text (see useProseHistory).
 */
export interface KindredProseEditorLabels {
  polish: string;
  polishing: string;
  polishHint: string;
  polishError: string;
  undo: string;
  redo: string;
}

const DEFAULT_LABELS: KindredProseEditorLabels = {
  polish: "Polish with AI",
  polishing: "Polishing…",
  polishHint: "Tidy rambling and self-corrections. You can undo it.",
  polishError: "Couldn't polish that just now — your words are unchanged.",
  undo: "Undo",
  redo: "Redo",
};

export interface KindredProseEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /**
   * When provided, the editor can run "Polish with AI" (parent supplies the text→text call). By
   * default a Polish button renders in the toolbar above the textarea. Set `showPolishButton={false}`
   * when the parent owns a Polish control elsewhere (e.g. ComposingEditor Speak/Type row) so the
   * toolbar stays undo/redo-only.
   */
  onPolish?: (text: string) => Promise<string>;
  /** When false, hide the in-toolbar Polish button even if `onPolish` is set. Default true. */
  showPolishButton?: boolean;
  /** Change this to re-baseline undo/redo history (e.g. a different draft mounts into this editor). */
  historyKey?: string;
  /**
   * Lifted undo/redo history. When the parent owns the history (so it can `.replace` the prose on a
   * take-append — an event this editor doesn't emit), it passes its own `useProseHistory` instance
   * here. Absent → the editor manages its own history internally (the standalone default). The
   * injected instance must be built from the SAME `value`/`onChange` this editor receives.
   */
  history?: ProseHistory;
  /** Copy overrides; English defaults are baked in. */
  labels?: Partial<KindredProseEditorLabels>;
}

export function KindredProseEditor({
  value,
  onChange,
  disabled,
  onPolish,
  showPolishButton = true,
  historyKey,
  history: injectedHistory,
  labels,
}: KindredProseEditorProps) {
  const [focused, setFocused] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState(false);
  const l = { ...DEFAULT_LABELS, ...labels };

  // Always create an own instance (rules-of-hooks: the call must be unconditional). When the parent
  // injects one, the own instance is inert — the injected history is the single source of truth.
  const ownHistory = useProseHistory(value, onChange, historyKey);
  const history = injectedHistory ?? ownHistory;

  const runPolish = useCallback(async () => {
    if (!onPolish || polishing || disabled) return;
    if (value.trim().length === 0) return;
    setPolishError(false);
    setPolishing(true);
    try {
      const next = await onPolish(value);
      // A no-op result (model returned the same text) still safely goes through replace, which
      // de-dupes identical heads — so it never adds a phantom undo step.
      history.replace(next);
    } catch {
      setPolishError(true);
    } finally {
      setPolishing(false);
    }
  }, [onPolish, polishing, disabled, value, history]);

  const focusStyle: CSSProperties = focused
    ? { boxShadow: "0 0 0 4px var(--accent-soft)", outline: "none" }
    : {};

  const busy = disabled || polishing;
  const polishInToolbar = Boolean(onPolish) && showPolishButton;
  // The toolbar is worth showing if there is any history affordance OR an in-toolbar polish button.
  const showToolbar = polishInToolbar || history.canUndo || history.canRedo;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {showToolbar && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {polishInToolbar && (
            <ToolbarButton
              onClick={runPolish}
              disabled={busy || value.trim().length === 0}
              title={l.polishHint}
              emphasis
            >
              <SparkleIcon />
              {polishing ? l.polishing : l.polish}
            </ToolbarButton>
          )}
          <div style={{ flex: 1 }} />
          <ToolbarButton
            onClick={history.undo}
            disabled={busy || !history.canUndo}
            title={l.undo}
            aria-label={l.undo}
            iconOnly
          >
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton
            onClick={history.redo}
            disabled={busy || !history.canRedo}
            title={l.redo}
            aria-label={l.redo}
            iconOnly
          >
            <RedoIcon />
          </ToolbarButton>
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={busy}
        rows={12}
        aria-label={common.proseEditor.ariaLabel}
        aria-busy={polishing}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "var(--space-4) var(--space-5)",
          borderRadius: "var(--radius-md)",
          border: "var(--border-width) solid var(--border)",
          background: "var(--surface-card)",
          color: "var(--text-body)",
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-ui)",
          lineHeight: "var(--leading-body)",
          resize: "vertical",
          opacity: polishing ? 0.65 : 1,
          transition: "opacity var(--dur-fade)",
          ...focusStyle,
        }}
      />

      {polishError && (
        <p
          aria-live="polite"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            color: "var(--text-danger)",
            margin: 0,
          }}
        >
          {l.polishError}
        </p>
      )}
    </div>
  );
}

/* ── Toolbar button ────────────────────────────────────────────────────────── */
function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
  emphasis,
  iconOnly,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  emphasis?: boolean;
  iconOnly?: boolean;
  "aria-label"?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: 36,
        padding: iconOnly ? "0 8px" : "0 14px",
        borderRadius: "var(--radius-pill)",
        border: emphasis
          ? "var(--border-width) solid var(--accent)"
          : "var(--border-width) solid var(--border)",
        background:
          !disabled && hover
            ? "var(--accent-soft)"
            : emphasis
              ? "var(--accent-soft)"
              : "transparent",
        color: emphasis ? "var(--accent-strong)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-label)",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "background .15s, opacity .15s",
      }}
    >
      {children}
    </button>
  );
}

/* ── Icons (inline, currentColor) ──────────────────────────────────────────── */
function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 4.8L18 8.4l-4.4 1.6L12 15l-1.6-4.9L6 8.4l4.4-1.6L12 2zm6 10l.9 2.6L21 15.5l-2.1.9L18 19l-.9-2.6L15 15.5l2.1-.9L18 12zM6 14l.8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8L6 14z" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h1" />
    </svg>
  );
}
