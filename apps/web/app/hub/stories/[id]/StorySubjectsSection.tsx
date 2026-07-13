"use client";

/**
 * "Who this is about" — story-subject tagging (issue #35).
 *
 * A viewer who can SEE the story can tag who it depicts and untag them. Tagging by name here uses
 * the inline-mention path (core mints an identified `mention` Person and links it in one op). Both
 * actions delegate to SEE-gated server actions; this component authors no authorization.
 *
 * Kindred-consistent: card list + a single name field, matching the kin surface idiom.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { tagStorySubjectAction, untagStorySubjectAction } from "./actions";

export interface SubjectRow {
  personId: string;
  displayName: string | null;
}

export function StorySubjectsSection({
  storyId,
  subjects,
  canEdit,
}: {
  storyId: string;
  subjects: SubjectRow[];
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAdd(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await tagStorySubjectAction(formData);
      if (result && "error" in result && result.error) setError(result.error);
    });
  }

  function onRemove(personId: string) {
    setError(null);
    const formData = new FormData();
    formData.set("storyId", storyId);
    formData.set("personId", personId);
    startTransition(async () => {
      const result = await untagStorySubjectAction(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <section style={{ marginTop: 40 }}>
      <h2
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          fontWeight: 500,
          color: "var(--text-body)",
          margin: "0 0 16px",
        }}
      >
        {hub.subjects.heading}
      </h2>

      {subjects.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-muted)",
            margin: "0 0 16px",
          }}
        >
          {hub.subjects.empty}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0, display: "grid", gap: 12 }}>
          {subjects.map((s) => (
            <li
              key={s.personId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "12px 18px",
              }}
            >
              <Link
                href={`/hub/about/${s.personId}`}
                style={{
                  fontFamily: "var(--font-story)",
                  fontSize: "var(--text-story)",
                  color: "var(--text-body)",
                  textDecoration: "none",
                }}
              >
                {s.displayName ?? "—"}
              </Link>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onRemove(s.personId)}
                  disabled={pending}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-ui-sm)",
                    color: "var(--text-muted)",
                    background: "none",
                    border: "none",
                    cursor: pending ? "default" : "pointer",
                  }}
                >
                  {hub.subjects.remove}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form action={onAdd} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="storyId" value={storyId} />
          <label className="kin-form-label">
            {hub.subjects.addLabel}
            <input
              type="text"
              name="newPersonDisplayName"
              className="kin-field"
              placeholder={hub.subjects.namePlaceholder}
              autoComplete="off"
            />
          </label>
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
          <KindredButton
            type="submit"
            label={pending ? hub.subjects.adding : hub.subjects.add}
            disabled={pending}
          />
        </form>
      ) : null}
    </section>
  );
}
