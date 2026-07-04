"use client";

/**
 * Album upload control (ADR-0009 · #15 · #16). A file input + submit that calls the
 * `uploadAlbumPhotoAction` server action (which re-resolves auth and re-validates the target albums
 * server-side — the client passes only the files + its picker choice). On success it refreshes the
 * server component so the new tiles appear; on failure it surfaces the action's error string.
 *
 * Multi-select (#16): the file input carries `multiple`, so the OS picker lets the contributor
 * choose MANY photos at once. A `multiple` input serializes as repeated `photo` entries on the
 * FormData, which the action reads via `getAll("photo")` — each selected file becomes its own album
 * photo placed into the SAME chosen album(s). The action returns a batch summary (`added`/`failed`);
 * a partial success (some files failed) surfaces a gentle inline note rather than an error.
 *
 * #16 — multi-family placement: a contributor in >=2 families sees a checkbox per family and chooses
 * which albums receive the batch. The default pre-selection is the album currently on screen
 * (`currentFamilyId`), pre-checked but deselectable; at least one must stay selected. A solo-family
 * contributor sees NO checkboxes — the server defaults to the sole family (behavior unchanged).
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAlbumPhotoAction } from "./actions";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";

export interface AlbumFamilyOption {
  familyId: string;
  familyName: string;
}

/** Most photos per batch — kept in sync with the server's MAX_BATCH_FILES (the server is authoritative). */
const MAX_BATCH_FILES = 30;

export function AlbumUploader({
  families,
  currentFamilyId,
}: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A gentle, non-error note after a partial-success batch (some files landed, some didn't).
  const [note, setNote] = useState<string | null>(null);
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
    // A `multiple` file input serializes as repeated `photo` entries in the browser, but some
    // environments (jsdom under test) only keep the first. Re-append every selected file explicitly
    // so each becomes its own `photo` entry the action reads via getAll("photo") — deterministic
    // everywhere, and a no-op net effect in a real browser (delete then re-append the same files).
    const input = fileInputRef.current;
    if (input?.files && input.files.length > 0) {
      formData.delete("photo");
      for (const file of Array.from(input.files)) formData.append("photo", file);
    }
    // Guard the obvious mistake client-side (fast, friendly) before spending an upload; the server
    // re-checks the same cap and is authoritative.
    if ((input?.files?.length ?? 0) > MAX_BATCH_FILES) {
      setError(hub.actions.tooManyPhotos);
      setNote(null);
      return;
    }
    startTransition(async () => {
      // The action can REJECT (throw) rather than return an error shape — most notably when the
      // request body exceeds the Server Action / platform size limit. Without this catch that
      // rejection is swallowed by the transition and the upload silently does nothing; surface a
      // clear, actionable message instead.
      let result;
      try {
        result = await uploadAlbumPhotoAction(formData);
      } catch {
        setError(hub.album.uploadError);
        setNote(null);
        return;
      }
      if ("error" in result) {
        setError(result.error);
        setNote(null);
        return;
      }
      setError(null);
      // A partial success (batch had ≥1 failure) is not an error — surface a soft note so the
      // contributor knows exactly what landed and can retry the rest.
      setNote(
        result.failed > 0
          ? hub.album.photosPartial(result.added, result.failed)
          : null,
      );
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
          ref={fileInputRef}
          type="file"
          name="photo"
          accept="image/*"
          multiple
          required
          disabled={pending}
          onChange={(e) => setHasFile((e.currentTarget.files?.length ?? 0) > 0)}
          style={{ display: "block", marginTop: 8 }}
        />
      </label>

      {showPicker ? (
        <fieldset
          style={{
            border: "var(--border-width) solid var(--border)",
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
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
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

      <KindredButton
        type="submit"
        variant="primary"
        size="small"
        disabled={submitDisabled}
        style={{ alignSelf: "flex-start" }}
      >
        {hub.album.addButton}
      </KindredButton>

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--accent-strong)",
            background: "var(--accent-soft)",
            border: "var(--border-width) solid var(--accent)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            margin: 0,
          }}
        >
          {error}
        </p>
      ) : null}

      {note ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {note}
        </p>
      ) : null}
    </form>
  );
}
