"use client";

/**
 * ProseBlock — shared prose editor (KindredProseEditor with lifted undo/redo history + ✨Polish).
 * Extracted from ComposingEditor (ADR-0014 Inc 4 slice 3) so story composing and intake
 * (AboutYouFlow) mount the same editor. The parent owns the prose value + history.
 *
 * When `label` is null, no heading is rendered (compact capture). Default remains the story
 * surface's "Read it over…" copy for intake / callers that omit the prop.
 *
 * `showPolishButton` (default true) lets ComposingEditor hide the in-toolbar Polish when it owns a
 * Polish control on the Speak/Type row instead.
 */
import { KindredProseEditor } from "@/app/_kindred";
import { hub, common } from "@/app/_copy";
import type { ProseHistory } from "@/lib/use-prose-history";

export function ProseBlock({
  proseDraft,
  setProseDraft,
  disabled,
  history,
  onPolish,
  showPolishButton = true,
  label = hub.answer.reviewYourWords,
  rows = 12,
}: {
  proseDraft: string;
  setProseDraft: (v: string) => void;
  disabled: boolean;
  history: ProseHistory;
  onPolish: (text: string) => Promise<string>;
  showPolishButton?: boolean;
  /** Pass `null` to hide the heading (compact capture). */
  label?: string | null;
  /** Textarea row count; capture uses a shorter field. */
  rows?: number;
}) {
  return (
    <div style={{ marginBottom: label ? 24 : 12 }}>
      {label ? (
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--support)",
            margin: "0 0 14px",
          }}
        >
          {label}
        </p>
      ) : null}
      <KindredProseEditor
        value={proseDraft}
        onChange={setProseDraft}
        disabled={disabled}
        history={history}
        labels={common.proseEditor}
        onPolish={onPolish}
        showPolishButton={showPolishButton}
        rows={rows}
      />
    </div>
  );
}
