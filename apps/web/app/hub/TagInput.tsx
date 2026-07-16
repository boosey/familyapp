"use client";
/**
 * Unified tag field (spec 2026-07-13 §1). Tokenized input with a typeahead that suggests people,
 * families (which SHARE the story), and existing freeform tags. Presentational only — it emits
 * onAdd/onRemove intents and holds NO authorization. Family chips render distinct (they are access
 * grants); the caller decides whether removing one needs a confirm.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { hub } from "@/app/_copy";
import type { TagInputProps, TagToken } from "./tag-input-types";
import { tokenKey, familyTokenLabel } from "./tag-input-types";

export function TagInput({
  tokens,
  suggestions,
  onAdd,
  onRemove,
  disabled,
  nonRemovableTokenKeys,
}: TagInputProps) {
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const ql = q.toLowerCase();

  const has = useMemo(() => new Set(tokens.map(tokenKey)), [tokens]);

  const matchedPeople = useMemo(
    () =>
      q
        ? suggestions.people
            .filter((p) => p.displayName.toLowerCase().includes(ql))
            .filter((p) => !has.has(`person:${p.personId}`))
        : [],
    [q, ql, suggestions.people, has],
  );
  const matchedFamilies = useMemo(
    () =>
      q
        ? suggestions.families
            // Match the label the user sees (short name) as well as the formal name.
            .filter(
              (f) =>
                f.name.toLowerCase().includes(ql) ||
                (f.shortName?.toLowerCase().includes(ql) ?? false),
            )
            .filter((f) => !has.has(`family:${f.id}`))
        : [],
    [q, ql, suggestions.families, has],
  );
  const matchedTags = useMemo(
    () =>
      q
        ? suggestions.tags
            .filter((t) => t.toLowerCase().includes(ql))
            .filter((t) => !has.has(`text:${t}`))
        : [],
    [q, ql, suggestions.tags, has],
  );

  const add = (token: TagToken) => {
    onAdd(token);
    setQuery("");
  };

  const addText = () => {
    if (!q) return;
    // Tags are stored/sent as a comma-joined string (editStoryDetailsAction does tags.split(",")),
    // so a raw comma in a freeform tag would get silently split into two tags on save. Scrub it here.
    const clean = q.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) return;
    if (!has.has(`text:${clean}`)) add({ kind: "text", value: clean });
    else setQuery("");
  };

  const showDropdown = q.length > 0 && !dismissed;

  // Close on click outside
  useEffect(() => {
    if (!showDropdown) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDismissed(true);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showDropdown]);

  return (
    <div ref={containerRef} style={wrap}>
      {tokens.length > 0 && (
        <ul style={chipRow}>
          {tokens.map((t) => (
            <li key={tokenKey(t)} style={t.kind === "family" ? familyChip : chip}>
              <span title={t.kind === "family" ? hub.tagInput.familyChipTitle : undefined}>
                {t.kind === "text" ? t.value : t.kind === "person" ? t.displayName : familyTokenLabel(t)}
              </span>
              {nonRemovableTokenKeys?.has(tokenKey(t)) ? null : (
                <button
                  type="button"
                  aria-label={`${hub.tagInput.remove} ${
                    t.kind === "text" ? t.value : t.kind === "person" ? t.displayName : familyTokenLabel(t)
                  }`}
                  onClick={() => onRemove(t)}
                  disabled={disabled}
                  style={chipRemove}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder={hub.tagInput.placeholder}
        aria-label={hub.tagInput.label}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addText();
          } else if (e.key === "Escape") {
            setDismissed(true);
          }
        }}
        style={field}
      />

      {showDropdown && (
        <div role="group" aria-label={hub.tagInput.label} style={dropdown}>
          {matchedFamilies.length > 0 && <p style={groupLabel}>{hub.tagInput.groupFamilies}</p>}
          {matchedFamilies.map((f) => (
            <button
              key={`f-${f.id}`}
              type="button"
              disabled={disabled}
              style={option}
              onClick={() => add({ kind: "family", familyId: f.id, name: f.name, shortName: f.shortName })}
            >
              {familyTokenLabel(f)}
            </button>
          ))}

          {matchedPeople.length > 0 && <p style={groupLabel}>{hub.tagInput.groupPeople}</p>}
          {matchedPeople.map((p) => (
            <button
              key={`p-${p.personId}`}
              type="button"
              disabled={disabled}
              style={option}
              onClick={() => add({ kind: "person", personId: p.personId, displayName: p.displayName })}
            >
              {p.displayName}
            </button>
          ))}

          {matchedTags.length > 0 && <p style={groupLabel}>{hub.tagInput.groupTags}</p>}
          {matchedTags.map((t) => (
            <button
              key={`t-${t}`}
              type="button"
              disabled={disabled}
              style={option}
              onClick={() => add({ kind: "text", value: t })}
            >
              {t}
            </button>
          ))}

          {/* Always-available creators. */}
          <button type="button" disabled={disabled} style={option} onClick={addText}>
            {hub.tagInput.addAsTag(q)}
          </button>
          <button
            type="button"
            disabled={disabled}
            style={option}
            onClick={() => add({ kind: "person", personId: null, displayName: q })}
          >
            {hub.tagInput.addAsPerson(q)}
          </button>
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { position: "relative", display: "grid", gap: 10 };
const chipRow: React.CSSProperties = {
  listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8,
};
const chip: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  fontFamily: "var(--font-ui)", fontSize: "var(--text-label)", fontWeight: 500,
  color: "var(--text-muted)", border: "1.5px solid var(--border-strong)",
  borderRadius: "var(--radius-pill)", padding: "4px 10px",
};
const familyChip: React.CSSProperties = {
  ...chip, color: "var(--accent-strong)", background: "var(--accent-soft)",
  borderColor: "var(--accent-strong)",
};
const chipRemove: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "inherit",
  fontSize: "0.85em", lineHeight: 1, padding: 0,
};
const field: React.CSSProperties = {
  padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--surface-card)", fontFamily: "var(--font-ui)", fontSize: "var(--text-ui)",
  color: "var(--text-body)", width: "100%", boxSizing: "border-box",
};
const dropdown: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, marginTop: 4,
  background: "var(--surface-card)", border: "1.5px solid var(--border)",
  borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lift)", padding: 6,
  display: "flex", flexDirection: "column", gap: 2, maxHeight: 280, overflowY: "auto",
};
const groupLabel: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "var(--text-label)", textTransform: "uppercase",
  letterSpacing: "0.06em", color: "var(--support)", margin: "6px 8px 2px",
};
const option: React.CSSProperties = {
  textAlign: "left", background: "transparent", border: "none", cursor: "pointer",
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-body)",
  padding: "8px 10px", borderRadius: "var(--radius-md)", width: "100%",
};
