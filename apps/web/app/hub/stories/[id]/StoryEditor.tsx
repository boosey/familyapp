"use client";
/**
 * Consolidated story editor (spec 2026-07-13 §3). One inline surface: title · TagInput · prose ·
 * photos. Replaces the old Edit-details form, Edit-prose form, and the "Who this is about" section.
 * Each token kind writes through its OWN existing server action; family removal (a consent revoke)
 * confirms first. This component names WHICH story; the server actions re-resolve auth + ownership.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { TagInput } from "@/app/hub/TagInput";
import { StoryPhotosEditor } from "@/app/hub/StoryPhotosEditor";
import type { TagSuggestions, TagToken } from "@/app/hub/tag-input-types";
import { tokenKey } from "@/app/hub/tag-input-types";
import {
  editStoryDetailsAction,
  editStoryProseAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
} from "./actions";

export interface StoryEditorProps {
  storyId: string;
  initialTitle: string;
  initialTags: string[];
  initialProse: string;
  initialPersonSubjects: { personId: string; displayName: string }[];
  initialTargetFamilies: { id: string; name: string }[];
  suggestions: TagSuggestions;
  onClose: (next: { title: string; tags: string[]; prose: string; targetFamilies: { id: string; name: string }[] }) => void;
  /** When true, StoryPhotosEditor scrolls into view on mount (kebab "Add Photos"). */
  focusPhotos?: boolean;
}

