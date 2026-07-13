"use client";
/**
 * PersonNode — one monogram node card in the visual family tree (spec §7/§8).
 *
 * A pure presentational card. It handles the four visual states from §8:
 *   - You (accent border + accent monogram)
 *   - Living relative (plain card)
 *   - Deceased (muted tint, life span / "in memory")
 *   - Anonymous bridge (dashed border, italic "Unknown <relation>", `?` monogram)
 *
 * The monogram color is deterministic — hashed from `personId` — so the same person always draws the
 * same color across renders and sessions. This component draws ONLY the card; the expand/collapse
 * caret affordances are drawn by TreeCanvas as separate SVG glyphs (medium-weight chevrons).
 *
 * Sized to the layout's assumed card box (NODE_W×NODE_H = 150×172, a portrait card) so connectors
 * line up. Monogram sits on top; name + relation/life are centered beneath it.
 */
import { hub } from "@/app/_copy";
import type { KinRelation, TreeNode } from "@chronicle/core";

export const NODE_W = 150;
export const NODE_H = 172;

/** Full relation label set (mirrors /hub/kin's) — used for the anonymous-bridge sublabel. */
const RELATION_LABEL: Record<KinRelation, string> = hub.kin.relationLabel;

/**
 * A relation-to-root label ("Parent", "You"), or empty when it can't be labeled from a relation.
 *
 * "You" is the VIEWER's own node — never merely the focal root. Re-rooting the tree on a relative
 * makes THEM the root (`isRoot`/`relationToRoot === "self"`), but they are still labeled by relation,
 * not "You". A focal root that isn't the viewer gets no relation line at all.
 */
export function relationToRootLabel(node: TreeNode, isRoot: boolean, viewerPersonId: string | null = null): string {
  if (viewerPersonId != null && node.personId === viewerPersonId) return hub.tree.you;
  if (isRoot || node.relationToRoot === "self") return ""; // focal root that isn't the viewer: no relation line
  if (node.relationToRoot === null) return "";
  return RELATION_LABEL[node.relationToRoot];
}

/**
 * True only for a genuine anonymous BRIDGE node — a placeholder the model has NOT identified as a real
 * person (`identified === false`). This is spec §8's fourth state (dashed, italic, `?`, "Unknown
 * <relation>"). It is deliberately distinct from an identified-but-nameless person (`identified: true`
 * with a null `displayName`, a known #30 nullable-name deviation): that person IS real, so they get a
 * plain card — never the dashed bridge treatment — just with a fallback label.
 */
export function isAnonymousBridge(node: TreeNode): boolean {
  return !node.identified;
}

/** Whether the node has a usable name to show. */
function hasName(node: TreeNode): boolean {
  return node.displayName != null && node.displayName.trim().length > 0;
}

/**
 * The name shown for a node. A named person shows their name. An anonymous bridge is rendered from its
 * relation ("Unknown grandparent"). An identified-but-nameless person shows the generic "Unknown
 * relative" — real, but nothing to display.
 */
export function displayNameFor(node: TreeNode): string {
  if (hasName(node)) return node.displayName!;
  if (isAnonymousBridge(node)) {
    const rel = node.relationToRoot && node.relationToRoot !== "self" ? RELATION_LABEL[node.relationToRoot] : null;
    if (rel) return hub.tree.unknownOf(rel);
  }
  return hub.tree.unknownRelative;
}

/** The life line: "1920–1998 · in memory", "in memory · b.1920", "b.1948", or "". */
export function lifeLineFor(node: TreeNode): string {
  const span = hub.tree.lifeSpan(node.birthYear, node.deathYear);
  if (node.lifeStatus === "deceased") {
    // Both years ⇒ "1920–1998 · in memory"; else "in memory" (optionally with the one known year).
    if (node.birthYear != null && node.deathYear != null) return `${span} · ${hub.tree.inMemory}`;
    return span ? `${hub.tree.inMemory} · ${span}` : hub.tree.inMemory;
  }
  return span; // living: "b.1948" or ""
}

