"use client";

/**
 * Optional photo picker for the Ask form (ADR-0009 Phase 3). Lets the asker attach one or more album
 * photos the question is ABOUT — "tell the story of THIS photo". It renders INSIDE the Ask `<form>`:
 * the selected photo ids ride out as hidden `subjectPhotoIds` inputs on the SAME form submit, so the
 * server action (`submitAsk` → `createAsk`) receives them via `formData.getAll("subjectPhotoIds")`.
 * `createAsk` re-runs the album-access gate per id server-side, so a tampered selection is rejected
 * there — this component only decides what to OFFER and what the user has ticked.
 *
 * Self-contained: fetches the asker's visible album photos via `loadAskPhotoOptionsAction` on mount
 * (auth re-resolved server-side). Elder-friendly: each photo is a large toggle button with an
 * accessible label; no drag, no native dialogs; errors surface inline. Real design tokens only.
 */
import { useEffect, useState } from "react";
import { hub } from "@/app/_copy";
import { loadAskPhotoOptionsAction, type AskAlbumPhoto } from "./ask-photo-actions";

export function AskPhotoPicker() {
  const [album, setAlbum] = useState<AskAlbumPhoto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadAskPhotoOptionsAction()
      .then((res) => {
        if (!active) return;
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setAlbum(res.album);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = (photoId: string) =>
    setSelected((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId],
    );

  // Nothing to offer (and no error) → render nothing, keeping the ask form uncluttered.
  if (loaded && album.length === 0 && !error) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p style={label}>{hub.ask.photosLabel}</p>
      <p style={help}>{hub.ask.photosHelp}</p>

      {/* Selected ids ride the ask form submit as repeated hidden inputs. */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="subjectPhotoIds" value={id} />
      ))}

      {error ? (
        <p aria-live="polite" style={errorText}>
          {error}
        </p>
      ) : null}

      {!loaded ? null : album.length === 0 ? (
        <p style={help}>{hub.ask.noAlbumPhotos}</p>
      ) : (
        <ul style={grid}>
          {album.map((p) => {
            const isSelected = selected.includes(p.photoId);
            return (
              <li key={p.photoId} style={{ margin: 0 }}>
                <button
                  type="button"
                  onClick={() => toggle(p.photoId)}
                  aria-pressed={isSelected}
                  aria-label={
                    isSelected
                      ? hub.ask.removePhotoAria(p.caption)
                      : hub.ask.attachPhotoAria(p.caption)
                  }
                  style={{
                    padding: 0,
                    border: isSelected
                      ? "3px solid var(--accent)"
                      : "3px solid transparent",
                    background: "transparent",
                    borderRadius: "var(--radius-md)",
                    cursor: "pointer",
                    display: "block",
                    width: "100%",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- audited byte route. */}
                  <img
                    src={`/api/album-photo/${p.photoId}`}
                    alt={hub.album.photoAlt(p.caption)}
                    style={tileImg}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── styles (real design tokens only) ─────────────────────────────────────── */
const label: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--support)",
  margin: 0,
};

const help: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: 0,
};

const errorText: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-danger, #b00)",
  margin: 0,
};

const grid: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "4px 0 0",
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
  gap: 10,
};

const tileImg: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  borderRadius: "var(--radius-sm)",
  display: "block",
  background: "var(--surface-sunken)",
};
