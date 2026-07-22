"use client";

import { useState, useTransition, useMemo, useCallback, type CSSProperties } from "react";
// NB: `CSSProperties` is still used below for the per-item `--tilt` custom property on the media block
// (JS sets the CSS var, CSS consumes it — see StoryDetailClient.module.css).
import Link from "next/link";
import { retargetStoryFamiliesAction, setStoryLikeAction } from "./actions";
import styles from "./StoryDetailClient.module.css";
import { FavoriteButton } from "./FavoriteButton";
import { FollowUpButton } from "./FollowUpButton";
import { LikeButton } from "./LikeButton";
import { OwnerActionMenu } from "./OwnerActionMenu";
import { StoryDateEditor, type StoryDateValue } from "./StoryDateEditor";
import { StoryReadBody } from "./StoryReadBody";
import { StoryEditor } from "./StoryEditor";
import { FamilyChoiceChips } from "../../FamilyChoiceChips";
import { hub } from "@/app/_copy";
import { albumPhotoSrc } from "@/app/hub/album/photo-src";
import type { FavoriteState, LikeState } from "@chronicle/core";
import type { TagSuggestions } from "@/app/hub/tag-input-types";

export interface StoryDetailClientProps {
  storyId: string;
  isOwner: boolean;
  // The narrator (story owner) — the target of a follow-up question (#77).
  narratorPersonId: string;
  // Whether the "Ask a follow-up" affordance is offered: a signed-in NON-owner viewer of a shared
  // story. The owner asking themselves is nonsensical; anonymous viewers cannot create asks.
  canAskFollowUp: boolean;
  initialTitle: string;
  initialTags: string[];
  initialProse: string;
  initialTranscript: string | null;
  initialSummary: string | null;
  audienceTier: string;
  updatedAt: string;
  narratorName: string;
  eraLabelStr: string;
  /** The raw Story date (ADR-0026) for the edit control; null = Undated. `eraLabelStr` stays the
   *  display label (it already carries the smart-display formatting). */
  storyDate: StoryDateValue | null;
  /** The provenance note recording HOW the date was derived, shown beside it when present. */
  storyDateProvenance: string | null;
  recordingMediaId: string | null;
  // Sharing targets
  viewerFamilies: Array<{ id: string; name: string; shortName?: string | null }>;
  initialTargetFamilies: Array<{ id: string; name: string; shortName?: string | null }>;
  // Reactions
  favoriteState: FavoriteState;
  likeState: LikeState;
  canReact: boolean;
  // Back href
  backHref: string;
  // "View in family tree" — links to the Family hub tab focused on the narrator (Task 9). Null when no
  // family scope is available to root the tree in.
  authorTreeHref?: string | null;
  // Accompaniments
  storyImages: Array<{ id: string; familyPhotoId: string; caption: string | null }>;
  // Unified editor (StoryEditor) — subjects + tag suggestions
  initialPersonSubjects: { personId: string; displayName: string }[];
  tagSuggestions: TagSuggestions;
}

