"use client";
/**
 * UnplacedMembers (#161, ADR-0023) — the "not yet connected" surface, rendered in BOTH Family-tab
 * views: as a section under the relatives List and as a tray at the Tree canvas margin. It lists every
 * active member who touches NO visible kinship edge (invisible in the graph-only tree) and exposes
 * three per-member actions:
 *
 *   - Place in tree  → opens <PlaceMemberModal>: pick an existing relative (anchor) + a relationship,
 *                      then `linkExistingMemberAction` attaches the member (never mints a duplicate).
 *   - Not family     → `setMemberNonFamilyAction(nonFamily:true)`; moves them to a quiet "set aside"
 *                      sub-list with a "Move back" inverse.
 *   - Remove         → STEWARD-ONLY (gated on `viewerIsSteward`); a two-tap in-page confirm (never a
 *                      native confirm() — it breaks the test harness) then `endMembershipAction`.
 *
 * The parent (page) revalidates `/hub` inside each action, so on success the server re-renders with the
 * member gone from the unplaced set; a `router.refresh()` here pulls that fresh render in without a
 * full reload. Anchors come from the tree's currently-placed persons (passed in), so a member is always
 * linked to someone already visible in the tree.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AddRelativeRelation, UnplacedMember } from "@chronicle/core";
import { hub } from "@/app/_copy";
import {
  endMembershipAction,
  linkExistingMemberAction,
  listPersonKinOptionsAction,
  listPlacedPersonsAction,
  setMemberNonFamilyAction,
} from "../tree/actions";
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
  /** Overridable in tests so the actions can be stubbed without a server round-trip. */
  onLink?: typeof linkExistingMemberAction;
  onSetNonFamily?: typeof setMemberNonFamilyAction;
  onEndMembership?: typeof endMembershipAction;
  onFetchAnchors?: typeof listPlacedPersonsAction;
}

function memberName(m: UnplacedMember): string {
  const n = m.displayName?.trim();
  return n ? n : hub.unplaced.unnamedMember;
}

