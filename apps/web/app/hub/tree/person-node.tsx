"use client";
/**
 * PersonNode — one card in the ego-centric visual family tree (spec §2; tree Slice A #8/#9).
 *
 * Top-to-bottom: Avatar · Name · Dates · relation chip. The visual facts:
 *   - Avatar — the person's photo/image if present; else a deterministic colored monogram (hash of
 *     `personId`, stable across renders); else `?`.
 *   - Name — the tap target (single tap is a no-op now; a double-tap opens the read-only details
 *     sheet, handled by the canvas). Identified-but-nameless → a fallback ("Unknown relative").
 *   - Dates — dob–dod, dates only. Deceased `1948–1998`; living `1948–`; degrades gracefully.
 *   - Sex bar — the top-edge accent colored by sex.
 *   - Relation chip (Slice A #9) — this card's RELATION TO THE FOCUS PERSON (`relationToRoot`, the
 *     tree is focus-rooted), mapped via `hub.kin.relationLabel`. The focus person's own card is BLANK
 *     (`relationToRoot === "self"`). The VIEWER's own card always reads "You" (takes precedence over
 *     blank/relation). Anonymous bridges get NO chip (their relation is already in the name line).
 *     (This reverses the earlier "no relation line" rule.)
 *   - Focus ring (Slice A #8) — when `focus` is set, a solid ring around the card in the person's sex
 *     color (`--sex-male`/`--sex-female`), or `--border-strong` when sex is unknown. Width from the
 *     `--tree-focus-ring-width` token. The ring moves with the focus person on re-focus.
 *   - Anonymous bridge (`identified === false`) — dashed border, `?` avatar, italic "Unknown
 *     <relation>", no dates, no chip. INERT (carets/kebab suppressed by the canvas/layout, not here).
 *
 * This component draws ONLY the card; carets/"+" and the descent bus are drawn by TreeCanvas.
 */
import { hub } from "@/app/_copy";
import type { KinRelation, TreeNode } from "@chronicle/core";
import {
  AVATAR_SIZE_PX,
  KEBAB_INSET_PX,
  MONOGRAM_HUE_MODULO,
  MONOGRAM_LIGHTNESS_PCT,
  MONOGRAM_SATURATION_PCT,
  NAME_LINE_CLAMP,
  NODE_H,
  NODE_W,
  SEX_BAR_HEIGHT_PX,
} from "./tree-constants";

/** Full relation label set (mirrors /hub/kin's) — used for the anonymous-bridge sublabel. */
const RELATION_LABEL: Record<KinRelation, string> = hub.kin.relationLabel;

/**
 * True only for a genuine anonymous BRIDGE node — a placeholder the model has NOT identified
 * (`identified === false`, ADR-0017): dashed, italic, `?`, "Unknown <relation>". Distinct from an
 * identified-but-nameless real person (`identified: true`, null `displayName`), who gets a plain card.
 */
export function isAnonymousBridge(node: TreeNode): boolean {
  return !node.identified;
}

/** Whether the node has a usable name to show. */
function hasName(node: TreeNode): boolean {
  return node.displayName != null && node.displayName.trim().length > 0;
}

/**
 * The name shown for a node. A named person shows their name. An anonymous bridge renders from its
 * relation ("Unknown grandparent"). An identified-but-nameless person shows the generic fallback.
 */
export function displayNameFor(node: TreeNode): string {
  if (hasName(node)) return node.displayName!;
  if (isAnonymousBridge(node)) {
    const rel = node.relationToRoot && node.relationToRoot !== "self" ? RELATION_LABEL[node.relationToRoot] : null;
    if (rel) return hub.tree.unknownOf(rel);
  }
  return hub.tree.unknownRelative;
}

/**
 * The dates line (spec §2): DATES ONLY. Deceased `1948–1998`; living `1948–`; degrade gracefully to
 * what's known (`1948–`, `–1998`, or ""). No "in memory" phrase, no muted tint. An anonymous bridge
 * shows no dates.
 */