export function StoryDetailClient({
  storyId,
  isOwner,
  narratorPersonId,
  canAskFollowUp,
  initialTitle,
  initialTags,
  initialProse,
  initialTranscript,
  initialSummary,
  narratorName,
  eraLabelStr,
  storyDate,
  storyDateProvenance,
  recordingMediaId,
  viewerFamilies,
  initialTargetFamilies,
  favoriteState,
  likeState,
  canReact,
  backHref,
  authorTreeHref,
  storyImages,
  initialPersonSubjects,
  tagSuggestions,
}: StoryDetailClientProps) {
  // State for content
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [prose, setProse] = useState(initialProse);
  const [targetFamilies, setTargetFamilies] = useState(initialTargetFamilies);

  // UI modes
  const [isEditingSharing, setIsEditingSharing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [focusPhotos, setFocusPhotos] = useState(false);

  // Manage sharing state
  const selectedFamilyIds = useMemo(() => new Set(targetFamilies.map((f) => f.id)), [targetFamilies]);
  const [editSelectedFamilies, setEditSelectedFamilies] = useState<Set<string>>(new Set(selectedFamilyIds));

  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  // Highlight-to-treasure (Task 8): dragging across the prose fires the EXISTING Like path as a SET
  // (liked=true). No optimistic lift — the tap <LikeButton> stays the source of truth for the count;
  // revalidatePath refreshes it. Re-firing when already liked is safe (a SET, not a toggle, so no
  // double increment). Stable identity via useCallback([storyId]) so the hook effect doesn't churn.
  const handleTreasure = useCallback(() => {
    startTransition(() => {
      // Deliberately fire-and-forget / silent-on-error: revalidatePath reconciles the count and the
      // tap <LikeButton> remains the surface that reports Like errors. Do NOT add error UI here.
      void setStoryLikeAction(storyId, true);
    });
  }, [storyId]);

  // Avatar initials
  const initialsOf = (name: string) => {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  };

  const handleSharingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const fd = new FormData();
    fd.append("storyId", storyId);
    for (const fid of editSelectedFamilies) {
      fd.append("familyIds", fid);
    }

    startTransition(async () => {
      const res = await retargetStoryFamiliesAction(fd);
      if (res?.error) {
        setActionError(res.error);
      } else {
        // Map back to option structures
        const updated = viewerFamilies
          .filter((f) => editSelectedFamilies.has(f.id))
          .map((f) => ({ id: f.id, name: f.name }));
        setTargetFamilies(updated);
        setIsEditingSharing(false);
      }
    });
  };

  const toggleFamilySelection = (familyId: string) => {
    setEditSelectedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) {
        next.delete(familyId);
      } else {
        next.add(familyId);
      }
      return next;
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <Link href={backHref} className={styles.backLink}>
          ‹ {hub.browse.back}
        </Link>
        {isOwner && (
          <OwnerActionMenu
            storyId={storyId}
            isOwner={isOwner}
            disabled={editorOpen || isEditingSharing}
            onEditStory={() => {
              setFocusPhotos(false);
              setEditorOpen(true);
            }}
            onAddPhotos={() => {
              setFocusPhotos(true);
              setEditorOpen(true);
            }}
            onManageSharing={() => {
              setEditSelectedFamilies(new Set(selectedFamilyIds));
              setIsEditingSharing(true);
            }}
          />
        )}
      </div>

      {actionError && (
        <div className={styles.actionError}>
          {actionError}
        </div>
      )}

      {/* Narrative & Timeline Header */}
      <div className={styles.metaRow}>
        <span className={styles.avatar}>
          {initialsOf(narratorName)}
        </span>
        <span className={styles.byline}>
          {hub.browse.toldBy(narratorName)}
        </span>
        <span className={styles.metaDot} aria-hidden="true" />
        <span className={styles.eraLabel}>
          {eraLabelStr}
        </span>
        {storyDateProvenance && (
          <span className={styles.dateNote} data-testid="story-date-provenance">
            ({storyDateProvenance})
          </span>
        )}
        {isOwner && <StoryDateEditor storyId={storyId} current={storyDate} />}
        {authorTreeHref && (
          <Link href={authorTreeHref} data-testid="story-tree-link" className={styles.treeLink}>
            {hub.tree.openInTree}
          </Link>
        )}
      </div>

      {/* Consolidated editor (title · tags · prose · photos) or read-only view */}
      {editorOpen ? (
        <StoryEditor
          storyId={storyId}
          initialTitle={title}
          initialTags={tags}
          initialProse={prose}
          initialPersonSubjects={initialPersonSubjects}
          initialTargetFamilies={targetFamilies}
          suggestions={tagSuggestions}
          focusPhotos={focusPhotos}
          onClose={(next) => {
            setTitle(next.title);
            setTags(next.tags);
            setProse(next.prose);
            setTargetFamilies(next.targetFamilies);
            setEditorOpen(false);
          }}
        />
      ) : (
        <>
          <h1 className={styles.title}>
            {title || hub.stories.untitled}
          </h1>

          {/* Tags (sticker candy palette, i % 4) and family-targeting pills. */}
          {(tags.length > 0 || targetFamilies.length > 0) && (
            <div className={styles.tags}>
              {tags.map((tag, i) => (
                <span
                  key={`t-${tag}-${i}`}
                  className={[styles.sticker, styles[`sticker${i % 4}` as const]].join(" ")}
                >
                  {tag}
                </span>
              ))}
              {targetFamilies.map((fam) => (
                <span key={`f-${fam.id}`} className={styles.familyTag}>
                  {fam.shortName || fam.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Manage Sharing Picker Dialog overlay */}
      {isEditingSharing && (
        <div className={styles.modalScrim}>
          <form onSubmit={handleSharingSubmit} className={styles.modalCard}>
            <h3 className={styles.modalTitle}>
              Share with families
            </h3>
            <p className={styles.modalIntro}>
              Select which family archives this story should appear in.
            </p>
            <FamilyChoiceChips
              families={viewerFamilies}
              selected={editSelectedFamilies}
              onToggle={toggleFamilySelection}
            />
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setIsEditingSharing(false)}
                disabled={isPending}
                className={styles.btnGhost}
              >
                Cancel
              </button>
              <button type="submit" disabled={isPending} className={styles.btnPrimary}>
                {isPending ? "Saving..." : "Save sharing"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reactions Row (Bookmarks and Likes) — hidden while the consolidated editor is open: editing
          is not a reacting context, so the reaction affordances don't belong on the edit surface. */}
      {!editorOpen && (
        <div className={styles.reactions}>
          <FavoriteButton storyId={storyId} initialState={favoriteState} canFavorite={canReact} />
          <LikeButton storyId={storyId} initialState={likeState} canLike={canReact} />
          {canAskFollowUp && (
            <FollowUpButton
              storyId={storyId}
              targetPersonId={narratorPersonId}
              narratorName={narratorName}
            />
          )}
        </div>
      )}

      {/* Attached photos — a horizontal row directly below the reactions (ADR-0009). Shows ALL of the
          story's photos (there is no separate cover image on this page), each served by the audited
          /api/album-photo/[photoId] byte route. Nothing renders when the story has no photos. */}
      {!editorOpen && storyImages.length > 0 && (
        <div
          data-testid="story-photo-row"
          role="group"
          aria-label={hub.storyImages.galleryHeading}
          className={styles.mediaBlock}
          // The Scrapbook tilt reads this parity-driven value (math stays in TS, per the token convention).
          style={{ "--tilt": "0.55deg" } as CSSProperties}
        >
          {storyImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element -- audited auth byte route, not a static asset
            <img
              key={img.id}
              src={albumPhotoSrc(img.familyPhotoId, { thumb: true })}
              alt={hub.storyImages.galleryAlt(img.caption)}
              className={styles.photo}
            />
          ))}
        </div>
      )}

      {/* Audio Playback Seam */}
      {recordingMediaId && (
        <div className={styles.audioRow}>
          <audio controls src={`/api/media/${recordingMediaId}`} className={styles.audio} />
        </div>
      )}

      {/* Reading Body (hidden while the consolidated editor owns prose editing) */}
      {!editorOpen && (
        <div className={styles.readBody}>
          <StoryReadBody
            prose={prose || initialSummary || null}
            transcript={initialTranscript}
            labels={{
              story: hub.browse.readStory,
              transcript: hub.browse.readTranscript,
              noProse: hub.browse.readNoProse,
            }}
            canTreasure={canReact}
            onTreasure={handleTreasure}
            treasureLabels={{ hint: hub.stories.treasureHint, aria: hub.stories.treasureAria }}
          />
        </div>
      )}
    </div>
  );
}
