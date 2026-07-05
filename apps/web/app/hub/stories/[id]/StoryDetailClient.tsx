"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import {
  editStoryDetailsAction,
  retargetStoryFamiliesAction,
  editStoryProseAction,
} from "./actions";
import { FavoriteButton } from "./FavoriteButton";
import { LikeButton } from "./LikeButton";
import { OwnerActionMenu } from "./OwnerActionMenu";
import { StoryReadBody } from "./StoryReadBody";
import { FamilyPicker } from "../../FamilyPicker";
import { KindredProseEditor } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import type { FavoriteState, LikeState } from "@chronicle/core";

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
  // Accompaniments
  storyImages: Array<{ id: string; familyPhotoId: string; caption: string | null }>;
}

export function StoryDetailClient({
  storyId,
  isOwner,
  initialTitle,
  initialTags,
  initialProse,
  initialTranscript,
  initialSummary,
  updatedAt,
  narratorName,
  eraLabelStr,
  recordingMediaId,
  viewerFamilies,
  initialTargetFamilies,
  favoriteState,
  likeState,
  canReact,
  backHref,
  storyImages,
}: StoryDetailClientProps) {
  // State for content
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [prose, setProse] = useState(initialProse);
  const [targetFamilies, setTargetFamilies] = useState(initialTargetFamilies);

  // UI modes
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isEditingSharing, setIsEditingSharing] = useState(false);
  const [isEditingProse, setIsEditingProse] = useState(false);

  // Edit details form state
  const [editTitle, setEditTitle] = useState(title);
  const [editTagsStr, setEditTagsStr] = useState(tags.join(", "));

  // Manage sharing state
  const selectedFamilyIds = useMemo(() => new Set(targetFamilies.map((f) => f.id)), [targetFamilies]);
  const [editSelectedFamilies, setEditSelectedFamilies] = useState<Set<string>>(new Set(selectedFamilyIds));

  // Edit prose state
  const [editProse, setEditProse] = useState(prose);

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

  const handleEditDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    const fd = new FormData();
    fd.append("storyId", storyId);
    fd.append("title", editTitle);
    fd.append("tags", editTagsStr);

    startTransition(async () => {
      const res = await editStoryDetailsAction(fd);
      if (res?.error) {
        setActionError(res.error);
      } else {
        setTitle(editTitle.trim());
        const processedTags = editTagsStr
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        setTags(processedTags);
        setIsEditingDetails(false);
      }
    });
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

  const handleProseSubmit = async () => {
    setActionError(null);
    const fd = new FormData();
    fd.append("storyId", storyId);
    fd.append("prose", editProse);
    fd.append("expectedUpdatedAt", updatedAt);

    startTransition(async () => {
      const res = await editStoryProseAction(fd);
      if (res?.error) {
        setActionError(res.error);
      } else {
        setProse(editProse.trim());
        setIsEditingProse(false);
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
            onEditDetails={() => {
              setEditTitle(title);
              setEditTagsStr(tags.join(", "));
              setIsEditingDetails(true);
            }}
            onManageSharing={() => {
              setEditSelectedFamilies(new Set(selectedFamilyIds));
              setIsEditingSharing(true);
            }}
            onEditStory={() => {
              setEditProse(prose);
              setIsEditingProse(true);
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
      </div>

      {/* Edit Details Inline Form */}
      {isEditingDetails ? (
        <form onSubmit={handleEditDetailsSubmit} style={{ marginTop: 20, display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", fontWeight: 600 }}>Title</label>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              disabled={isPending}
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm, 4px)",
                border: "1px solid var(--border)",
                background: "var(--surface-card)",
                fontFamily: "var(--font-story)",
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui-sm)", fontWeight: 600 }}>Tags (comma separated)</label>
            <input
              type="text"
              value={editTagsStr}
              onChange={(e) => setEditTagsStr(e.target.value)}
              disabled={isPending}
              placeholder="e.g. Vacation, 1995, Grandparents"
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-sm, 4px)",
                border: "1px solid var(--border)",
                background: "var(--surface-card)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--text-ui)",
                color: "var(--text-body)",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setIsEditingDetails(false)}
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
              {isPending ? "Saving..." : "Save details"}
            </button>
          </div>
        </form>
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

      {/* Prose Editing Body / Reading Body */}
      {isEditingProse ? (
        <div style={{ display: "grid", gap: 16 }}>
          <KindredProseEditor
            value={editProse}
            onChange={setEditProse}
            disabled={isPending}
          />
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button
              onClick={() => setIsEditingProse(false)}
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
              onClick={handleProseSubmit}
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
              {isPending ? "Saving..." : "Save story"}
            </button>
          </div>
        </div>
      ) : (
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

      {/* Gallery */}
      {storyImages.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <h2
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "var(--tracking-mono)",
              textTransform: "uppercase",
              color: "var(--text-meta)",
              margin: "0 0 16px",
            }}
          >
            {hub.storyImages.galleryHeading}
          </h2>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {storyImages.map((img) => (
              <li key={img.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/album-photo/${img.familyPhotoId}`}
                  alt={img.caption || "Story illustration"}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: "var(--radius-sm)",
                    display: "block",
                    background: "var(--surface-sunken)",
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
