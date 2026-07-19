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
import { tokenKey, familyTokenLabel } from "@/app/hub/tag-input-types";
import {
  editStoryDetailsAction,
  editStoryProseAction,
  tagStorySubjectAction,
  untagStorySubjectAction,
  retargetStoryFamiliesAction,
} from "./actions";
import styles from "./StoryEditor.module.css";

/** A family this story is (or will be) shared with. `shortName` (ADR-0021) is the chip's display
 *  label when set; `name` is the formal fallback. */
export type TargetFamily = { id: string; name: string; shortName?: string | null };

export interface StoryEditorProps {
  storyId: string;
  initialTitle: string;
  initialTags: string[];
  initialProse: string;
  initialPersonSubjects: { personId: string; displayName: string }[];
  initialTargetFamilies: TargetFamily[];
  suggestions: TagSuggestions;
  onClose: (next: { title: string; tags: string[]; prose: string; targetFamilies: TargetFamily[] }) => void;
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
      ...families.map((f): TagToken => ({ kind: "family", familyId: f.id, name: f.name, shortName: f.shortName })),
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
        setError(hub.storyDetail.genericError);
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

  const saveFamilies = (nextFamilies: TargetFamily[]) => {
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
      saveFamilies([...families, { id: token.familyId, name: token.name, shortName: token.shortName }]);
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
      if (!confirm(hub.tagInput.confirmRevoke(familyTokenLabel(token)))) return;
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

  // Save persists title + prose (tags/people/families already wrote through on each edit), then
  // closes the editor back to the read-only view — but only if the save succeeded. On error the
  // surface stays open so the person can retry without losing their edits.
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
    startTransition(async () => {
      try {
        const d = await editStoryDetailsAction(fdD);
        if (d && "error" in d && d.error) {
          setError(d.error);
          return;
        }
        const p = await editStoryProseAction(fdP);
        if (p && "error" in p && p.error) {
          setError(p.error);
          return;
        }
        setError(null);
        setSavedTitle(title);
        onClose({ title, tags, prose, targetFamilies: families });
      } catch {
        setError(hub.storyDetail.genericError);
      }
    });
  };

  return (
    <div className={styles.form}>
      <label className={styles.fieldLabel}>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
          required
          className={styles.textField}
        />
      </label>
      {titleError && <p role="alert" className={styles.errText}>{titleError}</p>}

      <div className={styles.tagField}>
        <span className={styles.fieldLabel}>{hub.tagInput.label}</span>
        <p className={styles.helpText}>{hub.tagInput.help}</p>
        <TagInput
          tokens={tokens}
          suggestions={suggestions}
          onAdd={onAdd}
          onRemove={onRemove}
          disabled={pending}
          nonRemovableTokenKeys={nonRemovableTokenKeys}
        />
      </div>

      <label className={styles.fieldLabel}>
        Story
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          disabled={pending}
          rows={12}
          className={styles.textArea}
        />
      </label>

      <div ref={photosRef}>
        <StoryPhotosEditor storyId={storyId} />
      </div>

      {error && <p role="alert" className={styles.errText}>{error}</p>}

      <div className={styles.actions}>
        <KindredButton
          type="button"
          label={hub.storyDetail.cancel}
          variant="ghost"
          disabled={pending}
          onClick={() => onClose({ title, tags, prose, targetFamilies: families })}
        />
        <KindredButton
          type="button"
          label={pending ? hub.storyDetail.saving : hub.storyDetail.save}
          disabled={pending}
          onClick={saveTitleAndProse}
        />
      </div>
    </div>
  );
}
