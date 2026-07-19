"use client";

/**
 * KindredCombobox (#204) — the ONE reusable single-select type-ahead picker (filter-as-you-type),
 * built for the Ask panel's person selector but generic: options are `{ id, name, note? }`, all copy
 * arrives as props, and the choice rides the surrounding form as a hidden `<input name={name}>`
 * carrying the option's id (so a plain server-action form submit picks it up — no onChange plumbing).
 *
 * Sized like the album toolbar's Time `<select>` (same min-height / padding / font / border), per
 * #204. Elder-friendly + accessible: a real `role="combobox"` input with `aria-expanded` /
 * `aria-controls` / `aria-activedescendant`, a `role="listbox"` popup, Arrow keys to move, Enter to
 * choose, Escape to revert, and a large-enough click target per option. An option's muted `note`
 * carries markers like the ADR-0006 "(invited)" suffix for pending invitees.
 *
 * Selection integrity: the hidden input only exists while the visible text EXACTLY matches the
 * chosen option's name — editing the text afterwards clears the selection (never a stale id), and
 * closing the popup snaps the text back to the chosen name so the two can never disagree. And while
 * `required`, the visible input carries a custom-validity error until a real option is CHOSEN — so
 * typing a name that matches nothing can never slip the form past HTML validation with no id (the
 * old `<select required>` could never submit an invalid target; neither can this).
 */
import { useEffect, useId, useRef, useState } from "react";
import s from "./KindredCombobox.module.css";

export interface KindredComboboxOption {
  id: string;
  name: string;
  /** Muted suffix after the name (e.g. the "(invited)" pending marker). */
  note?: string;
}

export function KindredCombobox({
  options,
  name,
  ariaLabel,
  placeholder,
  noMatchesText,
  invalidText,
  required = false,
}: {
  options: KindredComboboxOption[];
  /** Form field the selection rides on (a hidden input carries the chosen option's id). */
  name: string;
  /** Accessible name of the input (the visible label lives in the host form). */
  ariaLabel: string;
  placeholder?: string;
  /** Shown inside the open popup when the typed text matches nothing. */
  noMatchesText: string;
  /** Custom-validity message shown while `required` and no valid option is chosen yet — blocks the
   *  form submit when the text doesn't name a real option. */
  invalidText: string;
  required?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  // The hidden form value exists only while the visible text EXACTLY matches the chosen name —
  // editing the text afterwards drops the submitted id (never a stale id) while remembering the
  // choice, so Escape / blur can still snap the text back to it.
  const submittedId = selected && query === selected.name ? selected.id : null;
  const q = query.trim().toLowerCase();
  const matches = q === "" ? options : options.filter((o) => o.name.toLowerCase().includes(q));
  // The active option index, clamped into the current match list (the list can shrink as you type).
  const active = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Keep the keyboard-active option visible inside the scrollable popup.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionId derives from listId+index.
  }, [active, open]);

  // While `required`, hold a custom-validity error on the visible input until a real option is
  // chosen — native `required` alone only catches an EMPTY field, not a typed non-match.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && submittedId === null ? invalidText : "");
  }, [required, submittedId, invalidText]);

  const choose = (option: KindredComboboxOption) => {
    setSelectedId(option.id);
    setQuery(option.name);
    setOpen(false);
  };

  /** Close the popup; snap the text back to the chosen name so text and hidden id never disagree. */
  const close = ({ revert }: { revert: boolean }) => {
    setOpen(false);
    if (revert && selected) setQuery(selected.name);
  };

  return (
    <div
      ref={rootRef}
      className={s.root}
      onBlur={(e) => {
        // Clicking an option moves focus within the root — only close when focus truly leaves.
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          close({ revert: true });
        }
      }}
    >
      {submittedId ? <input type="hidden" name={name} value={submittedId} /> : null}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        className={s.input}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            else setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            // Pick the active option instead of submitting the surrounding form.
            if (open && active >= 0) {
              e.preventDefault();
              choose(matches[active]!);
            }
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            close({ revert: true });
          }
        }}
      />
      {open ? (
        <ul role="listbox" id={listId} aria-label={ariaLabel} className={s.list}>
          {matches.length === 0 ? (
            <li className={s.empty}>{noMatchesText}</li>
          ) : (
            matches.map((o, index) => (
              <li
                key={o.id}
                role="option"
                id={optionId(index)}
                aria-selected={o.id === selectedId}
                className={`${s.option}${index === active ? ` ${s.optionActive}` : ""}`}
                // onMouseDown beats the input's blur, so the click never closes the popup first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {o.name}
                {o.note ? <span className={s.note}> {o.note}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
