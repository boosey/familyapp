"use client";
/**
 * Client discovery surface for /families/find. Lists discoverable families by default and filters
 * them live as you type (design: empty query shows the browse list, typing narrows it, with a mono
 * count label). Filtering is name/steward-only on purpose — the server hands over ONLY family name
 * + steward name (the leak-safe discovery contract; members and stories never cross to the client).
 *
 * "Request to join" still posts to the server action passed in as `action`; the per-result note for
 * the steward is preserved.
 */
import { useMemo, useState } from "react";
import { ActionButton } from "@/app/_kindred/ActionButton";
import { families as copy } from "@/app/_copy";
import type { DiscoverableFamily } from "@chronicle/core";

/** First letter of the family name, ignoring a leading "The ". */
function initialOf(name: string): string {
  const stripped = name.trim().replace(/^the\s+/i, "");
  return (stripped[0] ?? name.trim()[0] ?? "?").toUpperCase();
}

export function FamilyFinder({
  discoverable,
  action,
}: {
  discoverable: DiscoverableFamily[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return discoverable;
    return discoverable.filter(
      (f) =>
        f.familyName.toLowerCase().includes(q) ||
        f.stewardName.toLowerCase().includes(q),
    );
  }, [discoverable, q]);

  const label = q ? copy.find.matchCount(filtered.length) : copy.find.browseLabel;
  const showNoMatch = q.length > 0 && filtered.length === 0;

  return (
    <div style={{ marginTop: 24 }}>
      <input
        name="q"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="kin-field"
        placeholder={copy.find.searchPlaceholder}
        aria-label={copy.find.title}
        style={{ width: "100%" }}
      />

      {showNoMatch ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "18px 0 0",
            lineHeight: "var(--leading-body)",
          }}
        >
          {copy.find.noMatches(query.trim())}
        </p>
      ) : null}

      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          letterSpacing: "var(--tracking-mono)",
          textTransform: "uppercase",
          color: "var(--support)",
          margin: "26px 0 14px",
        }}
      >
        {label}
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 14 }}>
        {filtered.map((f) => (
          <li
            key={f.familyId}
            style={{
              background: "var(--surface-card)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-sm)",
              padding: "22px 24px",
            }}
          >
            <form action={action} style={{ display: "grid", gap: 14 }}>
              <input type="hidden" name="familyId" value={f.familyId} />
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    background: "var(--accent-soft)",
                    color: "var(--accent-strong)",
                    fontFamily: "var(--font-story)",
                    fontSize: "var(--text-story)",
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {initialOf(f.familyName)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-story)",
                      fontSize: "var(--text-story-lg)",
                      fontWeight: 500,
                      color: "var(--text-body)",
                      margin: 0,
                    }}
                  >
                    {f.familyName}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui-sm)",
                      color: "var(--text-muted)",
                      margin: "4px 0 0",
                    }}
                  >
                    {copy.find.stewardMeta(f.stewardName)}
                  </p>
                </div>
              </div>
              <textarea
                name="message"
                className="kin-field"
                placeholder={copy.find.notePlaceholder}
                style={{ minHeight: 72 }}
              />
              <div>
                <ActionButton
                  type="submit"
                  label={copy.find.requestToJoin}
                  variant="secondary"
                />
              </div>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