export function datesLineFor(node: TreeNode): string {
  if (isAnonymousBridge(node)) return "";
  const b = node.birthYear;
  const d = node.deathYear;
  if (node.lifeStatus === "deceased") {
    if (b != null && d != null) return `${b}–${d}`;
    if (b != null) return `${b}–`;
    if (d != null) return `–${d}`;
    return "";
  }
  // Living: birth year with an open range, or nothing.
  return b != null ? `${b}–` : "";
}

/** The monogram initial — first letter of the name, `?` when there is no name. */
export function monogramFor(node: TreeNode): string {
  if (hasName(node)) {
    const ch = node.displayName!.trim().charAt(0);
    return ch ? ch.toUpperCase() : "?";
  }
  return "?";
}

/**
 * Deterministic monogram color from a hash of `personId`. Stable HSL hue — never depends on render
 * order or time (determinism discipline).
 */
export function monogramColor(personId: string): string {
  let h = 0;
  for (let i = 0; i < personId.length; i++) {
    h = (h * 31 + personId.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % MONOGRAM_HUE_MODULO;
  return `hsl(${hue} ${MONOGRAM_SATURATION_PCT}% ${MONOGRAM_LIGHTNESS_PCT}%)`;
}

/** The top-edge sex accent color, or null for `unknown`/bridge (no strip). */
function sexBarColor(node: TreeNode): string | null {
  if (node.sex === "male") return "var(--sex-male)";
  if (node.sex === "female") return "var(--sex-female)";
  return null;
}

/**
 * The focus ring color (Slice A #8): the person's sex color, or the neutral `--border-strong` when
 * sex is unknown. Always a concrete color (unlike the sex BAR, which draws nothing for unknown).
 */
export function focusRingColor(node: TreeNode): string {
  if (node.sex === "male") return "var(--sex-male)";
  if (node.sex === "female") return "var(--sex-female)";
  return "var(--border-strong)";
}

/**
 * The relation chip text for a card (Slice A #9), or null for no chip. Precedence:
 *   1. anonymous bridge → no chip (relation is already in the name line);
 *   2. the viewer's own card → "You" (over-rides blank/relation);
 *   3. the focus person's own card (`relationToRoot === "self"`) → blank;
 *   4. otherwise → relation-to-focus (`relationToRoot`) via `hub.kin.relationLabel`.
 */
export function relationChipFor(node: TreeNode, isViewer: boolean): string | null {
  if (isAnonymousBridge(node)) return null;
  if (isViewer) return hub.tree.youLabel;
  const rel = node.relationToRoot;
  if (rel == null || rel === "self") return null;
  return RELATION_LABEL[rel];
}

/** A photo/image URL for the person, if the model carries one. `TreeNode` has no image field in v1. */
function photoUrlFor(node: TreeNode): string | null {
  const url = (node as { imageUrl?: string | null }).imageUrl;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export interface PersonNodeProps {
  node: TreeNode;
  onTap?: (personId: string) => void;
  /**
   * Optional per-card ⋮ affordance (a <KebabMenu>), supplied by the canvas. Rendered top-right,
   * isolated from the card's tap target. Suppressed by the canvas for anonymous bridge nodes.
   */
  kebab?: React.ReactNode;
  /**
   * When this card is one half of a drawn couple that carries a children affordance, the canvas flattens
   * the card's INNER-bottom corner so the couple's seam glyph (which hugs the seam) nests cleanly and the
   * card borders run straight under it. `"bottom-right"` for the LEFT partner, `"bottom-left"` for the
   * RIGHT partner; undefined leaves all corners rounded.
   */
  squareCorner?: "bottom-left" | "bottom-right";
  /** True for the FOCUS person's card (Slice A #8) — draws the sex-colored focus ring. */
  focus?: boolean;
  /** True for the VIEWER's own card (Slice A #9) — its relation chip reads "You". */
  isViewer?: boolean;
}

export function PersonNode({ node, onTap, kebab, squareCorner, focus, isViewer }: PersonNodeProps) {
  const anon = isAnonymousBridge(node);
  const name = displayNameFor(node);
  const dates = datesLineFor(node);
  const initial = monogramFor(node);
  const photo = photoUrlFor(node);
  const chip = relationChipFor(node, isViewer ?? false);

  const border = anon
    ? "var(--border-width) dashed var(--border-strong)"
    : "var(--border-width) solid var(--border)";

  const sexColor = sexBarColor(node);
  // Solid ring in the sex color (neutral when unknown), drawn as an outer box-shadow so it never
  // affects layout. Only on the focus person's card (Slice A #8).
  const focusRing = focus
    ? `0 0 0 var(--tree-focus-ring-width) ${focusRingColor(node)}`
    : undefined;

  // Flatten one inner-bottom corner when this card is a couple half hosting a seam affordance. Order:
  // top-left top-right bottom-right bottom-left.
  const r = "var(--radius-lg)";
  const borderRadius =
    squareCorner === "bottom-right"
      ? `${r} ${r} 0px ${r}`
      : squareCorner === "bottom-left"
        ? `${r} ${r} ${r} 0px`
        : r;

  return (
    <div style={{ position: "relative", width: NODE_W, height: NODE_H }}>
      {kebab && (
        <span
          style={{ position: "absolute", top: KEBAB_INSET_PX, right: KEBAB_INSET_PX, zIndex: 2 }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {kebab}
        </span>
      )}
      <button
        type="button"
        onClick={() => onTap?.(node.personId)}
        aria-label={name}
        data-testid={`tree-node-${node.personId}`}
        data-anon={anon ? "true" : undefined}
        data-focus={focus ? "true" : undefined}
        style={{
          boxSizing: "border-box",
          position: "relative",
          width: NODE_W,
          height: NODE_H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "22px 12px 14px",
          textAlign: "center",
          cursor: "pointer",
          borderRadius,
          border,
          background: "var(--surface-card)",
          boxShadow: focusRing,
          font: "inherit",
          overflow: "hidden",
        }}
      >
        {sexColor && (
          <span
            aria-hidden="true"
            data-testid={`tree-node-sexbar-${node.personId}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: SEX_BAR_HEIGHT_PX,
              background: sexColor,
              pointerEvents: "none",
            }}
          />
        )}
        {/* Avatar: photo → monogram → `?`. */}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            aria-hidden="true"
            data-testid={`tree-node-photo-${node.personId}`}
            style={{
              flex: "0 0 auto",
              width: AVATAR_SIZE_PX,
              height: AVATAR_SIZE_PX,
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        ) : (
          <span
            aria-hidden="true"
            data-testid={`tree-node-monogram-${node.personId}`}
            style={{
              flex: "0 0 auto",
              width: AVATAR_SIZE_PX,
              height: AVATAR_SIZE_PX,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: "1.35rem",
              color: "#fff",
              background: anon ? "var(--border-strong)" : monogramColor(node.personId),
            }}
          >
            {initial}
          </span>
        )}
        <span style={{ width: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "0.95rem",
              lineHeight: 1.15,
              fontStyle: anon ? "italic" : "normal",
              color: anon ? "var(--text-muted)" : "var(--text-body)",
              display: "-webkit-box",
              WebkitLineClamp: NAME_LINE_CLAMP,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {name}
          </span>
          {dates && (
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "0.72rem",
                color: "var(--text-meta)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {dates}
            </span>
          )}
          {chip && (
            <span
              data-testid={`tree-node-chip-${node.personId}`}
              style={{
                marginTop: 2,
                alignSelf: "center",
                padding: "1px 8px",
                borderRadius: "var(--radius-pill)",
                background: "var(--surface-sunken)",
                fontFamily: "var(--font-ui)",
                fontSize: "0.66rem",
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--text-meta)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {chip}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