export function UnplacedMembers({
  familyId,
  members,
  viewerIsSteward,
  variant = "section",
  onLink = linkExistingMemberAction,
  onSetNonFamily = setMemberNonFamilyAction,
  onEndMembership = endMembershipAction,
  onFetchAnchors = listPlacedPersonsAction,
}: UnplacedMembersProps) {
  const router = useRouter();
  // The member currently being placed (its modal is open), or null.
  const [placing, setPlacing] = useState<UnplacedMember | null>(null);
  // Per-member "confirm remove" arm state + a shared error line.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Members set aside as non-family THIS session — kept in place (not refreshed away) so the inverse
  // "Move back" stays reachable. `listUnplacedMembers` excludes them, so a refresh would drop them
  // entirely; holding them here gives a real, immediate undo without a second core read.
  const [setAside, setAside_] = useState<Map<string, UnplacedMember>>(new Map());

  if (members.length === 0 && setAside.size === 0) return null;

  const busy = (id: string) => isPending && pendingId === id;

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

  // The active rows are the server-supplied unplaced members MINUS any set aside this session (they
  // move to the quiet sub-list below).
  const activeMembers = members.filter((m) => !setAside.has(m.personId));
  const setAsideMembers = [...setAside.values()];

  return (
    <section
      className={variant === "tray" ? styles.tray : styles.section}
      data-testid="unplaced-members"
      aria-label={hub.unplaced.heading}
    >
      <h3 className={styles.heading}>{hub.unplaced.heading}</h3>
      <p className={styles.intro}>{hub.unplaced.intro}</p>

      <ul className={styles.list}>
        {activeMembers.map((m) => {
          const name = memberName(m);
          const named = Boolean(m.displayName?.trim());
          const confirming = confirmRemoveId === m.personId;
          return (
            <li key={m.personId} className={styles.row} data-testid={`unplaced-row-${m.personId}`}>
              <span className={`${styles.name} ${named ? "" : styles.nameUnknown}`}>{name}</span>
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
                      onClick={() => {
                        setError(null);
                        setPlacing(m);
                      }}
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
        <PlaceMemberModal
          familyId={familyId}
          member={placing}
          onLink={onLink}
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

/** The five relations the place-in-tree flow offers (member is the {relation} of the anchor). */
const RELATIONS: readonly AddRelativeRelation[] = [
  "parent",
  "child",
  "partner",
  "sibling",
  "grandparent",
];

interface PlaceMemberModalProps {
  familyId: string;
  member: UnplacedMember;
  onLink: typeof linkExistingMemberAction;
  onFetchAnchors: typeof listPlacedPersonsAction;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Link an EXISTING member (`member`) to an `anchor` with a chosen relation (#161, blended #285).
 * Reuses the shared relation vocabulary; the anchor is a person already in the tree. Escape/overlay-
 * click dismiss. Child place shows co-parent checkboxes; partner place confirms step parent-of to
 * existing kids before write (ADR-0027 — never silent).
 */
function PlaceMemberModal({
  familyId,
  member,
  onLink,
  onFetchAnchors,
  onClose,
  onSuccess,
}: PlaceMemberModalProps) {
  const name = memberName(member);
  const [anchorId, setAnchorId] = useState<string>("");
  const [relation, setRelation] = useState<AddRelativeRelation>("parent");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [anchors, setAnchors] = useState<AnchorOption[]>([]);
  const [loadingAnchors, setLoadingAnchors] = useState(true);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [children, setChildren] = useState<{ id: string; name: string }[]>([]);
  /** Anchor id for which `partners`/`children` are current; null while a fetch is in flight. */
  const [kinLoadedFor, setKinLoadedFor] = useState<string | null>(null);
  const [selectedCoParents, setSelectedCoParents] = useState<Set<string>>(new Set());
  const [pendingStepOffer, setPendingStepOffer] = useState<Set<string> | null>(null);

  // Fetch the full family-wide placed-person list on mount (#169).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingAnchors(true);
      const res = await onFetchAnchors(familyId);
      if (cancelled) return;
      if (res.ok) {
        // #250: seed fallback may include the member being placed; never offer a self-link.
        const opts = res.persons
          .filter((p) => p.personId !== member.personId)
          .map((p) => ({
            id: p.personId,
            name: p.displayName?.trim() || hub.kin.edgeUnknownPerson,
          }));
        setAnchors(opts);
        const first = opts[0];
        if (first) {
          setAnchorId(first.id);
        }
      } else {
        setError(hub.unplaced.actionFailed);
      }
      setLoadingAnchors(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [familyId, member.personId, onFetchAnchors]);

  // When the chosen anchor changes, load their partners + children for confirm UI (#285).
  // Invalidate immediately via kinLoadedFor !== anchorId so a stale empty/previous list cannot
  // silence the partner step offer (submit waits until kin options resolve for this anchor).
  useEffect(() => {
    let cancelled = false;
    async function loadKin() {
      if (!anchorId) {
        setPartners([]);
        setChildren([]);
        setKinLoadedFor(null);
        return;
      }
      setPartners([]);
      setChildren([]);
      setSelectedCoParents(new Set());
      setPendingStepOffer(null);
      setKinLoadedFor(null);
      const res = await listPersonKinOptionsAction(familyId, anchorId);
      if (cancelled) return;
      if (res.ok) {
        setPartners(res.partners);
        setChildren(res.children);
      }
      setKinLoadedFor(anchorId);
    }
    void loadKin();
    return () => {
      cancelled = true;
    };
  }, [familyId, anchorId]);

  // Escape closes (mirrors AddRelativeModal — a window listener, not a div handler, so it fires
  // regardless of focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasAnchors = anchors.length > 0;
  // True only when partners/children belong to the current anchor (closes the race where
  // children=[] before listPersonKinOptionsAction returns → silent partner-only write).
  const kinOptionsReady = !!anchorId && kinLoadedFor === anchorId;

  function doLink(stepKids: string[]) {
    setError(null);
    startTransition(async () => {
      const coParents = relation === "child" ? [...selectedCoParents] : [];
      const res = await onLink(
        familyId,
        member.personId,
        relation,
        anchorId,
        coParents.length === 1 ? coParents[0] : undefined,
        {
          coParentPersonIds: coParents.length > 0 ? coParents : undefined,
          stepParentOfChildIds: relation === "partner" && stepKids.length > 0 ? stepKids : undefined,
          nature: relation === "parent" || relation === "child" ? "biological" : undefined,
        },
      );
      if (!res.ok) {
        setError(hub.unplaced.actionFailed);
        return;
      }
      onSuccess();
    });
  }

  function onSubmit() {
    if (!hasAnchors || !anchorId || !kinOptionsReady) return;
    if (relation === "partner" && children.length > 0 && pendingStepOffer === null) {
      setPendingStepOffer(new Set(children.map((c) => c.id)));
      return;
    }
    doLink(pendingStepOffer ? [...pendingStepOffer] : []);
  }

  return (
    <div role="presentation" className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={hub.unplaced.placeHeading(name)}
        data-testid="place-member-modal"
        onClick={(e) => e.stopPropagation()}
        className={styles.dialog}
      >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{hub.unplaced.placeHeading(name)}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={hub.unplaced.placeClose}
            className={styles.dialogClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p className={styles.intro}>{hub.unplaced.placeIntro}</p>

        {loadingAnchors ? (
          <p className={styles.intro} data-testid="place-member-loading-anchors">
            {hub.unplaced.loadingAnchors}
          </p>
        ) : hasAnchors ? (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <label className="kin-form-label">
              {hub.unplaced.anchorFieldLabel}
              <select
                className="kin-field"
                value={anchorId}
                onChange={(e) => setAnchorId(e.target.value)}
                data-testid="place-member-anchor"
                required
                disabled={pendingStepOffer !== null}
              >
                {anchors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="kin-form-label">
              {hub.unplaced.relationFieldLabel}
              <select
                className="kin-field"
                value={relation}
                onChange={(e) => {
                  setRelation(e.target.value as AddRelativeRelation);
                  setPendingStepOffer(null);
                }}
                data-testid="place-member-relation"
                required
                disabled={pendingStepOffer !== null}
              >
                {RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {hub.unplaced.relationOptions[r]}
                  </option>
                ))}
              </select>
            </label>

            {relation === "child" && partners.length > 0 ? (
              <fieldset
                style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}
                data-testid="place-member-coparents"
              >
                <legend className="kin-form-label" style={{ padding: 0 }}>
                  {hub.kin.otherParentLabel}
                </legend>
                {partners.map((p) => (
                  <label
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCoParents.has(p.id)}
                      onChange={(e) => {
                        setSelectedCoParents((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        });
                      }}
                      data-testid={`place-member-coparent-${p.id}`}
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
            ) : null}

            {pendingStepOffer ? (
              <div
                role="group"
                aria-label={hub.kin.stepParentOfferHeading}
                data-testid="place-member-step-offer"
                style={{ display: "grid", gap: 12 }}
              >
                <p className={styles.intro} style={{ margin: 0 }}>
                  {hub.kin.stepParentOfferIntro}
                </p>
                {children.map((c) => (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--text-ui)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pendingStepOffer.has(c.id)}
                      onChange={(e) => {
                        setPendingStepOffer((prev) => {
                          if (!prev) return prev;
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        });
                      }}
                      data-testid={`place-member-step-child-${c.id}`}
                    />
                    {c.name}
                  </label>
                ))}
                <button
                  type="button"
                  className={styles.action}
                  data-testid="place-member-step-confirm"
                  disabled={pending}
                  onClick={() => doLink([...pendingStepOffer])}
                >
                  {pending ? hub.unplaced.placing : hub.kin.stepParentOfferConfirm}
                </button>
                <button
                  type="button"
                  className={styles.action}
                  data-testid="place-member-step-skip"
                  disabled={pending}
                  onClick={() => doLink([])}
                >
                  {hub.kin.stepParentOfferSkip}
                </button>
              </div>
            ) : (
              <button
                type="submit"
                className={styles.action}
                data-testid="place-member-submit"
                disabled={pending || !kinOptionsReady}
              >
                {pending ? hub.unplaced.placing : hub.unplaced.placeSubmit}
              </button>
            )}

            {error ? (
              <p role="alert" className={styles.error} data-testid="place-member-error">
                {error}
              </p>
            ) : null}
          </form>
        ) : (
          <p className={styles.intro} data-testid="place-member-no-anchors">
            {hub.unplaced.noAnchors}
          </p>
        )}
      </div>
    </div>
  );
}
