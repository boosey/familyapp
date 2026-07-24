"use client";

/**
 * Account › Memories — the header + card list (ADR-0029 §#357 + change 9/10 density pass), a CLIENT
 * component so the row and the "Add a memory" affordance can both interact (edit/clear inline,
 * open the create form) with save-status feedback, mirroring the profile editor's auto-save affordance.
 *
 * The header (title + Add button) lives HERE rather than in the server `index.tsx` because the Add
 * button is a client interaction (it opens an inline form) — a plain server component can't own that
 * state, and splitting title/button across a server/client boundary would need prop-drilling a click
 * handler across it, which Next.js server components can't do. Moving the whole header into this
 * already-client component is the simplest fix: `index.tsx` passes down the precomputed `title` string.
 *
 * The list itself renders PURELY from the `MemoryItem` view model handed down by the server component.
 * That view model is shaped after the future `narrator_memory` ledger (title/summary/tags/origin/
 * sourceStoryId/status) so that when the ledger lands (#362) the server swaps its data source and this
 * UI is unchanged. Today the items are mapped from biographical anchors; the `kind`/`key` fields tell
 * the row which server action to call.
 */
import { useCallback, useRef, useState } from "react";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { formatText, formatBool, type MemoryItem } from "./view-model";
import { memoriesSectionCopy as copy } from "./copy";
import {
  saveTextMemoryAction,
  saveBoolMemoryAction,
  forgetMemoryAction,
  createCustomMemoryAction,
} from "./actions";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { InfoTooltip } from "@/app/hub/InfoTooltip";
import styles from "./memories.module.css";

type SaveState = "idle" | "saving" | "saved" | "error";

const ICON_SIZE = 17;

export function MemoriesList({ items, title }: { items: MemoryItem[]; title: string }) {
  const set = items.filter((m) => m.isSet);
  const unset = items.filter((m) => !m.isSet);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.headerTitleRow}>
          <h2 className={styles.headerTitle}>{title}</h2>
          <InfoTooltip label={title} text={copy.provenanceNote} />
        </span>
        <ActionButton
          type="button"
          variant="primary"
          onClick={() => setAddOpen((v) => !v)}
          aria-label={copy.addMemoryLabel}
        >
          <Plus size={16} strokeWidth={2} aria-hidden />
          {copy.addMemoryLabel}
        </ActionButton>
      </div>

      {addOpen ? <AddMemoryForm onDone={() => setAddOpen(false)} /> : null}

      {set.length === 0 && unset.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{copy.emptyTitle}</p>
          <p className={styles.emptyBody}>{copy.emptyBody}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {set.map((item) => (
            <MemoryRow key={item.id} item={item} />
          ))}
          {unset.length > 0 ? (
            <>
              <p className={styles.unsetHeading}>Not remembered yet</p>
              {unset.map((item) => (
                <MemoryRow key={item.id} item={item} />
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AddMemoryForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const savingRef = useRef(false);

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setState("saving");
    const result = await createCustomMemoryAction(title, summary);
    savingRef.current = false;
    if ("ok" in result) {
      setState("idle");
      onDone();
    } else {
      setState("error");
    }
  }

  return (
    <div className={styles.addForm}>
      <label className="kin-form-label">
        {copy.addTitleLabel}
        <input
          type="text"
          className="kin-field"
          value={title}
          placeholder={copy.addTitlePlaceholder}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="kin-form-label">
        {copy.addSummaryLabel}
        <textarea
          className="kin-field"
          value={summary}
          placeholder={copy.addSummaryPlaceholder}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
        />
      </label>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.btnPrimary} onClick={() => void save()}>
          {copy.addSave}
        </button>
        <button type="button" className={styles.btnGhost} onClick={onDone}>
          {copy.addCancel}
        </button>
      </div>
      {state === "error" ? (
        <span className={`${styles.hint} ${styles.hintError}`}>{copy.createNotAvailable}</span>
      ) : state === "saving" ? (
        <span className={styles.hint}>{copy.saving}</span>
      ) : null}
    </div>
  );
}

function MemoryRow({ item }: { item: MemoryItem }) {
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

  if (editing) {
    return (
      <div className={styles.row}>
        <div className={styles.editStack}>
          <span className={styles.title}>{item.title}</span>
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
          <span className={styles.iconButtonRow}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => void commit()}
              aria-label={copy.saveLabel}
              title={copy.saveLabel}
            >
              <Check size={ICON_SIZE} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setEditing(false)}
              aria-label={copy.cancelLabel}
              title={copy.cancelLabel}
            >
              <X size={ICON_SIZE} strokeWidth={2} aria-hidden />
            </button>
          </span>
        </div>
        <StatusHint state={state} />
      </div>
    );
  }

  return (
    <div className={`${styles.row} ${isSet ? "" : styles.rowUnset}`}>
      <span className={styles.title}>{item.title}</span>
      <span className={styles.provenanceChip}>{copy.provenanceLabel}</span>
      <span className={`${styles.summary} ${isSet ? "" : styles.summaryEmpty}`}>
        {summary ?? copy.notSetLabel}
      </span>
      <span className={styles.iconButtonRow}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={startEdit}
          aria-label={copy.editLabel}
          title={copy.editLabel}
        >
          <Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />
        </button>
        {isSet ? (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => void forget()}
            aria-label={copy.clearLabel}
            title={copy.clearLabel}
          >
            <Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
      </span>
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
