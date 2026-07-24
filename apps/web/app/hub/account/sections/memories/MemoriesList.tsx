"use client";

/**
 * Account › Memories — the card list (ADR-0029 §#357), a CLIENT component so each card can edit/clear
 * inline with save-status feedback, mirroring the profile editor's auto-save affordance.
 *
 * It renders PURELY from the `MemoryItem` view model handed down by the server component. That view
 * model is shaped after the future `narrator_memory` ledger (title/summary/tags/origin/sourceStoryId/
 * status) so that when the ledger lands (#362) the server swaps its data source and this UI is
 * unchanged. Today the items are mapped from biographical anchors; the `kind`/`key` fields tell the
 * card which server action to call.
 */
import { useCallback, useRef, useState } from "react";
import { formatText, formatBool, type MemoryItem } from "./view-model";
import { memoriesSectionCopy as copy } from "./copy";
import {
  saveTextMemoryAction,
  saveBoolMemoryAction,
  forgetMemoryAction,
} from "./actions";
import styles from "./memories.module.css";

type SaveState = "idle" | "saving" | "saved" | "error";

export function MemoriesList({ items }: { items: MemoryItem[] }) {
  const set = items.filter((m) => m.isSet);
  const unset = items.filter((m) => !m.isSet);

  if (set.length === 0 && unset.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{copy.emptyTitle}</p>
        <p className={styles.emptyBody}>{copy.emptyBody}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {set.map((item) => (
        <MemoryCard key={item.id} item={item} />
      ))}
      {unset.length > 0 ? (
        <>
          <p className={styles.unsetHeading}>Not remembered yet</p>
          {unset.map((item) => (
            <MemoryCard key={item.id} item={item} />
          ))}
        </>
      ) : null}
    </div>
  );
}

function MemoryCard({ item }: { item: MemoryItem }) {
  const [summary, setSummary] = useState<string | null>(item.summary);
  const [isSet, setIsSet] = useState(item.isSet);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  const savingRef = useRef(false);

  const [draftText, setDraftText] = useState(item.kind === "text" ? (item.rawText ?? "") : "");
  const [draftBool, setDraftBool] = useState<boolean | null>(
    item.kind === "bool" ? item.rawBool : null,
  );

  const mark = useCallback((s: SaveState) => {
    setState(s);
    if (s === "saved") {
      window.setTimeout(() => setState((cur) => (cur === "saved" ? "idle" : cur)), 2000);
    }
  }, []);

  const run = useCallback(
    async (fn: () => Promise<{ ok: true } | { error: string }>) => {
      if (savingRef.current) return false;
      savingRef.current = true;
      mark("saving");
      const result = await fn();
      const ok = "ok" in result;
      mark(ok ? "saved" : "error");
      savingRef.current = false;
      return ok;
    },
    [mark],
  );

  async function commit() {
    if (item.kind === "text") {
      const next = draftText.trim();
      const ok = await run(() => saveTextMemoryAction(item.key, next));
      if (!ok) return;
      setSummary(next === "" ? null : formatText(next));
      setIsSet(next !== "");
    } else {
      const ok = await run(() => saveBoolMemoryAction(item.key, draftBool));
      if (!ok) return;
      setSummary(draftBool === null ? null : formatBool(draftBool));
      setIsSet(draftBool !== null);
    }
    setEditing(false);
  }

  async function forget() {
    const ok = await run(() => forgetMemoryAction(item.key));
    if (!ok) return;
    setSummary(null);
    setIsSet(false);
    if (item.kind === "text") setDraftText("");
    else setDraftBool(null);
    setEditing(false);
  }

  function startEdit() {
    if (item.kind === "text") setDraftText(item.rawText ?? "");
    else setDraftBool(item.rawBool);
    setEditing(true);
  }

  return (
    <div className={`${styles.card} ${isSet ? "" : styles.cardUnset}`}>
      <div className={styles.cardHeader}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.provenanceChip}>{copy.provenanceLabel}</span>
      </div>

      {editing ? (
        <div className={styles.editStack}>
          {item.kind === "text" ? (
            <input
              type="text"
              className="kin-field"
              value={draftText}
              autoFocus
              placeholder={item.placeholder}
              onChange={(e) => setDraftText(e.target.value)}
            />
          ) : (
            <select
              className="kin-field"
              value={draftBool === true ? "yes" : draftBool === false ? "no" : ""}
              onChange={(e) => {
                const v = e.target.value;
                setDraftBool(v === "yes" ? true : v === "no" ? false : null);
              }}
            >
              <option value="">{copy.notSetLabel}</option>
              <option value="yes">{copy.yesLabel}</option>
              <option value="no">{copy.noLabel}</option>
            </select>
          )}
          <div className={styles.buttonRow}>
            <button type="button" className={styles.btnPrimary} onClick={() => void commit()}>
              {copy.saveLabel}
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => setEditing(false)}>
              {copy.cancelLabel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={`${styles.summary} ${isSet ? "" : styles.summaryEmpty}`}>
            {summary ?? copy.notSetLabel}
          </p>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.btnGhost} onClick={startEdit}>
              {copy.editLabel}
            </button>
            {isSet ? (
              <button type="button" className={styles.btnGhost} onClick={() => void forget()}>
                {copy.clearLabel}
              </button>
            ) : null}
          </div>
        </>
      )}

      <StatusHint state={state} />
    </div>
  );
}

function StatusHint({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const text =
    state === "saving" ? copy.saving : state === "saved" ? copy.saved : copy.saveError;
  return (
    <span className={`${styles.hint} ${state === "error" ? styles.hintError : ""}`}>{text}</span>
  );
}
