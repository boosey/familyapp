"use client";
/**
 * PlaceConfirmModal (#286 / ADR-0027) — ONE shared confirm step for Tree placement.
 *
 * Used by:
 *   - Tree tray: Place on an unplaced member (link) and New person (mint)
 *   - Secondary +/kebab (via the same write helpers in place-confirm.ts)
 *   - Desktop tray → zone DnD (#287) and mobile Place→tap (#288): open with receiverLocked +
 *     initialRelation from relationFromZone
 *
 * Grilled fields: receiver name fixed when locked (editable picker otherwise); relation editable;
 * nature for parent/child; co-parent checkboxes for child; partner→kids offer before write
 * (never silent — kin options must resolve first).
 */
import { useEffect, useState, useTransition } from "react";
import type { AddRelativeRelation } from "@chronicle/core";
import type { KinshipNature } from "@chronicle/db";
import { hub } from "@/app/_copy";
import {
  listPersonKinOptionsAction,
  listPlacedPersonsAction,
  linkExistingMemberAction,
} from "./actions";
import {
  commitPlaceLink,
  commitPlaceMint,
  PLACE_CONFIRM_NATURES,
  PLACE_CONFIRM_RELATIONS,
  resolvePartnerChildrenOffer,
  type MintPlacement,
  type PlaceConfirmSubject,
  type PlacementResult,
} from "./place-confirm";
import styles from "./place-confirm-modal.module.css";

export interface PlaceConfirmReceiver {
  personId: string;
  displayName: string;
}

export interface PlaceConfirmModalProps {
  familyId: string;
  subject: PlaceConfirmSubject;
  /**
   * Receiver = person on the tree the subject relates to (anchor). When `receiverLocked`, shown
   * read-only (zone drop / kebab). When unlocked, the user picks from placed persons (tray Place).
   */
  receiver?: PlaceConfirmReceiver | null;
  receiverLocked?: boolean;
  initialRelation?: AddRelativeRelation;
  /** Optional seed partners (child co-parents). When omitted with a known receiver, fetched. */
  partners?: { id: string; name: string }[];
  /** Optional seed children (partner→kids offer). When omitted with a known receiver, fetched. */
  children?: { id: string; name: string }[];
  preselectedCoParentId?: string;
  onClose: () => void;
  onSuccess: () => void;
  onLink?: typeof linkExistingMemberAction;
  /** Typed mint adapter (#318) — receives MintPlacement, not FormData. */
  onMint?: (placement: MintPlacement) => Promise<PlacementResult>;
  onFetchAnchors?: typeof listPlacedPersonsAction;
  onFetchKinOptions?: typeof listPersonKinOptionsAction;
}

function subjectLabel(subject: PlaceConfirmSubject): string {
  if (subject.kind === "link") {
    const n = subject.displayName?.trim();
    return n ? n : hub.unplaced.unnamedMember;
  }
  return hub.placeConfirm.newPersonLabel;
}

