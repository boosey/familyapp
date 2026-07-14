"use client";

/**
 * PhotoTagPanel (Phase B3) — the album viewer's tag-management surface. Four labeled sections:
 *   - Subjects  → who the photo is ABOUT   (Person tags, subject variant)
 *   - People    → who APPEARS in it        (Person tags, appears-in variant)
 *   - Places    → where                    (Place tags)
 *   - Family    → which album(s) it lives in (a PLACEMENT, not a tag → FamilyPicker)
 *
 * The panel loads its own detail+suggestions (via `loadPhotoTagPanelAction`) unless `initial` is
 * supplied, and renders for ALL viewers — tags are viewable. ALL editing self-gates on
 * `detail.canManage`: a non-manager gets read-only chips and a static family list, no inputs, no
 * toggles. `canManage` only decides whether to SHOW inputs; the server actions re-check authorization
 * and are authoritative. Mutations are optimistic (chip added/removed immediately) and roll back on a
 * `{ error }` result, surfacing an inline alert; on success `router.refresh()` propagates to the grid.
 *
 * The last family album can't be removed (a photo must live in ≥1 album) — the panel blocks the empty
 * toggle client-side and shows `lastFamilyLocked`; the server enforces it as a backstop too.
 *
 * Internally the panel narrows the loaded detail into small chip/family arrays it owns as local
 * state, rather than mutating the full `AlbumPhotoDetailView` (whose place/person rows carry audit
 * fields the client never has for an optimistic add).
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { hub } from "@/app/_copy";
import { FamilyPicker } from "@/app/hub/FamilyPicker";
import { PhotoTagField, type PhotoTagFieldChip } from "./PhotoTagField";
import {
  loadPhotoTagPanelAction,
  tagPhotoPersonAction,
  tagPhotoPlaceAction,
  tagPhotoSubjectAction,
  untagPhotoPersonAction,
  untagPhotoPlaceAction,
  untagPhotoSubjectAction,
  retargetPhotoFamiliesAction,
  type PhotoTagPanel as PhotoTagPanelData,
} from "./actions";

type Suggestions = PhotoTagPanelData["suggestions"];
type FamilyChip = { familyId: string; familyName: string };

// Monotonic, per-call unique placeholder id for an optimistic chip whose add is still in flight. Must
// NOT be derived from the tag label: two rapid adds of the same new name would otherwise collide on a
// React key and on the resolve/rollback lookup, merging or dropping chips. A module counter is
// deterministic (test-friendly) and unique within a session.
let pendingSeq = 0;
const nextPendingId = () => `__pending__${(pendingSeq += 1)}`;

interface PanelState {
  canManage: boolean;
  subjects: PhotoTagFieldChip[];
  people: PhotoTagFieldChip[];
  places: PhotoTagFieldChip[];
  families: FamilyChip[];
}

function fd(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) f.append(k, item);
    else f.append(k, v);
  }
  return f;
}

function toState(detail: PhotoTagPanelData["detail"]): PanelState {
  return {
    canManage: detail.canManage,
    subjects: detail.subjects.map((r) => ({
      id: r.personId,
      label: r.displayName ?? hub.album.unnamedPerson,
    })),
    people: detail.people.map((r) => ({
      id: r.personId,
      label: r.displayName ?? hub.album.unnamedPerson,
    })),
    places: detail.places.map((r) => ({ id: r.placeId, label: r.name })),
    families: detail.families.map((f) => ({ familyId: f.familyId, familyName: f.familyName })),
  };
}

export function PhotoTagPanel({
  photoId,
  initial,
  scopeFamilyId,
  peopleSectionRef,
  peopleInputRef,
}: {
  photoId: string;
  initial?: PhotoTagPanelData;
  scopeFamilyId?: string | null;
  peopleSectionRef?: RefObject<HTMLDivElement | null>;
  peopleInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const router = useRouter();
  const [state, setState] = useState<PanelState | null>(
    initial ? toState(initial.detail) : null,
  );
  const [suggestions, setSuggestions] = useState<Suggestions | null>(
    initial?.suggestions ?? null,
  );
  const [loading, setLoading] = useState(initial === undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fallbackPeopleRef = useRef<HTMLInputElement>(null);
  const peopleField = peopleInputRef ?? fallbackPeopleRef;

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    setLoading(true);
    void loadPhotoTagPanelAction(photoId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(res.error);
      } else {
        setState(toState(res.detail));
        setSuggestions(res.suggestions);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [photoId, initial]);

  if (loading) {
    return (
      <p role="status" style={metaStyle}>
        {hub.album.tagPanelLoading}
      </p>
    );
  }

  if (loadError || state === null || suggestions === null) {
    return (
      <p role="alert" style={alertStyle}>
        {loadError ?? hub.album.tagPanelLoadError}
      </p>
    );
  }

  const s = state; // non-null past the guard
  const sugg = suggestions;

  // --- Person-group helpers (Subjects + People share the same shapes) ---
  async function addPerson(
    group: "subjects" | "people",
    opt: { id: string } | { newName: string },
  ) {
    const action = group === "subjects" ? tagPhotoSubjectAction : tagPhotoPersonAction;
    const existingId = "id" in opt ? opt.id : null;
    const label =
      existingId !== null
        ? sugg.people.find((p) => p.personId === existingId)?.displayName ??
          hub.album.unnamedPerson
        : (opt as { newName: string }).newName;
    // Block a duplicate: an existing id already chipped, or an identical new name already in flight.
    if (existingId !== null && s[group].some((c) => c.id === existingId)) return;
    if (existingId === null && s[group].some((c) => c.pending && c.label === label)) return;
    // Unique placeholder id (never label-derived) + `pending` so its remove is disabled until resolved.
    const tempId = nextPendingId();
    setState((cur) =>
      cur ? { ...cur, [group]: [...cur[group], { id: tempId, label, pending: true }] } : cur,
    );
    setError(null);

    const body = fd(
      existingId !== null
        ? { photoId, personId: existingId }
        : { photoId, newPersonDisplayName: (opt as { newName: string }).newName },
    );
    const res = await action(body);
    if ("error" in res) {
      setState((cur) =>
        cur ? { ...cur, [group]: cur[group].filter((c) => c.id !== tempId) } : cur,
      );
      setError(res.error);
      return;
    }
    setState((cur) =>
      cur
        ? {
            ...cur,
            [group]: cur[group].map((c) =>
              c.id === tempId ? { ...c, id: res.personId, pending: false } : c,
            ),
          }
        : cur,
    );
    router.refresh();
  }

  async function removePerson(group: "subjects" | "people", personId: string) {
    const action = group === "subjects" ? untagPhotoSubjectAction : untagPhotoPersonAction;
    const removed = s[group].find((c) => c.id === personId);
    // Never untag a chip whose add is still in flight (the field disables its remove too).
    if (!removed || removed.pending) return;
    setState((cur) =>
      cur ? { ...cur, [group]: cur[group].filter((c) => c.id !== personId) } : cur,
    );
    setError(null);
    const res = await action(fd({ photoId, personId }));
    if ("error" in res) {
      setState((cur) =>
        cur && removed ? { ...cur, [group]: [...cur[group], removed] } : cur,
      );
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function addPlace(opt: { id: string } | { newName: string }) {
    const existingId = "id" in opt ? opt.id : null;
    const label =
      existingId !== null
        ? sugg.places.find((p) => p.placeId === existingId)?.name ?? ""
        : (opt as { newName: string }).newName;
    if (existingId !== null && s.places.some((c) => c.id === existingId)) return;
    if (existingId === null && s.places.some((c) => c.pending && c.label === label)) return;
    const tempId = nextPendingId();
    setState((cur) =>
      cur ? { ...cur, places: [...cur.places, { id: tempId, label, pending: true }] } : cur,
    );
    setError(null);

    const body = fd({
      photoId,
      ...(existingId !== null
        ? { placeId: existingId }
        : {
            newPlaceName: label,
            ...(scopeFamilyId ? { familyId: scopeFamilyId } : {}),
          }),
    });
    const res = await tagPhotoPlaceAction(body);
    if ("error" in res) {
      setState((cur) =>
        cur ? { ...cur, places: cur.places.filter((c) => c.id !== tempId) } : cur,
      );
      setError(res.error);
      return;
    }
    setState((cur) =>
      cur
        ? {
            ...cur,
            places: cur.places.map((c) =>
              c.id === tempId ? { ...c, id: res.placeId, pending: false } : c,
            ),
          }
        : cur,
    );
    router.refresh();
  }

  async function removePlace(placeId: string) {
    const removed = s.places.find((c) => c.id === placeId);
    if (!removed || removed.pending) return;
    setState((cur) => (cur ? { ...cur, places: cur.places.filter((c) => c.id !== placeId) } : cur));
    setError(null);
    const res = await untagPhotoPlaceAction(fd({ photoId, placeId }));
    if ("error" in res) {
      setState((cur) =>
        cur && removed ? { ...cur, places: [...cur.places, removed] } : cur,
      );
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function toggleFamily(familyId: string) {
    const current = new Set(s.families.map((f) => f.familyId));
    const next = new Set(current);
    if (next.has(familyId)) next.delete(familyId);
    else next.add(familyId);
    // A photo must stay in at least one album — block the empty toggle client-side.
    if (next.size === 0) {
      setError(hub.album.lastFamilyLocked);
      return;
    }
    const nextFamilies: FamilyChip[] = sugg.families
      .filter((f) => next.has(f.id))
      .map((f) => ({ familyId: f.id, familyName: f.name }));
    const prev = s.families;
    setState((cur) => (cur ? { ...cur, families: nextFamilies } : cur));
    setError(null);
    const res = await retargetPhotoFamiliesAction(fd({ photoId, familyIds: [...next] }));
    if ("error" in res) {
      setState((cur) => (cur ? { ...cur, families: prev } : cur));
      setError(res.error);
      return;
    }
    router.refresh();
  }

  const selectedFamilies = new Set(s.families.map((f) => f.familyId));
  const peopleSuggestions = sugg.people.map((p) => ({ id: p.personId, label: p.displayName }));

  return (
    <div
      role="group"
      aria-label={hub.album.tagPanelAria}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      <PhotoTagField
        label={hub.album.subjectsLabel}
        help={hub.album.subjectsHelp}
        placeholder={hub.album.personFieldPlaceholder}
        chips={s.subjects}
        suggestions={peopleSuggestions}
        onAdd={(opt) => void addPerson("subjects", opt)}
        onRemove={(id) => void removePerson("subjects", id)}
        addNamedCopy={hub.album.addPersonNamed}
        removeCopy={hub.album.removeTag}
        disabled={!s.canManage}
      />

      <div ref={peopleSectionRef}>
        <PhotoTagField
          label={hub.album.peopleLabel}
          help={hub.album.peopleHelp}
          placeholder={hub.album.personFieldPlaceholder}
          chips={s.people}
          suggestions={peopleSuggestions}
          onAdd={(opt) => void addPerson("people", opt)}
          onRemove={(id) => void removePerson("people", id)}
          addNamedCopy={hub.album.addPersonNamed}
          removeCopy={hub.album.removeTag}
          disabled={!s.canManage}
          inputRef={peopleField}
        />
      </div>

      <PhotoTagField
        label={hub.album.placesLabel}
        help={hub.album.placesHelp}
        placeholder={hub.album.placeFieldPlaceholder}
        chips={s.places}
        suggestions={sugg.places.map((p) => ({ id: p.placeId, label: p.name }))}
        onAdd={(opt) => void addPlace(opt)}
        onRemove={(id) => void removePlace(id)}
        addNamedCopy={hub.album.addPlaceNamed}
        removeCopy={hub.album.removeTag}
        disabled={!s.canManage}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui)",
            fontWeight: 600,
            color: "var(--text-body)",
          }}
        >
          {hub.album.familyPlacementLabel}
        </span>
        <p style={metaStyle}>{hub.album.familyPlacementHelp}</p>
        {s.canManage ? (
          <FamilyPicker
            families={sugg.families.map((f) => ({ familyId: f.id, familyName: f.name }))}
            selected={selectedFamilies}
            onToggle={(id) => void toggleFamily(id)}
          />
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui)",
              color: "var(--text-body)",
            }}
          >
            {s.families.map((f) => (
              <li key={f.familyId}>{f.familyName}</li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const metaStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-meta)",
  margin: 0,
};

const alertStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--accent-strong)",
  background: "var(--accent-soft)",
  border: "var(--border-width) solid var(--accent)",
  borderRadius: "var(--radius-md)",
  padding: "12px 16px",
  margin: 0,
};
