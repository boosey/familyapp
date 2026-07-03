"use client";

/**
 * Album upload control (ADR-0009 · #15). A minimal file input + submit that calls the
 * `uploadAlbumPhotoAction` server action (which re-resolves auth and the target family server-side —
 * the client passes only the file). On success it refreshes the server component so the new tile
 * appears; on failure it surfaces the action's error string.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadAlbumPhotoAction } from "./actions";
import { hub } from "@/app/_copy";

export function AlbumUploader() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
      router.refresh();
    });
  }

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
          style={{ display: "block", marginTop: 8 }}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui-md)",
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent, #333)",
          color: "var(--on-accent, #fff)",
          cursor: pending ? "default" : "pointer",
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
