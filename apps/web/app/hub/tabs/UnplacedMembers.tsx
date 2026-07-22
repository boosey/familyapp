"use client";
/**
 * UnplacedMembers / Tree tray (#161, #286, ADR-0023) — the Tree's home for people not yet on the
 * canvas. Lists every active member who touches NO visible kinship edge and exposes:
 *
 *   - Place in tree  → opens shared <PlaceConfirmModal> (link mode)
 *   - New person     → opens the same modal (mint mode) (#286)
 *   - Desktop drag   → tray handle / New person → card zones (#287); drop opens the same modal
 *     with receiverLocked + relationFromZone (mobile Place→tap is #288)
 *   - Not family     → `setMemberNonFamilyAction(nonFamily:true)`; quiet set-aside + Move back
 *   - Remove         → STEWARD-ONLY; in-page confirm then `endMembershipAction`
 *
 * List does NOT mount this surface (#283). Variant `tray` is the Tree chrome; `showNewPerson`
 * keeps the tray visible even when there are no unplaced rows.
 */
import { useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import type { UnplacedMember } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import {
  endMembershipAction,
  linkExistingMemberAction,
  listPlacedPersonsAction,
  setMemberNonFamilyAction,
} from "../tree/actions";
import { addRelativeAction } from "../kin/actions";
import { PlaceConfirmModal } from "../tree/place-confirm-modal";
import type { PlaceConfirmSubject } from "../tree/place-confirm";
import {
  setActivePlaceDrag,
  writePlaceDrag,
  type PlaceDragPayload,
} from "../tree/place-drag";
import styles from "./UnplacedMembers.module.css";

/** A person already placed in the tree, offered as an anchor to link an unplaced member to. */
export interface AnchorOption {
  id: string;
  name: string;
}

export interface UnplacedMembersProps {
  familyId: string;
  members: UnplacedMember[];
  /** Steward-only: gates the destructive Remove affordance (the write path re-checks). */
  viewerIsSteward: boolean;
  /** Wrapper variant — `tray` adds the dashed canvas-margin framing used in the Tree view. */
  variant?: "section" | "tray";
  /**
   * #286 — show the New person affordance (Tree tray). When true, the tray stays mounted even with
   * zero unplaced members so mint+place is always reachable.
   */
  showNewPerson?: boolean;
  /**
   * #288 — when set (mobile compact), Place / New person start a canvas Place→tap→zone session
   * instead of opening the unlocked-receiver modal. Desktop omits this so the picker modal and
   * tray→zone DnD (#287) stay available on wide viewports.
   */
  onStartCanvasPlace?: (subject: PlaceConfirmSubject) => void;
  /** Active canvas place session subject — drives the cancel hint copy. */
  canvasPlaceSubject?: PlaceConfirmSubject | null;
  onCancelCanvasPlace?: () => void;
  /** Overridable in tests so the actions can be stubbed without a server round-trip. */
  onLink?: typeof linkExistingMemberAction;
  onMint?: typeof addRelativeAction;
  onSetNonFamily?: typeof setMemberNonFamilyAction;
  onEndMembership?: typeof endMembershipAction;
  onFetchAnchors?: typeof listPlacedPersonsAction;
}

function memberName(m: UnplacedMember): string {
  const n = m.displayName?.trim();
  return n ? n : hub.unplaced.unnamedMember;
}

type PlacingState =
  | { kind: "link"; member: UnplacedMember }
  | { kind: "mint" }
  | null;

export function UnplacedMembers({
  familyId,
  members,
  viewerIsSteward,
  variant = "section",
  showNewPerson = false,
  onStartCanvasPlace,
  canvasPlaceSubject = null,
  onCancelCanvasPlace,
  onLink = linkExistingMemberAction,
  onMint = addRelativeAction,
  onSetNonFamily = setMemberNonFamilyAction,
  onEndMembership = endMembershipAction,
  onFetchAnchors = listPlacedPersonsAction,
}: UnplacedMembersProps) {
  const router = useRouter();
  const compact = useIsCompact();
  const [placing, setPlacing] = useState<PlacingState>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Members set aside as non-family THIS session — kept in place (not refreshed away) so the inverse
  // "Move back" stays reachable. `listUnplacedMembers` excludes them, so a refresh would drop them
  // entirely; holding them here gives a real, immediate undo without a second core read.
  const [setAside, setAside_] = useState<Map<string, UnplacedMember>>(new Map());

  const activeMembers = members.filter((m) => !setAside.has(m.personId));
  const setAsideMembers = [...setAside.values()];
  const empty =
    activeMembers.length === 0 && setAsideMembers.length === 0 && !showNewPerson;
  if (empty) return null;

  const busy = (id: string) => isPending && pendingId === id;
  const isTray = variant === "tray";
  // #287: desktop tray → zone DnD only (mobile Place→tap is #288). SSR/first paint = desktop.
  const desktopDrag = isTray && !compact;
  const heading =
    isTray && activeMembers.length === 0 && setAsideMembers.length === 0
      ? hub.unplaced.trayHeading
      : hub.unplaced.heading;
  const intro =
    isTray && activeMembers.length === 0 && setAsideMembers.length === 0
      ? hub.unplaced.trayIntro
      : hub.unplaced.intro;

  function beginPlaceDrag(e: DragEvent, payload: PlaceDragPayload) {
    writePlaceDrag(e.dataTransfer, payload);
    setActivePlaceDrag(payload);
  }

  function endPlaceDrag() {
    setActivePlaceDrag(null);
  }

  function startPlace(subject: PlaceConfirmSubject, fallback: PlacingState) {
    setError(null);
    if (onStartCanvasPlace) {
      onStartCanvasPlace(subject);
      return;
    }
    setPlacing(fallback);
  }

  function runAction(
    personId: string,
    action: () => Promise<{ ok: boolean }>,
    onDone?: () => void,
  ) {
    setError(null);
    setPendingId(personId);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) {
          setError(hub.unplaced.actionFailed);
          setPendingId(null);
          return;
        }
        onDone?.();
        router.refresh();
      } catch {
        setError(hub.unplaced.actionFailed);
      } finally {
        setPendingId(null);
        setConfirmRemoveId(null);
      }
    });
  }

  function setNonFamily(m: UnplacedMember) {
    runAction(
      m.personId,
      () => onSetNonFamily(familyId, m.personId, true),
      () =>
        setAside_((prev) => {
          const next = new Map(prev);
          next.set(m.personId, m);
          return next;
        }),
    );
  }

  function restore(m: UnplacedMember) {
    runAction(
      m.personId,
      () => onSetNonFamily(familyId, m.personId, false),
      () =>
        setAside_((prev) => {
          const next = new Map(prev);
          next.delete(m.personId);
          return next;
        }),
    );
  }

  return (
    <section
      className={isTray ? styles.tray : styles.section}
      data-testid="unplaced-members"
      aria-label={heading}
    >
      <h3 className={styles.heading}>{heading}</h3>
      <p className={styles.intro}>{intro}</p>

      {canvasPlaceSubject ? (
        <div className={styles.placeHint} data-testid="mobile-place-hint" role="status">
          <p className={styles.placeHintText}>
            {canvasPlaceSubject.kind === "link"
              ? hub.tree.placeTapHintLink(
                  canvasPlaceSubject.displayName?.trim()
                    ? canvasPlaceSubject.displayName.trim()
                    : hub.unplaced.unnamedMember,
                )
              : hub.tree.placeTapHintMint}
          </p>
          {onCancelCanvasPlace ? (
            <button
              type="button"
              className={styles.action}
              data-testid="mobile-place-cancel"
              onClick={onCancelCanvasPlace}
            >
              {hub.tree.placeTapCancel}
            </button>
          ) : null}
        </div>
      ) : null}

      {showNewPerson ? (
        <div className={styles.newPersonRow}>
          <button
            type="button"
            className={`${styles.newPerson}${desktopDrag ? ` ${styles.newPersonDraggable}` : ""}`}
            data-testid="tree-tray-new-person"
            aria-label={
              desktopDrag ? hub.unplaced.dragNewPersonAria : hub.unplaced.newPersonAria
            }
            draggable={desktopDrag}
            onDragStart={
              desktopDrag
                ? (e) => {
                    beginPlaceDrag(e, { kind: "mint" });
                  }
                : undefined
            }
            onDragEnd={desktopDrag ? endPlaceDrag : undefined}
            onClick={() => startPlace({ kind: "mint" }, { kind: "mint" })}
          >
            {hub.unplaced.newPerson}
          </button>
        </div>
      ) : null}

      {activeMembers.length > 0 ? (
        <ul className={styles.list}>
          {activeMembers.map((m) => {
            const name = memberName(m);
            const named = Boolean(m.displayName?.trim());
            const confirming = confirmRemoveId === m.personId;
            return (
              <li key={m.personId} className={styles.row} data-testid={`unplaced-row-${m.personId}`}>
                {desktopDrag ? (
                  <button
                    type="button"
                    className={styles.dragHandle}
                    draggable
                    data-testid={`unplaced-drag-${m.personId}`}
                    aria-label={hub.unplaced.dragMemberAria(name)}
                    onDragStart={(e) => {
                      beginPlaceDrag(e, {
                        kind: "link",
                        personId: m.personId,
                        displayName: m.displayName,
                      });
                    }}
                    onDragEnd={endPlaceDrag}
                  >
                    <span aria-hidden="true" className={styles.dragHint}>
                      ::
                    </span>
                    <span className={`${styles.name} ${named ? "" : styles.nameUnknown}`}>{name}</span>
                  </button>
                ) : (
                  <span className={`${styles.name} ${named ? "" : styles.nameUnknown}`}>{name}</span>
                )}
                <span
                  className={styles.actions}
                  role="group"
                  aria-label={hub.unplaced.memberActionsAria(name)}
                >
                  {confirming ? (
                    <>
                      <span className={styles.name}>{hub.unplaced.removeConfirm(name)}</span>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.actionDanger}`}
                        data-testid={`unplaced-remove-confirm-${m.personId}`}
                        disabled={busy(m.personId)}
                        onClick={() =>
                          runAction(m.personId, () => onEndMembership(familyId, m.personId))
                        }
                      >
                        {busy(m.personId) ? hub.unplaced.removing : hub.unplaced.removeConfirmYes}
                      </button>
                      <button
                        type="button"
                        className={styles.action}
                        data-testid={`unplaced-remove-cancel-${m.personId}`}
                        disabled={busy(m.personId)}
                        onClick={() => setConfirmRemoveId(null)}
                      >
                        {hub.unplaced.removeConfirmNo}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.action}
                        data-testid={`unplaced-place-${m.personId}`}
                        disabled={busy(m.personId)}
                        onClick={() =>
                          startPlace(
                            {
                              kind: "link",
                              personId: m.personId,
                              displayName: m.displayName,
                            },
                            { kind: "link", member: m },
                          )
                        }
                      >
                        {hub.unplaced.place}
                      </button>
                      <button
                        type="button"
                        className={styles.action}
                        data-testid={`unplaced-nonfamily-${m.personId}`}
                        disabled={busy(m.personId)}
                        onClick={() => setNonFamily(m)}
                      >
                        {busy(m.personId) ? hub.unplaced.working : hub.unplaced.leaveNonFamily}
                      </button>
                      {viewerIsSteward ? (
                        <button
                          type="button"
                          className={`${styles.action} ${styles.actionDanger}`}
                          data-testid={`unplaced-remove-${m.personId}`}
                          disabled={busy(m.personId)}
                          onClick={() => {
                            setError(null);
                            setConfirmRemoveId(m.personId);
                          }}
                        >
                          {hub.unplaced.remove}
                        </button>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {setAsideMembers.length > 0 ? (
        <>
          <h4 className={styles.nonFamilyHeading}>{hub.unplaced.nonFamilyHeading}</h4>
          <ul className={styles.list} data-testid="unplaced-set-aside">
            {setAsideMembers.map((m) => {
              const name = memberName(m);
              const named = Boolean(m.displayName?.trim());
              return (
                <li
                  key={m.personId}
                  className={styles.rowMuted}
                  data-testid={`unplaced-aside-row-${m.personId}`}
                >
                  <span className={`${styles.name} ${named ? "" : styles.nameUnknown}`}>{name}</span>
                  <span
                    className={styles.actions}
                    role="group"
                    aria-label={hub.unplaced.memberActionsAria(name)}
                  >
                    <button
                      type="button"
                      className={styles.action}
                      data-testid={`unplaced-restore-${m.personId}`}
                      disabled={busy(m.personId)}
                      onClick={() => restore(m)}
                    >
                      {busy(m.personId) ? hub.unplaced.working : hub.unplaced.restore}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {error ? (
        <p role="alert" className={styles.error} data-testid="unplaced-error">
          {error}
        </p>
      ) : null}

      {placing ? (
        <PlaceConfirmModal
          familyId={familyId}
          subject={
            placing.kind === "link"
              ? {
                  kind: "link",
                  personId: placing.member.personId,
                  displayName: placing.member.displayName,
                }
              : { kind: "mint" }
          }
          receiverLocked={false}
          onLink={onLink}
          onMint={onMint}
          onFetchAnchors={onFetchAnchors}
          onClose={() => setPlacing(null)}
          onSuccess={() => {
            setPlacing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