export function StoryEditor(props: StoryEditorProps) {
  const { storyId, suggestions, onClose } = props;
  const [title, setTitle] = useState(props.initialTitle);
  const [savedTitle, setSavedTitle] = useState(props.initialTitle);
  const [tags, setTags] = useState<string[]>(props.initialTags);
  const [prose, setProse] = useState(props.initialProse);
  const [people, setPeople] = useState(props.initialPersonSubjects);
  const [families, setFamilies] = useState(props.initialTargetFamilies);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const photosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.focusPhotos) photosRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [props.focusPhotos]);

  const tokens: TagToken[] = useMemo(
    () => [
      ...tags.map((value): TagToken => ({ kind: "text", value })),
      ...people.map((p): TagToken => ({ kind: "person", personId: p.personId, displayName: p.displayName })),
      ...families.map((f): TagToken => ({ kind: "family", familyId: f.id, name: f.name })),
    ],
    [tags, people, families],
  );

  // A story shared with exactly ONE family can't have that last family removed here — dropping it
  // would silently un-share the story. The chip stays (no ✕); with two or more, any is removable.
  const nonRemovableTokenKeys = useMemo(
    () =>
      families.length === 1
        ? new Set([tokenKey({ kind: "family", familyId: families[0]!.id, name: families[0]!.name })])
        : new Set<string>(),
    [families],
  );

  const run = (
    fn: () => Promise<{ error?: string; personId?: string } | undefined>,
    revert?: () => void,
  ) =>
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && "error" in res && res.error) {
          setError(res.error);
          revert?.();
        } else {
          setError(null);
        }
      } catch {
        setError("Something went wrong. Please try again.");
        revert?.();
      }
    });

  const saveTags = (nextTags: string[]) => {
    const prev = tags;
    setTags(nextTags);
    const fd = new FormData();
    fd.set("storyId", storyId);
    fd.set("title", savedTitle);
    fd.set("tags", nextTags.join(","));
    run(() => editStoryDetailsAction(fd), () => setTags(prev));
  };

  const saveFamilies = (nextFamilies: { id: string; name: string }[]) => {
    const prev = families;
    setFamilies(nextFamilies);
    const fd = new FormData();
    fd.set("storyId", storyId);
    for (const f of nextFamilies) fd.append("familyIds", f.id);
    run(() => retargetStoryFamiliesAction(fd), () => setFamilies(prev));
  };

  const onAdd = (token: TagToken) => {
    if (token.kind === "text") {
      saveTags([...tags, token.value]);
    } else if (token.kind === "family") {
      saveFamilies([...families, { id: token.familyId, name: token.name }]);
    } else if (token.personId) {
      const prev = people;
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("personId", token.personId);
      setPeople((cur) => [...cur, { personId: token.personId!, displayName: token.displayName }]);
      run(() => tagStorySubjectAction(fd), () => setPeople(prev));
    } else {
      // Newly minted person: the server mints a real Person id we don't have yet. Insert an
      // optimistic placeholder under a stable temp key, then replace it with the real id once
      // the action resolves — so a same-session remove posts the REAL id, not the placeholder.
      const tempKey = `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const displayName = token.displayName;
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("newPersonDisplayName", displayName);
      setPeople((cur) => [...cur, { personId: tempKey, displayName }]);
      startTransition(async () => {
        const res = await tagStorySubjectAction(fd);
        if (res && "error" in res && res.error) {
          setError(res.error);
          setPeople((cur) => cur.filter((p) => p.personId !== tempKey));
          return;
        }
        setError(null);
        if (res && "personId" in res && res.personId) {
          const realId = res.personId;
          setPeople((cur) =>
            cur.map((p) => (p.personId === tempKey ? { personId: realId, displayName } : p)),
          );
        }
      });
    }
  };

  const onRemove = (token: TagToken) => {
    if (token.kind === "text") {
      saveTags(tags.filter((t) => t !== token.value));
    } else if (token.kind === "family") {
      // Never remove the last family (belt-and-suspenders — TagInput already hides its ✕).
      if (families.length <= 1) return;
      if (!confirm(hub.tagInput.confirmRevoke(token.name))) return;
      saveFamilies(families.filter((f) => f.id !== token.familyId));
    } else {
      const prev = people;
      setPeople((cur) => cur.filter((p) => p.personId !== token.personId));
      const fd = new FormData();
      fd.set("storyId", storyId);
      fd.set("personId", token.personId ?? "");
      run(() => untagStorySubjectAction(fd), () => setPeople(prev));
    }
  };

  const saveTitleAndProse = () => {
    if (!title.trim()) {
      setTitleError("Title can't be empty.");
      return;
    }
    setTitleError(null);
    const fdD = new FormData();
    fdD.set("storyId", storyId);
    fdD.set("title", title);
    fdD.set("tags", tags.join(","));
    const fdP = new FormData();
    fdP.set("storyId", storyId);
    fdP.set("prose", prose);
    run(async () => {
      const d = await editStoryDetailsAction(fdD);
      if (d && "error" in d && d.error) return d;
      const p = await editStoryProseAction(fdP);
      if (p && "error" in p && p.error) return p;
      setSavedTitle(title);
      return p;
    });
  };

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <label style={fieldLabel}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          required
          style={textField}
        />
      </label>
      {titleError && <p role="alert" style={errText}>{titleError}</p>}

      <div style={{ display: "grid", gap: 6 }}>
        <span style={fieldLabel}>{hub.tagInput.label}</span>
        <p style={helpText}>{hub.tagInput.help}</p>
        <TagInput
          tokens={tokens}
          suggestions={suggestions}
          onAdd={onAdd}
          onRemove={onRemove}
          disabled={pending}
          nonRemovableTokenKeys={nonRemovableTokenKeys}
        />
      </div>

      <label style={fieldLabel}>
        Story
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          disabled={pending}
          rows={12}
          style={{ ...textField, fontFamily: "var(--font-story)", resize: "vertical" }}
        />
      </label>

      <div ref={photosRef}>
        <StoryPhotosEditor storyId={storyId} />
      </div>

      {error && <p role="alert" style={errText}>{error}</p>}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <KindredButton
          type="button"
          label="Cancel"
          variant="ghost"
          disabled={pending}
          onClick={() => onClose({ title, tags, prose, targetFamilies: families })}
        />
        <KindredButton
          type="button"
          label={pending ? "Saving…" : "Save"}
          disabled={pending}
          onClick={saveTitleAndProse}
        />
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "grid", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", fontWeight: 600,
  color: "var(--text-body)",
};
const helpText: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-muted)", margin: 0,
};
const textField: React.CSSProperties = {
  padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
  background: "var(--surface-card)", fontSize: "var(--text-ui)", color: "var(--text-body)",
  width: "100%", boxSizing: "border-box",
};
const errText: React.CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-danger, #b00)", margin: 0,
};
