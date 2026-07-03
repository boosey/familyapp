"use client";

/**
 * Album upload control (ADR-0009 · #15 · #16). A file input + submit that calls the
 * `uploadAlbumPhotoAction` server action (which re-resolves auth and re-validates the target albums
 * server-side — the client passes only the file + its picker choice). On success it refreshes the
 * server component so the new tile appears; on failure it surfaces the action's error string.
 *
 * #16 — multi-family placement: a contributor in >=2 families sees a checkbox per family and chooses
 * which albums receive the photo. The default pre-selection is the album currently on screen
 * (`currentFamilyId`), pre-checked but deselectable; at least one must stay selected. A solo-family
 * contributor sees NO checkboxes — the server defaults to the sole family (behavior unchanged).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAlbumPhotoAction } from "./actions";
import { hub } from "@/app/_copy";

export interface AlbumFamilyOption {
  familyId: string;
  familyName: string;
}

export function AlbumUploader({
  families,
  currentFamilyId,
}: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);
  // Multi-family picker state: default to ONLY the current family context (never all).
  const showPicker = families.length > 1;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set([currentFamilyId]),
  );
  // The family switcher is a same-route soft navigation, so this component is NOT remounted — only
  // `currentFamilyId` changes. Re-seed the picker to ONLY the new context family whenever it changes
  // (the "adjust state during render on a prop change" pattern), so the default always tracks the
  // album on screen. An in-progress selection is left untouched while the context stays the same.
  const [prevCurrent, setPrevCurrent] = useState(currentFamilyId);
  if (prevCurrent !== currentFamilyId) {
    setPrevCurrent(currentFamilyId);
    setSelected(new Set([currentFamilyId]));
  }

  function toggle(familyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await uploadAlbumPhotoAction(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      formRef.current?.reset();
      setHasFile(false);
      setSelected(new Set([currentFamilyId]));
      router.refresh();
    });
  }

  // >=1 album must stay selected when the picker is shown.
  const submitDisabled =
    pending || !hasFile || (showPicker && selected.size === 0);

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}
    >
      <label
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-sm)",
          color: "var(--text-meta)",
        }}
      >
        {hub.album.addLabel}
        <input
          type="file"
          name="photo"
          accept="image/*"
          required
          disabled={pending}
          onChange={(e) => setHasFile((e.currentTarget.files?.length ?? 0) > 0)}
          style={{ display: "block", marginTop: 8 }}
        />
      </label>

      {showPicker ? (
        <fieldset
          style={{
            border: "1px solid var(--border-subtle, #ddd)",
            borderRadius: 8,
            padding: "12px 14px",
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <legend
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              padding: "0 6px",
            }}
          >
            {hub.album.chooseAlbums}
          </legend>
          {families.map((f) => (
            <label
              key={f.familyId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui-md)",
                color: "var(--text-strong)",
                padding: "8px 6px",
                cursor: pending ? "default" : "pointer",
              }}
            >
              <input
                type="checkbox"
                name="familyIds"
                value={f.familyId}
                checked={selected.has(f.familyId)}
                disabled={pending}
                onChange={() => toggle(f.familyId)}
                style={{ width: 20, height: 20, flexShrink: 0 }}
              />
              {f.familyName}
            </label>
          ))}
        </fieldset>
      ) : null}

      <button
        type="submit"
        disabled={submitDisabled}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-md)",
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent, #333)",
          color: "var(--on-accent, #fff)",
          cursor: submitDisabled ? "default" : "pointer",
          opacity: submitDisabled ? 0.6 : 1,
          alignSelf: "flex-start",
        }}
      >
        {hub.album.addButton}
      </button>

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-danger, #b00)",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