/** The monogram initial — first letter of the name, `?` when there is no name to draw one from. */
export function monogramFor(node: TreeNode): string {
  if (hasName(node)) {
    const ch = node.displayName!.trim().charAt(0);
    return ch ? ch.toUpperCase() : "?";
  }
  return "?";
}

/**
 * Deterministic monogram color from a hash of `personId`. A stable HSL hue keeps colors distinct and
 * legible against the card while never depending on render order or time (determinism discipline).
 */
export function monogramColor(personId: string): string {
  let h = 0;
  for (let i = 0; i < personId.length; i++) {
    h = (h * 31 + personId.charCodeAt(i)) & 0xffffffff;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 45% 42%)`;
}

/**
 * The top-edge sex accent color, or null for `unknown`/bridge (no strip). Bridge nodes are always
 * unknown-sex placeholders, so they inherit the neutral no-strip treatment for free.
 */
function sexBarColor(node: TreeNode): string | null {
  if (node.sex === "male") return "var(--sex-male)";
  if (node.sex === "female") return "var(--sex-female)";
  return null; // unknown / null
}

export interface PersonNodeProps {
  node: TreeNode;
  isRoot: boolean;
  /** The viewer's own personId — the one node labeled "You". Optional; wired by TreeCanvas. */
  viewerPersonId?: string | null;
  onTap?: (personId: string) => void;
  /**
   * Optional per-card ⋮ affordance (a <KebabMenu>), supplied by the canvas so PersonNode stays
   * presentational and the menu gets the right adjacency counts. Rendered top-right, isolated from
   * the card's tap target.
   */
  kebab?: React.ReactNode;
}

export function PersonNode({ node, isRoot, viewerPersonId, onTap, kebab }: PersonNodeProps) {
  // `anon` drives the spec §8 anonymous-BRIDGE styling (dashed border, italics) — reserved for a
  // placeholder the model hasn't identified. An identified-but-nameless real person is NOT anon.
  const anon = isAnonymousBridge(node);
  const deceased = node.lifeStatus === "deceased";
  const name = displayNameFor(node);
  const relation = relationToRootLabel(node, isRoot, viewerPersonId ?? null);
  const life = lifeLineFor(node);
  const initial = monogramFor(node);

  const border = isRoot
    ? "2px solid var(--accent)"
    : anon
      ? "var(--border-width) dashed var(--border-strong)"
      : "var(--border-width) solid var(--border)";

  // Top-edge sex accent strip (FamilySearch-style colored top border). Only drawn for male/female; the
  // root/You accent frame still visually wins (a full 2px accent border around the whole card).
  const sexColor = sexBarColor(node);

  return (
    <div style={{ position: "relative", width: NODE_W, height: NODE_H }}>
      {kebab && (
        <span
          style={{ position: "absolute", top: 4, right: 4, zIndex: 2 }}
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
        data-root={isRoot ? "true" : undefined}
        data-anon={anon ? "true" : undefined}
        data-deceased={deceased ? "true" : undefined}
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
          borderRadius: "var(--radius-lg)",
          border,
          background: deceased ? "var(--surface-page)" : "var(--surface-card)",
          opacity: deceased ? 0.9 : 1,
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
              height: 6,
              background: sexColor,
              pointerEvents: "none",
            }}
          />
        )}
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: 52,
            height: 52,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: "1.35rem",
            color: isRoot ? "var(--accent-on)" : "#fff",
            background: isRoot ? "var(--accent)" : monogramColor(node.personId),
          }}
        >
          {initial}
        </span>
        <span style={{ width: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-story)",
              fontSize: "0.95rem",
              lineHeight: 1.15,
              fontStyle: anon ? "italic" : "normal",
              color: anon ? "var(--text-muted)" : "var(--text-body)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {name}
          </span>
          {(relation || life) && (
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
              {[relation, life].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
