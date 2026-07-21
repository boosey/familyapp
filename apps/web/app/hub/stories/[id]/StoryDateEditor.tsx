"use client";

/**
 * Story date edit control (ADR-0026 #241). Rendered next to the Story date on the opened story —
 * the parent gates it to the owner (core `editStoryDate` re-checks ownership). The four choices
 * map onto the three storage forms plus Undated: an exact date, a period (start/end), a circa
 * year (padded to YYYY-01-01), or no date. The live preview uses the same `formatStoryDate`
 * smart display as every other surface. Saves through `editStoryDateAction` → core
 * `editStoryDate` → the `updateDerivedFields` write seam (#240); no new write path.
 */
import { useState, useTransition } from "react";
import type { OccurredKind } from "@chronicle/db";
import { ModalShell } from "@/app/_kindred/ModalShell";
import { hub } from "@/app/_copy";
import { formatStoryDate } from "@/app/hub/tabs/story-browse-helpers";
import { editStoryDateAction } from "./actions";
import styles from "./StoryDateEditor.module.css";

/** The story's current Story date in raw form (ISO calendar dates, YYYY-MM-DD); null = Undated. */
export interface StoryDateValue {
  kind: OccurredKind;
  date: string;
  endDate: string | null;
}

export interface StoryDateEditorProps {
  storyId: string;
  current: StoryDateValue | null;
}

/** The control's four choices — the three storage kinds plus the Undated state. */
type FormKind = OccurredKind | "undated";

export function StoryDateEditor({ storyId, current }: StoryDateEditorProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FormKind>("undated");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [circaYear, setCircaYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openEditor = () => {
    // Re-seed from the saved value on every open so a cancelled attempt leaves no residue.
    setKind(current?.kind ?? "undated");
    setDate(current?.kind === "circa" ? "" : (current?.date ?? ""));
    setEndDate(current?.kind === "period" ? (current.endDate ?? "") : "");
    setCircaYear(current?.kind === "circa" ? current.date.slice(0, 4) : "");
    setError(null);
    setOpen(true);
  };

  const trimmedYear = circaYear.trim();
  const circaValid = /^\d{4}$/.test(trimmedYear);

  // The live smart-display preview of the form value — the exact formatting the read paths use.
  const preview = ((): string | null => {
    if (kind === "undated") return hub.browse.undated;
    if (kind === "circa") {
      return circaValid ? formatStoryDate({ kind: "circa", date: `${trimmedYear}-01-01` }) : null;
    }
    if (!date || (kind === "period" && !endDate)) return null;
    return formatStoryDate({ kind, date, endDate: kind === "period" ? endDate : null });
  })();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (kind === "date" && !date) {
      setError(hub.storyDate.invalidDate);
      return;
    }
    if (kind === "period" && (!date || !endDate || endDate < date)) {
      setError(hub.storyDate.invalidPeriod);
      return;
    }
    if (kind === "circa" && !circaValid) {
      setError(hub.storyDate.invalidYear);
      return;
    }

    const fd = new FormData();
    fd.append("storyId", storyId);
    fd.append("occurredKind", kind);
    if (kind === "date") {
      fd.append("occurredDate", date);
    } else if (kind === "period") {
      fd.append("occurredDate", date);
      fd.append("occurredEndDate", endDate);
    } else if (kind === "circa") {
      // A circa year is stored as the year-aligned point; display renders "c. {year}".
      fd.append("occurredDate", `${trimmedYear}-01-01`);
    }

    startTransition(async () => {
      try {
        const res = await editStoryDateAction(fd);
        if (res?.error) {
          setError(res.error);
        } else {
          // revalidatePath refreshes the server-rendered date + provenance above.
          setOpen(false);
        }
      } catch {
        // A rejected server action (network failure, unhandled server error) must not leave the
        // form silently stuck — surface a retry-able error.
        setError(hub.storyDetail.genericError);
      }
    });
  };

  const kindOptions: { value: FormKind; label: string }[] = [
    { value: "date", label: hub.storyDate.kindDate },
    { value: "period", label: hub.storyDate.kindPeriod },
    { value: "circa", label: hub.storyDate.kindCirca },
    { value: "undated", label: hub.storyDate.kindUndated },
  ];

  return (
    <>
      <button
        type="button"
        data-testid="story-date-edit"
        onClick={openEditor}
        className={styles.trigger}
      >
        {hub.storyDate.edit}
      </button>
      {open && (
        <ModalShell
          onOverlayClick={() => setOpen(false)}
          maxWidth={400}
          role="dialog"
          aria-modal="true"
          aria-label={hub.storyDate.heading}
          data-testid="story-date-modal"
        >
          <form onSubmit={handleSubmit} data-testid="story-date-form" className={styles.card}>
            <h3 className={styles.heading}>{hub.storyDate.heading}</h3>

            <fieldset className={styles.kindGroup}>
              {kindOptions.map((opt) => (
                <label key={opt.value} className={styles.kindOption}>
                  <input
                    type="radio"
                    name="occurredKind"
                    value={opt.value}
                    checked={kind === opt.value}
                    onChange={() => setKind(opt.value)}
                    disabled={isPending}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>

            {kind === "date" && (
              <label className={styles.fieldLabel}>
                {hub.storyDate.dateLabel}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={isPending}
                  className={styles.field}
                  data-testid="story-date-input"
                />
              </label>
            )}

            {kind === "period" && (
              <div className={styles.fieldsRow}>
                <label className={styles.fieldLabel}>
                  {hub.storyDate.startLabel}
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={isPending}
                    className={styles.field}
                    data-testid="story-period-start"
                  />
                </label>
                <label className={styles.fieldLabel}>
                  {hub.storyDate.endLabel}
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={isPending}
                    className={styles.field}
                    data-testid="story-period-end"
                  />
                </label>
              </div>
            )}

            {kind === "circa" && (
              <label className={styles.fieldLabel}>
                {hub.storyDate.yearLabel}
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder={hub.storyDate.yearPlaceholder}
                  value={circaYear}
                  onChange={(e) => setCircaYear(e.target.value)}
                  disabled={isPending}
                  className={styles.field}
                  data-testid="story-circa-input"
                />
              </label>
            )}

            {preview && (
              <p className={styles.preview} data-testid="story-date-preview">
                {hub.storyDate.preview(preview)}
              </p>
            )}

            {error && (
              <p role="alert" data-testid="story-date-error" className={styles.errText}>
                {error}
              </p>
            )}

            <div className={styles.actions}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className={styles.btnGhost}
              >
                {hub.storyDetail.cancel}
              </button>
              <button type="submit" disabled={isPending} className={styles.btnPrimary}>
                {isPending ? hub.storyDetail.saving : hub.storyDetail.save}
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}
