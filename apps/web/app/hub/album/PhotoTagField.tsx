"use client";

/**
 * PhotoTagField (Phase B3) — a SMALL, self-contained typeahead used by the photo tag panel for the
 * Subjects / People / Places sections. Deliberately NOT the story `TagInput`: that field couples
 * families + people into one control; here each section manages ONE kind of tag, so a dedicated,
 * simpler field is clearer and easier to reason about.
 *
 * Renders the existing chips (each with a remove ✕ button unless read-only), then a text input.
 * Typing filters `suggestions` (case-insensitive, excluding already-added ids) into a small dropdown.
 * Clicking a suggestion → onAdd({id}). Pressing Enter (or clicking the "Add \"X\" as new" row shown
 * when no suggestion matches the typed text exactly) → onAdd({newName}). When `disabled`, the chips
 * render read-only and no input/dropdown shows.
 */
import { useId, useMemo, useState, type RefObject } from "react";

export interface PhotoTagFieldChip {
  id: string;
  label: string;
  /** An optimistic chip whose add server-action is still in flight — its remove is disabled until it
   *  resolves, so a chip can't be un-tagged before it is confirmed tagged (avoids a ghost-tag desync). */
  pending?: boolean;
}

export interface PhotoTagFieldSuggestion {
  id: string;
  label: string;
}

export function PhotoTagField({
  label,
  help,
  placeholder,
  chips,
  suggestions,
  onAdd,
  onRemove,
  addNamedCopy,
  removeCopy,
  disabled = false,
  inputRef,
  id,
}: {
  label: string;
  help: string;
  placeholder: string;
  chips: PhotoTagFieldChip[];
  suggestions: PhotoTagFieldSuggestion[];
  onAdd: (opt: { id: string } | { newName: string }) => void;
  onRemove: (id: string) => void;
  addNamedCopy: (name: string) => string;
  removeCopy: (name: string) => string;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  id?: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const helpId = `${fieldId}-help`;
  const [query, setQuery] = useState("");

  const chipIds = useMemo(() => new Set(chips.map((c) => c.id)), [chips]);
  const trimmed = query.trim();

  // Case-insensitive filter, excluding anything already chipped.
  const filtered = useMemo(() => {
    if (trimmed === "") return [] as PhotoTagFieldSuggestion[];
    const q = trimmed.toLowerCase();
    return suggestions.filter(
      (s) => !chipIds.has(s.id) && s.label.toLowerCase().includes(q),
    );
  }, [suggestions, chipIds, trimmed]);

  const hasExactMatch = useMemo(
    () => filtered.some((s) => s.label.toLowerCase() === trimmed.toLowerCase()),
    [filtered, trimmed],
  );
  const canCreate = trimmed !== "" && !hasExactMatch;

  function addExisting(sId: string) {
    onAdd({ id: sId });
    setQuery("");
  }
  function addNew() {
    if (trimmed === "") return;
    onAdd({ newName: trimmed });
    setQuery("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        htmlFor={disabled ? undefined : fieldId}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          fontWeight: 600,
          color: "var(--text-body)",
        }}
      >
        {label}
      </label>
      <p
        id={helpId}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-meta)",
          margin: 0,
        }}
      >
        {help}
      </p>

      {chips.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {chips.map((chip) => (
            <li key={chip.id}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: disabled ? "8px 14px" : "6px 6px 6px 14px",
                  background: "var(--surface-sunken)",
                  border: "var(--border-width) solid var(--border)",
                  borderRadius: "var(--radius-pill)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-ui-sm)",
                  color: "var(--text-body)",
                }}
              >
                {chip.label}
                {disabled ? null : (
                  <button
                    type="button"
                    aria-label={removeCopy(chip.label)}
                    title={removeCopy(chip.label)}
                    // A pending (in-flight add) chip can't be removed until its add resolves — this is
                    // what prevents an untag racing ahead of its own tag and desyncing from the server.
                    disabled={chip.pending}
                    onClick={() => onRemove(chip.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      padding: 0,
                      border: "none",
                      borderRadius: "50%",
                      background: "transparent",
                      color: "var(--text-meta)",
                      cursor: chip.pending ? "wait" : "pointer",
                      opacity: chip.pending ? 0.5 : 1,
                      fontSize: "0.9rem",
                      lineHeight: 1,
                    }}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {disabled ? null : (
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            id={fieldId}
            type="text"
            role="combobox"
            aria-expanded={filtered.length > 0 || canCreate}
            aria-describedby={helpId}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canCreate) addNew();
                else if (filtered.length > 0) addExisting(filtered[0]!.id);
              }
            }}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui)",
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              border: "var(--border-width) solid var(--border)",
              width: "100%",
              boxSizing: "border-box",
            }}
          />

          {filtered.length > 0 || canCreate ? (
            <ul
              role="listbox"
              style={{
                listStyle: "none",
                margin: "4px 0 0",
                padding: 4,
                position: "absolute",
                zIndex: 10,
                left: 0,
                right: 0,
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-sm)",
                boxShadow: "var(--shadow-lift)",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => addExisting(s.id)}
                    style={optionButtonStyle}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
              {canCreate ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={addNew}
                    style={optionButtonStyle}
                  >
                    {addNamedCopy(trimmed)}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

const optionButtonStyle = {
  display: "block",
  width: "100%",
  textAlign: "left" as const,
  padding: "8px 10px",
  border: "none",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--text-body)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  cursor: "pointer",
};
