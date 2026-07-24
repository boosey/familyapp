"use client";
/**
 * PersonStatusBadge (#372) — the bare colored status glyph for a person-card in the VIEWED family.
 * One vocabulary, two shapes:
 *   - `corner` — absolutely-positioned bottom-left of a tree card (mirrors the kebab top-right). For an
 *     `eligible` person with an `onInvite` handler it is a real, tappable <button> that opens the invite
 *     modal; otherwise it is an informational <span role="img">. Pointer events are stopped so a tap on
 *     the badge never pans/drags the canvas (mirrors the kebab span in person-node.tsx).
 *   - `inline` — informational only, sized to the surrounding text (details sheet + Family List). Never
 *     a button.
 *
 * No disc/ring — just the glyph, colored via the `--badge-*` tokens (tokens.css, single-sourced).
 */
import { Shield, Ticket, TicketCheck, type LucideIcon } from "lucide-react";
import { hub } from "@/app/_copy";
import type { PersonCardBadge } from "./person-badge";
import { STATUS_BADGE_GLYPH_PX, STATUS_BADGE_INSET_PX } from "./tree-constants";

/** Per-badge glyph, color token, and a11y label. Single source for all three surfaces. */
const BADGE_SPEC: Record<
  PersonCardBadge,
  { Icon: LucideIcon; colorVar: string; label: string }
> = {
  eligible: {
    Icon: Ticket,
    colorVar: "var(--badge-eligible)",
    label: hub.tree.statusBadge.eligibleLabel,
  },
  invited: {
    Icon: TicketCheck,
    colorVar: "var(--badge-invited)",
    label: hub.tree.statusBadge.invitedLabel,
  },
  steward: {
    Icon: Shield,
    colorVar: "var(--badge-steward)",
    label: hub.tree.statusBadge.stewardLabel,
  },
};

export interface PersonStatusBadgeProps {
  badge: PersonCardBadge;
  /** The person's display name — used for the invite button's aria-label. */
  name: string;
  variant: "corner" | "inline";
  /** When set on an `eligible` corner badge, the glyph becomes a tappable invite button. */
  onInvite?: () => void;
  /** Optional testid suffix (defaults to the badge state); the emitted testid is `tree-node-status[-invite]-<suffix>`. */
  testidSuffix?: string;
}

export function PersonStatusBadge({
  badge,
  name,
  variant,
  onInvite,
  testidSuffix,
}: PersonStatusBadgeProps) {
  const { Icon, colorVar, label } = BADGE_SPEC[badge];
  const suffix = testidSuffix ?? badge;

  if (variant === "corner") {
    const glyph = <Icon size={STATUS_BADGE_GLYPH_PX} color={colorVar} aria-hidden strokeWidth={2} />;
    const isTappable = badge === "eligible" && onInvite != null;
    return (
      <span
        style={{
          position: "absolute",
          left: STATUS_BADGE_INSET_PX,
          bottom: STATUS_BADGE_INSET_PX,
          zIndex: 2,
          display: "inline-flex",
          lineHeight: 0,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        {isTappable ? (
          <button
            type="button"
            aria-label={hub.tree.statusBadge.inviteAria(name)}
            title={hub.tree.statusBadge.inviteAria(name)}
            data-testid={`tree-node-status-invite-${suffix}`}
            onClick={onInvite}
            style={{
              padding: 0,
              margin: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "inline-flex",
              lineHeight: 0,
            }}
          >
            {glyph}
          </button>
        ) : (
          <span
            role="img"
            aria-label={label}
            title={label}
            data-testid={`tree-node-status-${suffix}`}
            style={{ display: "inline-flex", lineHeight: 0 }}
          >
            {glyph}
          </span>
        )}
      </span>
    );
  }

  // inline — informational only, sized to the surrounding text.
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid={`tree-node-status-${suffix}`}
      style={{
        display: "inline-flex",
        verticalAlign: "middle",
        lineHeight: 0,
      }}
    >
      <Icon size="1em" color={colorVar} aria-hidden strokeWidth={2} />
    </span>
  );
}
