"use client";

/**
 * ModalShell (ADR-0024 Round A) — the ONE shared mobile-dialog wrapper. The ~8 modals in the app are
 * bespoke inline-styled `position:fixed; inset:0` overlays centering a `width:100%; maxWidth:…` surface
 * with NO max-height, NO overflow, and NO safe-area — so a tall modal (e.g. the tree person-details
 * edit form) runs off-screen at phone width. This wrapper centralizes that overlay + surface geometry
 * and adds the fixes: a `max-height` cap, internal scroll, edge inset, and `env(safe-area-inset-*)`.
 *
 * PRESENTATIONAL by design. It does NOT own open/close state, a heading, or a close button — every
 * adopting modal already manages its own open state and renders its own close affordance. Keeping it
 * presentational makes Round B adoption a mechanical wrap: move the two hand-rolled style objects onto
 * this component, keep the modal's existing header/close/content children.
 *
 * Behaviour it DOES centralize:
 *  - overlay click → `onOverlayClick` (adopters pass their existing `onClose`);
 *  - a click inside the surface is stopped from bubbling to the overlay (so tapping the form never
 *    dismisses) — adopters no longer hand-roll the `onClick={(e) => e.stopPropagation()}` guard.
 * Escape-to-close stays with the adopter (it's a keydown listener, not a shell concern).
 *
 * Extra props (`role`, `aria-modal`, `aria-label`, `data-testid`, …) spread onto the SURFACE so each
 * modal keeps its own dialog semantics.
 *
 * Example — how `add-relative-modal` wraps its content in Round B:
 *
 *   <ModalShell
 *     onOverlayClick={onClose}
 *     maxWidth={440}
 *     role="dialog"
 *     aria-modal="true"
 *     aria-label={hub.tree.addRelativeHeading}
 *     data-testid="tree-add-relative-modal"
 *   >
 *     <div className={headerRow}>
 *       <h2>{hub.tree.addRelativeHeading}</h2>
 *       <button type="button" onClick={onClose} aria-label={hub.tree.addRelativeClose}>×</button>
 *     </div>
 *     <AddRelativeForm … />
 *   </ModalShell>
 */
import type { CSSProperties, ReactNode } from "react";
import s from "./ModalShell.module.css";

export interface ModalShellProps {
  children: ReactNode;
  /** Called when the scrim (outside the surface) is clicked. Adopters pass their existing `onClose`. */
  onOverlayClick?: () => void;
  /**
   * Surface max-width in px (default 480 — matches the widest bespoke modal). Wired through the
   * `--modal-shell-max-width` custom property the CSS module reads, so each modal keeps its own width.
   */
  maxWidth?: number;
  /** Any surface-level attrs (role, aria-*, data-testid, …) spread onto the dialog surface. */
  [key: string]: unknown;
}

export function ModalShell({ children, onOverlayClick, maxWidth = 480, ...surfaceProps }: ModalShellProps) {
  return (
    <div
      role="presentation"
      className={s.overlay}
      onClick={onOverlayClick}
    >
      {/* surfaceProps is spread FIRST so the shell's own className / style / onClick (applied after)
          always win — an adopter that passes any of those three can never silently clobber the
          max-height / scroll / safe-area geometry or the stopPropagation dismiss-guard. role / aria-* /
          data-* still pass through. The shell OWNS the surface box; adopters style content via children. */}
      <div
        {...surfaceProps}
        className={s.surface}
        style={{ "--modal-shell-max-width": `${maxWidth}px` } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
