"use client";

/**
 * ProseBlock — the shared prose editor block (a heading + KindredProseEditor with lifted undo/redo
 * history + ✨Polish). Extracted from ComposingEditor (ADR-0014 Inc 4 slice 3) so BOTH the story
 * composing surface and the intake surface (AboutYouFlow) mount the exact same editor. The parent
 * owns the prose value + history (so an append/transcription can seed the prose as one undoable step
 * via `history.replace`, an event the editor doesn't emit).
 *
 * `label` overrides the heading; it defaults to the story surface's "Read it over…" copy so
 * ComposingEditor keeps its wording unchanged while intake passes its own.
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
}: {
  proseDraft: string;
  setProseDraft: (v: string) => void;
  disabled: boolean;
  history: ProseHistory;
  onPolish: (text: string) => Promise<string>;
  showPolishButton?: boolean;
  label?: string;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
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
      <KindredProseEditor
        value={proseDraft}
        onChange={setProseDraft}
        disabled={disabled}
        history={history}
        labels={common.proseEditor}
        onPolish={onPolish}
        showPolishButton={showPolishButton}
      />
    </div>
  );
}