export function PlaceConfirmModal({
  familyId,
  subject,
  receiver: receiverProp = null,
  receiverLocked = false,
  initialRelation = "parent",
  partners: partnersProp,
  children: childrenProp,
  preselectedCoParentId,
  onClose,
  onSuccess,
  onLink,
  onMint,
  onFetchAnchors = listPlacedPersonsAction,
  onFetchKinOptions = listPersonKinOptionsAction,
}: PlaceConfirmModalProps) {
  const headingName = subjectLabel(subject);
  // Primitive deps for the anchors effect — object identity of `subject` / `receiverProp`
  // must not re-trigger a fetch or reset the user's receiver mid-confirm (#286 review).
  const subjectKind = subject.kind;
  const subjectPersonId = subject.kind === "link" ? subject.personId : null;
  const receiverPersonId = receiverProp?.personId ?? null;
  const receiverDisplayName = receiverProp?.displayName ?? null;
  const [receiverId, setReceiverId] = useState(receiverPersonId ?? "");
  const [receiverName, setReceiverName] = useState(receiverDisplayName ?? "");
  const [relation, setRelation] = useState<AddRelativeRelation>(initialRelation);
  const [nature, setNature] = useState<KinshipNature>("biological");
  const [displayName, setDisplayName] = useState(
    subject.kind === "mint" ? (subject.initialDisplayName ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [anchors, setAnchors] = useState<{ id: string; name: string }[]>([]);
  const [loadingAnchors, setLoadingAnchors] = useState(!receiverLocked && !receiverProp);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>(partnersProp ?? []);
  const [children, setChildren] = useState<{ id: string; name: string }[]>(childrenProp ?? []);
  // Both lists must be seeded before we treat kin as ready (AND, not OR) — partial seed
  // would skip the kids fetch and risk a silent partner→kids write (#287/#288 reuse).
  const [kinLoadedFor, setKinLoadedFor] = useState<string | null>(
    partnersProp !== undefined && childrenProp !== undefined
      ? (receiverProp?.personId ?? null)
      : null,
  );
  const [selectedCoParents, setSelectedCoParents] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (preselectedCoParentId) initial.add(preselectedCoParentId);
    return initial;
  });
  const [pendingStepOffer, setPendingStepOffer] = useState<Set<string> | null>(null);

  // Fetch anchors when the receiver is not locked (tray Place / New without a zone target).
  useEffect(() => {
    if (receiverLocked && receiverPersonId) {
      setReceiverId(receiverPersonId);
      setReceiverName(receiverDisplayName ?? "");
      setLoadingAnchors(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoadingAnchors(true);
      const res = await onFetchAnchors(familyId);
      if (cancelled) return;
      if (res.ok) {
        const excludeId = subjectKind === "link" ? subjectPersonId : null;
        const opts = res.persons
          .filter((p) => p.personId !== excludeId)
          .map((p) => ({
            id: p.personId,
            name: p.displayName?.trim() || hub.kin.edgeUnknownPerson,
          }));
        setAnchors(opts);
        // Prefer explicit receiver prop, else keep current selection when still valid
        // (same exclude-id / familyId must not wipe a mid-confirm pick).
        setReceiverId((prev) => {
          if (receiverPersonId && opts.some((o) => o.id === receiverPersonId)) {
            setReceiverName(receiverDisplayName ?? "");
            return receiverPersonId;
          }
          if (prev && opts.some((o) => o.id === prev)) {
            setReceiverName(opts.find((o) => o.id === prev)?.name ?? "");
            return prev;
          }
          const first = opts[0];
          setReceiverName(first?.name ?? "");
          return first?.id ?? "";
        });
      } else {
        setError(hub.unplaced.actionFailed);
      }
      setLoadingAnchors(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    familyId,
    onFetchAnchors,
    receiverLocked,
    receiverPersonId,
    receiverDisplayName,
    subjectKind,
    subjectPersonId,
  ]);

  // Load partners + children for the current receiver unless the caller seeded both.
  useEffect(() => {
    let cancelled = false;
    async function loadKin() {
      if (!receiverId) {
        setPartners([]);
        setChildren([]);
        setKinLoadedFor(null);
        return;
      }
      // Caller provided both lists for this receiver (kebab / canvas) — skip fetch.
      if (
        partnersProp !== undefined &&
        childrenProp !== undefined &&
        receiverProp?.personId === receiverId
      ) {
        setPartners(partnersProp);
        setChildren(childrenProp);
        setKinLoadedFor(receiverId);
        return;
      }
      setPartners([]);
      setChildren([]);
      setSelectedCoParents((prev) => {
        if (preselectedCoParentId && prev.has(preselectedCoParentId)) return prev;
        return new Set(preselectedCoParentId ? [preselectedCoParentId] : []);
      });
      setPendingStepOffer(null);
      setKinLoadedFor(null);
      const res = await onFetchKinOptions(familyId, receiverId);
      if (cancelled) return;
      if (res.ok) {
        setPartners(res.partners);
        setChildren(res.children);
        setKinLoadedFor(receiverId);
      } else {
        // Keep submit blocked — a failed fetch must not unlock a silent partner-only write.
        setError(hub.unplaced.actionFailed);
      }
    }
    void loadKin();
    return () => {
      cancelled = true;
    };
  }, [
    familyId,
    receiverId,
    onFetchKinOptions,
    partnersProp,
    childrenProp,
    receiverProp?.personId,
    preselectedCoParentId,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasReceiver = !!receiverId;
  const kinOptionsReady = !!receiverId && kinLoadedFor === receiverId;
  const showNature = relation === "parent" || relation === "child";
  const gated = pendingStepOffer !== null;

  function doCommit(stepParentOfChildIds: string[] | undefined) {
    setError(null);
    startTransition(async () => {
      const coParents = relation === "child" ? [...selectedCoParents] : [];
      const writeOpts = {
        coParentPersonIds: coParents.length > 0 ? coParents : undefined,
        // Explicit array (possibly empty) when offer resolved — never omit for partner+kids (#318).
        stepParentOfChildIds:
          relation === "partner" ? stepParentOfChildIds : undefined,
        nature: showNature ? nature : undefined,
        // Always pass known kids so Placement rejects unresolved partner offers (#318).
        anchorChildIds: children.map((c) => c.id),
      };
      if (subject.kind === "link") {
        const res = await commitPlaceLink(
          familyId,
          subject.personId,
          relation,
          receiverId,
          writeOpts,
          { onLink },
        );
        if (!res.ok) {
          setError(hub.unplaced.actionFailed);
          return;
        }
      } else {
        const res = await commitPlaceMint(
          familyId,
          relation,
          receiverId,
          {
            displayName,
            ...writeOpts,
          },
          { onMint },
        );
        if (!res.ok) {
          setError(res.error ?? hub.unplaced.actionFailed);
          return;
        }
      }
      onSuccess();
    });
  }

  function onSubmit() {
    if (!hasReceiver || !kinOptionsReady) return;
    const offer = resolvePartnerChildrenOffer({
      relation,
      children,
      pendingSelection: pendingStepOffer,
    });
    if (offer.type === "show-offer") {
      setPendingStepOffer(offer.initialSelection);
      return;
    }
    doCommit(offer.stepParentOfChildIds);
  }

  const title =
    subject.kind === "link"
      ? hub.unplaced.placeHeading(headingName)
      : hub.placeConfirm.mintHeading;

  return (
    <div role="presentation" className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="place-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        className={styles.dialog}
      >
        <div className={styles.dialogHead}>
          <h2 className={styles.dialogTitle}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={hub.unplaced.placeClose}
            className={styles.dialogClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p className={styles.intro}>
          {subject.kind === "link" ? hub.unplaced.placeIntro : hub.placeConfirm.mintIntro}
        </p>

        {loadingAnchors ? (
          <p className={styles.intro} data-testid="place-confirm-loading-anchors">
            {hub.unplaced.loadingAnchors}
          </p>
        ) : hasReceiver || receiverLocked ? (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {subject.kind === "link" ? (
              <div>
                <span className="kin-form-label">{hub.placeConfirm.subjectFieldLabel}</span>
                <div className={styles.lockedField} data-testid="place-confirm-subject">
                  {headingName}
                </div>
              </div>
            ) : (
              <label className="kin-form-label">
                {hub.kin.nameFieldLabel}
                <input
                  type="text"
                  className="kin-field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={hub.kin.namePlaceholder}
                  autoComplete="off"
                  disabled={gated}
                  data-testid="place-confirm-name"
                />
              </label>
            )}

            <label className="kin-form-label">
              {hub.unplaced.anchorFieldLabel}
              {receiverLocked ? (
                <div className={styles.lockedField} data-testid="place-confirm-receiver">
                  {receiverName || hub.kin.edgeUnknownPerson}
                </div>
              ) : anchors.length > 0 ? (
                <select
                  className="kin-field"
                  value={receiverId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setReceiverId(id);
                    setReceiverName(anchors.find((a) => a.id === id)?.name ?? "");
                    setPendingStepOffer(null);
                  }}
                  data-testid="place-confirm-receiver"
                  required
                  disabled={gated}
                >
                  {anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className={styles.intro} data-testid="place-confirm-no-anchors">
                  {hub.unplaced.noAnchors}
                </p>
              )}
            </label>

            {hasReceiver ? (
              <>
                <label className="kin-form-label">
                  {hub.unplaced.relationFieldLabel}
                  <select
                    className="kin-field"
                    value={relation}
                    onChange={(e) => {
                      setRelation(e.target.value as AddRelativeRelation);
                      setPendingStepOffer(null);
                    }}
                    data-testid="place-confirm-relation"
                    required
                    disabled={gated}
                  >
                    {PLACE_CONFIRM_RELATIONS.map((r) => (
                      <option key={r} value={r}>
                        {hub.unplaced.relationOptions[r]}
                      </option>
                    ))}
                  </select>
                </label>

                {showNature ? (
                  <label className="kin-form-label">
                    {hub.kin.natureFieldLabelAdd}
                    <select
                      className="kin-field"
                      value={nature}
                      onChange={(e) => setNature(e.target.value as KinshipNature)}
                      disabled={gated}
                      data-testid="place-confirm-nature"
                    >
                      {PLACE_CONFIRM_NATURES.map((n) => (
                        <option key={n} value={n}>
                          {hub.kin.natureOptions[n]}
                        </option>
                      ))}
                    </select>
                    <span className={styles.hint}>{hub.kin.natureHintBiological}</span>
                  </label>
                ) : null}

                {relation === "child" && partners.length > 0 ? (
                  <fieldset className={styles.fieldset} data-testid="place-confirm-coparents">
                    <legend className="kin-form-label" style={{ padding: 0 }}>
                      {hub.kin.otherParentLabel}
                    </legend>
                    <span className={styles.hint}>{hub.kin.otherParentHint}</span>
                    {partners.map((p) => (
                      <label key={p.id} className={styles.checkRow}>
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
                          data-testid={`place-confirm-coparent-${p.id}`}
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
                    data-testid="place-confirm-step-offer"
                    style={{ display: "grid", gap: 12 }}
                  >
                    <p className={styles.intro} style={{ margin: 0 }}>
                      {hub.kin.stepParentOfferIntro}
                    </p>
                    {children.map((c) => (
                      <label key={c.id} className={styles.checkRow}>
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
                          data-testid={`place-confirm-step-child-${c.id}`}
                        />
                        {c.name}
                      </label>
                    ))}
                    <button
                      type="button"
                      className={styles.action}
                      data-testid="place-confirm-step-confirm"
                      disabled={pending}
                      onClick={() => {
                        const offer = resolvePartnerChildrenOffer({
                          relation,
                          children,
                          pendingSelection: pendingStepOffer,
                        });
                        if (offer.type === "ready") doCommit(offer.stepParentOfChildIds);
                      }}
                    >
                      {pending ? hub.unplaced.placing : hub.kin.stepParentOfferConfirm}
                    </button>
                    <button
                      type="button"
                      className={styles.action}
                      data-testid="place-confirm-step-skip"
                      disabled={pending}
                      onClick={() => doCommit([])}
                    >
                      {hub.kin.stepParentOfferSkip}
                    </button>
                  </div>
                ) : (
                  <button
                    type="submit"
                    className={styles.action}
                    data-testid="place-confirm-submit"
                    disabled={pending || !kinOptionsReady}
                  >
                    {pending
                      ? hub.unplaced.placing
                      : subject.kind === "link"
                        ? hub.unplaced.placeSubmit
                        : hub.placeConfirm.mintSubmit}
                  </button>
                )}
              </>
            ) : null}

            {error ? (
              <p role="alert" className={styles.error} data-testid="place-confirm-error">
                {error}
              </p>
            ) : null}
          </form>
        ) : (
          <p className={styles.intro} data-testid="place-confirm-no-anchors">
            {hub.unplaced.noAnchors}
          </p>
        )}
      </div>
    </div>
  );
}
