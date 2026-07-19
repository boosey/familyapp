/**
 * SearchField — the ONE reusable search input (see SearchField.module.css). A native search box
 * (role "searchbox") sized to the ActionButton height, used by the Stories browse toolbar (#3) and the
 * Album filter bar so the two can't drift apart. Server-safe: no hooks, no "use client" (the client
 * parent owns the value/onChange state). Reports the raw next string, not the event.
 */
import s from "./SearchField.module.css";

export interface SearchFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Accessible name (there is no visible label — the placeholder is the visible hint). */
  ariaLabel: string;
  placeholder?: string;
  /** Extra class merged after `.field` (e.g. a width override for a specific host). */
  className?: string;
}

export function SearchField({ value, onChange, ariaLabel, placeholder, className }: SearchFieldProps) {
  return (
    <input
      type="search"
      className={className ? `${s.field} ${className}` : s.field}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      placeholder={placeholder}
    />
  );
}
