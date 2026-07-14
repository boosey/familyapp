"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { retargetStoryFamiliesAction } from "./actions";
import { FavoriteButton } from "./FavoriteButton";
import { LikeButton } from "./LikeButton";
import { OwnerActionMenu } from "./OwnerActionMenu";
import { StoryReadBody } from "./StoryReadBody";
import { StoryEditor } from "./StoryEditor";
import { FamilyPicker } from "../../FamilyPicker";
import { hub } from "@/app/_copy";
import type { FavoriteState, LikeState } from "@chronicle/core";
import type { TagSuggestions } from "@/app/hub/tag-input-types";

export interface StoryDetailClientProps {
  storyId: string;
  isOwner: boolean;
  initialTitle: string;
  initialTags: string[];
  initialProse: string;
  initialTranscript: string | null;
  initialSummary: string | null;
  audienceTier: string;
  updatedAt: string;
  narratorName: string;
  eraLabelStr: string;
  recordingMediaId: string | null;
  // Sharing targets
  viewerFamilies: Array<{ id: string; name: string }>;
  initialTargetFamilies: Array<{ id: string; name: string }>;
  // Reactions
  favoriteState: FavoriteState;
  likeState: LikeState;
  canReact: boolean;
  // Back href
  backHref: string;
  // "View in family tree" — links to /hub/tree rooted on the narrator (Task 9). Null when no
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
  initialTitle,
  initialTags,
  initialProse,
  initialTranscript,
  initialSummary,
  narratorName,
  eraLabelStr,
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
    <div
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "clamp(20px, 5vw, 40px) clamp(20px, 5vw, 56px) 80px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <Link
          href={backHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            fontWeight: 600,
            color: "var(--accent-strong)",
            textDecoration: "none",
          }}
        >
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
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(220, 50, 50, 0.1)",
            border: "1px solid rgba(220, 50, 50, 0.3)",
            borderRadius: "var(--radius-md, 8px)",
            color: "var(--text-danger, #d32f2f)",
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            marginBottom: 20,
          }}
        >
          {actionError}
        </div>
      )}

      {/* Narrative & Timeline Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "var(--accent-soft)",
            color: "var(--accent-strong)",
            fontFamily: "var(--font-story)",
            fontSize: 18,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "0 0 auto",
          }}
        >
          {initialsOf(narratorName)}
        </span>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-label)",
            color: "var(--text-meta)",
          }}
        >
          {hub.browse.toldBy(narratorName)}
        </span>
        <span
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--border-strong)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-label)",
            letterSpacing: "var(--tracking-mono)",
            color: "var(--support)",
          }}
        >
          {eraLabelStr}
        </span>
        {authorTreeHref && (
          <Link
            href={authorTreeHref}
            data-testid="story-tree-link"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              fontWeight: 600,
              color: "var(--accent-strong)",
              textDecoration: "none",
            }}
          >
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
          <h1
            style={{
              fontFamily: "var(--font-story)",
              fontWeight: 400,
              fontSize: "clamp(var(--text-display), 5.5vw, var(--text-display-lg))",
              lineHeight: 1.15,
              color: "var(--text-body)",
              margin: "16px 0 20px",
            }}
          >
            {title || hub.stories.untitled}
          </h1>

          {/* Tags and Targeting Pills */}
          {(tags.length > 0 || targetFamilies.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {tags.map((tag) => (
                <span
                  key={`t-${tag}`}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--text-label)",
                    fontWeight: 500,
                    color: "var(--text-muted)",
                    border: "1.5px solid var(--border-strong)",
                    borderRadius: "var(--radius-pill)",
                    padding: "5px 13px",
                  }}
                >
                  {tag}
                </span>
              ))}
              {targetFamilies.map((fam) => (
                <span
                  key={`f-${fam.id}`}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-label)",
                    fontWeight: 500,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--accent-strong)",
                    background: "var(--accent-soft)",
                    borderRadius: "var(--radius-pill)",
                    padding: "5px 13px",
                  }}
                >
                  {fam.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Manage Sharing Picker Dialog overlay */}
      {isEditingSharing && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={handleSharingSubmit}
            style={{
              background: "var(--surface-card)",
              borderRadius: "var(--radius-lg, 12px)",
              padding: 24,
              width: "100%",
              maxWidth: 400,
              display: "grid",
              gap: 16,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 style={{ fontFamily: "var(--font-story)", fontSize: "1.25rem", margin: 0 }}>
              Share with families
            </h3>
            <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", color: "var(--text-muted)", margin: "0 0 8px" }}>
              Select which family archives this story should appear in.
            </p>
            <FamilyPicker
              families={viewerFamilies.map((f) => ({ familyId: f.id, familyName: f.name }))}
              selected={editSelectedFamilies}
              onToggle={toggleFamilySelection}
            />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setIsEditingSharing(false)}
                disabled={isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-pill, 999px)",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                style={{
                  padding: "8px 20px",
                  borderRadius: "var(--radius-pill, 999px)",
                  border: "none",
                  background: "var(--accent-strong)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {isPending ? "Saving..." : "Save sharing"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reactions Row (Bookmarks and Likes) */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 28, flexWrap: "wrap" }}>
        <FavoriteButton storyId={storyId} initialState={favoriteState} canFavorite={canReact} />
        <LikeButton storyId={storyId} initialState={likeState} canLike={canReact} />
      </div>

      {/* Attached photos — a horizontal row directly below the reactions (ADR-0009). Shows ALL of the
          story's photos (there is no separate cover image on this page), each served by the audited
          /api/album-photo/[photoId] byte route. Nothing renders when the story has no photos. */}
      {storyImages.length > 0 && (
        <div
          data-testid="story-photo-row"
          role="group"
          aria-label={hub.storyImages.galleryHeading}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 28,
          }}
        >
          {storyImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element -- audited auth byte route, not a static asset
            <img
              key={img.id}
              src={`/api/album-photo/${img.familyPhotoId}`}
              alt={hub.storyImages.galleryAlt(img.caption)}
              style={{
                width: 96,
                height: 96,
                flex: "0 0 auto",
                objectFit: "cover",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-sunken)",
                display: "block",
              }}
            />
          ))}
        </div>
      )}

      {/* Audio Playback Seam */}
      {recordingMediaId && (
        <div style={{ display: "flex", gap: 12, width: "100%", height: 38, marginBottom: 20 }}>
          <audio
            controls
            src={`/api/media/${recordingMediaId}`}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )}

      {/* Reading Body (hidden while the consolidated editor owns prose editing) */}
      {!editorOpen && (
        <div style={{ marginTop: 12 }}>
          <StoryReadBody
            prose={prose || initialSummary || null}
            transcript={initialTranscript}
            labels={{
              story: hub.browse.readStory,
              transcript: hub.browse.readTranscript,
              noProse: hub.browse.readNoProse,
            }}
          />
        </div>
      )}
    </div>
  );
}
