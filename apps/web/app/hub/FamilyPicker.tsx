"use client";

/**
 * Shared multi-family checkbox picker for chosen-audience content (asks, album uploads, stories).
 * Controlled: the parent owns the selected set. Each checked box posts its family id under `name`
 * (default "familyIds"), read server-side via `formData.getAll(name)`. The caller decides WHEN to
 * render it — every surface hides it for a single-family actor (nothing to choose) and auto-resolves
 * the sole family server-side. When `required`, a visually-hidden focusable input mirrors "≥1 checked"
 * so native form validation blocks an empty submit; server guards backstop it.
 */
export interface FamilyOption {
  familyId: string;
  familyName: string;
}

export function FamilyPicker({
  families,
  selected,
  onToggle,
  name = "familyIds",
  disabled = false,
  required = false,
  requiredMessage,
}: {
  families: FamilyOption[];
  selected: Set<string>;
  onToggle: (familyId: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  requiredMessage?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {families.map((f) => (
        <label
          key={f.familyId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            color: "var(--text-body)",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            name={name}
            value={f.familyId}
            checked={selected.has(f.familyId)}
            disabled={disabled}
            onChange={() => onToggle(f.familyId)}
          />
          {f.familyName}
        </label>
      ))}
      {required ? (
        <input
          type="text"
          tabIndex={-1}
          aria-hidden="true"
          required
          value={selected.size > 0 ? "ok" : ""}
          onChange={() => {}}
          onInvalid={(e) =>
            (e.currentTarget as HTMLInputElement).setCustomValidity(requiredMessage ?? "Choose at least one family.")
          }
          onInput={(e) => (e.currentTarget as HTMLInputElement).setCustomValidity("")}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
      ) : null}
    </div>
  );
}
