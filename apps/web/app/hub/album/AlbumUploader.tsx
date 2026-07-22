"use client";

/**
 * Album upload control (ADR-0009 · #15 · #16 · issue #20). A single "Add to album" button that opens
 * the OS file picker directly (the file input itself is hidden — no visible "choose files" control)
 * and uploads the chosen files the moment the picker closes. issue #20: each file is uploaded DIRECTLY
 * to object storage (request a server-minted target → PUT the bytes → record the row), so the bytes
 * never transit a Server Action / Vercel's ~4.5 MB request-body cap. The server still re-resolves auth
 * and re-validates the target albums on `record` — the client passes only its picker choice + the
 * server-issued ticket. On success it refreshes the server component so the new tiles appear.
 *
 * (When the F2 board mount is active, this component instead DELEGATES import to `AlbumBoard` via
 * `onImportFiles` — the per-item pool + placeholder tiles — and never runs this self-driving path.)
 *
 * Multi-select (#16): the hidden file input carries `multiple`, so the OS picker lets the contributor
 * choose MANY photos at once. Each selected file becomes its own album photo placed into the SAME
 * chosen album(s). A partial success (some files failed) surfaces a gentle inline note rather than an
 * error.
 *
 * #94 — files-first destination: the family destination designator moved OFF the standing toolbar (the
 * retired "Which albums?" fieldset) and INTO the add/import action, as a modal. Choosing files (device)
 * or completing the Google picker (import) STASHES the pending payload and opens `AlbumDestinationModal`
 * — the SOLE home of the no-silent-fan-out rule (Add disabled until ≥1 family is chosen). Add fires the
 * upload/import against the chosen destination; Cancel discards it with zero storage writes. The modal
 * appears only for a >1-family viewer: a solo-family contributor sees NO modal and the add/import
 * proceeds straight through with no familyIds (the server auto-selects the sole family, unchanged).
 * The modal's destination Set is seeded from the filter-aware designator seed (`defaultSelected`).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pickerUriForWeb } from "@chronicle/photos-google/picker";
import {
  completeGooglePhotosImportAction,
  disconnectGooglePhotosAction,
  pollGooglePhotosImportAction,
  startGooglePhotosImportAction,
} from "./google-photos-actions";
import { prepareAlbumPhoto } from "./prepare-photo";
import { uploadPhotoDirect } from "./direct-upload";
import { ImagePlus } from "lucide-react";
import { hub } from "@/app/_copy";
import { useIsCompact } from "@/app/_kindred/useIsCompact";
import { ICON_SHEET_GLYPH_SIZE } from "../icon-sheet-constants";
import { AddPhotosMenu } from "./AddPhotosMenu";
import { AlbumDestinationModal } from "./AlbumDestinationModal";
import { seedComposeFamilies } from "@/lib/compose-scope";
import {
  PHOTO_BATCH_MAX_FILES as MAX_BATCH_FILES,
  PHOTO_PICKER_POLL_INTERVAL_MS as PICKER_POLL_INTERVAL_MS,
  PHOTO_PICKER_POLL_TIMEOUT_MS as PICKER_POLL_TIMEOUT_MS,
} from "@/lib/constants";

export interface AlbumFamilyOption {
  familyId: string;
  familyName: string;
  /** Steward-set brief label (ADR-0021); the placement chips show it in place of `familyName`. */
  familyShortName?: string | null;
}

/**
 * The payload a >1-family add/import stashes while the #94 destination modal is open. The bytes are NOT
 * yet stored — `upload` holds the chosen Files (direct-to-storage fires on Add); `google` holds the
 * ready picker session (the completion action fires on Add). Cancel drops this untouched.
 */
type PendingDestination =
  | { kind: "upload"; files: File[] }
  | { kind: "google"; sessionId: string };


/** Map OAuth callback error codes to user-facing copy. */
function oauthErrorMessage(code: string): string {
  switch (code) {
    case "denied":
      return hub.album.googlePhotosOAuthDenied;
    case "invalid_state":
      return hub.album.googlePhotosOAuthInvalidState;
    case "not_configured":
      return hub.album.googlePhotosUnavailable;
    case "exchange_failed":
      return hub.album.googlePhotosOAuthExchangeFailed;
    default:
      return hub.album.googlePhotosOAuthExchangeFailed;
  }
}

export function AlbumUploader({
  families,
  currentFamilyId,
  scope = null,
  defaultSelected,
  showFileUpload = true,
  googlePhotosConfigured = false,
  googlePhotosConnected = false,
  googlePhotosEmail = null,
  googlePhotosOauthConnected = false,
  googlePhotosOauthError = null,
  onImportFiles,
  onImportGoogle,
  iconified,
}: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
  /**
   * The single scope seed ("all" | a family id) collapsed from the shared `?families=` browse filter
   * (ADR-0021). When it names a concrete family the viewer is in, the default selection follows it
   * (consistency with the ask picker); otherwise ("all" or absent) it falls back to the current album.
   * Superseded by `defaultSelected` when the caller supplies one — the surface owns the sole/ambiguous
   * designator rule (ADR-0021) so it lives in ONE place; `scope` is the legacy seed path.
   */
  scope?: string | null;
  /**
   * The Family DESIGNATOR's initial selection (ADR-0021), computed by the surface: the sole/single
   * family pre-selected when unambiguous, or the EMPTY array when ambiguous (viewer has >1 family and
   * the filter names neither one — a photo must not silently fan out). When provided it is the single
   * source of the seed (and its re-seed key); when omitted the legacy `scope`/`currentFamilyId` seed
   * applies (kept so existing callers/tests are unchanged).
   */
  defaultSelected?: string[];
  /** When false, hide the OS file-upload button (multi-family "all" scope). Google import may still show. */
  showFileUpload?: boolean;
  /** When false (default), no Google Photos chrome — file upload only. */
  googlePhotosConfigured?: boolean;
  /** Active encrypted connection for this person. */
  googlePhotosConnected?: boolean;
  /** Optional Google account email for a quiet status line. */
  googlePhotosEmail?: string | null;
  /** One-shot success flash after OAuth callback (`?googlePhotos=connected`). */
  googlePhotosOauthConnected?: boolean;
  /** One-shot error flash after OAuth callback (`?googlePhotosError=`). */
  googlePhotosOauthError?: string | null;
  /** F2 board mode (ADR-0015): when provided, hand import EXECUTION off to the board (per-item pool +
   *  pending tiles) instead of running the batched actions. Absent → today's self-driving behavior. */
  onImportFiles?: (files: File[], familyIds: string[]) => void;
  onImportGoogle?: (sessionId: string, familyIds: string[]) => void;
  /**
   * Progressive control row (#302): when set, overrides compact-breakpoint iconification so Add Photos
   * iconifies by measured row width. Omit to keep the legacy useIsCompact path.
   */
  iconified?: boolean;
}) {
  const router = useRouter();
  // ADR-0025 Increment 3 Step B / #302: iconify the Add-Photos trigger under width pressure (or on the
  // legacy compact strip when `iconified` is omitted). SSR/first-paint = labeled.
  const compact = useIsCompact();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The Add Photos trigger — the destination modal restores focus here when it closes (#94), since the
  // menuitem that opened it has unmounted with the dropdown.
  const addMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A gentle, non-error note after a partial-success batch (some files landed, some didn't).
  const [note, setNote] = useState<string | null>(null);
  const oauthFlashHandled = useRef(false);
  // #94 — the files-first destination modal's stashed payload. `null` = no modal. Set when files are
  // chosen (device) or the Google picker completes (import) AND the viewer has >1 family; the modal's
  // Add fires the corresponding upload/import against the chosen destination, and Cancel discards it.
  const [pendingDestination, setPendingDestination] = useState<PendingDestination | null>(null);
  // #94 UX: for a Google import the destination modal opens the MOMENT the picker returns (popup
  // closed), before Google confirms the selection is ready — so the viewer never faces dead air.
  // Until the session is confirmed ready, the modal is shown in a "preparing" state (Add held
  // disabled behind a spinner). `false` while preparing; flips `true` when the readiness poll
  // resolves. Only meaningful while a `google` payload is stashed.
  const [googleSessionReady, setGoogleSessionReady] = useState(false);
  // Monotonic "generation" fencing for the Google import loop. Each `runGoogleImport` captures the
  // generation it started under; a Cancel (or a fresh import started right after one) BUMPS this ref,
  // so any still-running older loop sees its generation is stale and goes inert — it never reopens the
  // modal, re-seeds, clears state, or fires the completion for a session the viewer already backed
  // out of. A single boolean flag couldn't do this: a re-import would reset it and silently
  // un-cancel the abandoned loop. A ref (not state) so the running async loop reads the LATEST value
  // without re-rendering.
  const importGenRef = useRef(0);

  // Surface OAuth callback flash once, then strip the query params so a refresh doesn't repeat it.
  useEffect(() => {
    if (oauthFlashHandled.current) return;
    if (!googlePhotosOauthConnected && !googlePhotosOauthError) return;
    oauthFlashHandled.current = true;

    if (googlePhotosOauthConnected) {
      setError(null);
      setNote(hub.album.googlePhotosConnectedSuccess);
    } else if (googlePhotosOauthError) {
      setNote(null);
      setError(oauthErrorMessage(googlePhotosOauthError));
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("googlePhotos");
    url.searchParams.delete("googlePhotosError");
    const next = `${url.pathname}${url.search}${url.hash}`;
    router.replace(next);
  }, [googlePhotosOauthConnected, googlePhotosOauthError, router]);
  // Multi-family picker state. Seed from the hub scope when it names a concrete family (shared rule
  // with the ask picker via `seedComposeFamilies`), else fall back to ONLY the current album context
  // (never "all"). A concrete non-"all" family scope wins; "all" defers to the current album.
  const showPicker = families.length > 1 && (showFileUpload || googlePhotosConfigured);
  const familyIds = families.map((f) => f.familyId);
  // The seed follows the DESIGNATOR rule when the surface supplies `defaultSelected` (ADR-0021: the
  // sole/single family pre-selected, or the EMPTY set when ambiguous — a photo never silently fans out
  // to all families). Only its ids the viewer is actually in survive (defense in depth). Absent, the
  // legacy scope/currentFamily seed applies (unchanged for existing callers/tests).
  const seed = (): Set<string> => {
    if (defaultSelected !== undefined) {
      const allowed = new Set(familyIds);
      return new Set(defaultSelected.filter((id) => allowed.has(id)));
    }
    if (scope && scope !== "all") {
      const s = seedComposeFamilies(scope, familyIds);
      if (s.size > 0) return s;
    }
    return new Set([currentFamilyId]);
  };
  const [selected, setSelected] = useState<Set<string>>(seed);
  // The family switcher (a filter/scope change) is a same-route soft navigation, so this component is
  // NOT remounted — only its props change. Re-seed the picker whenever the seed SIGNAL changes (the
  // "adjust state during render on a prop change" pattern), so the default always tracks the current
  // filter WITHOUT the designator ever writing back to `?families=`. When `defaultSelected` drives the
  // seed, key on it; otherwise key on scope+currentFamily. An in-progress selection is left untouched
  // while the signal is unchanged (the key comparison guards that).
  const seedKey =
    defaultSelected !== undefined
      ? `sel|${[...defaultSelected].sort().join(",")}`
      : `${scope ?? ""}|${currentFamilyId}`;
  const [prevKey, setPrevKey] = useState(seedKey);
  if (prevKey !== seedKey) {
    setPrevKey(seedKey);
    setSelected(seed());
  }

  function toggle(familyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  }

  // The OS picker just handed files back. #94: choosing files is the START of the add — a >1-family
  // viewer must first pick a destination (the modal), while a solo-family viewer proceeds straight
  // through (no modal, no familyIds — the server auto-selects the sole family). We only guard the cap
  // here; the actual upload/board-handoff runs in `runUpload` once the destination is settled.
  function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Guard the obvious mistake client-side (fast, friendly) before spending an upload; the server
    // re-checks the same cap and is authoritative.
    if (files.length > MAX_BATCH_FILES) {
      setError(hub.actions.tooManyPhotos(MAX_BATCH_FILES));
      setNote(null);
      return;
    }
    const chosen = Array.from(files);
    if (showPicker) {
      // Multi-family: stash the files and open the destination modal. Re-seed the selection from the
      // filter-aware designator seed so the modal opens at the current default (not a stale set).
      setError(null);
      setNote(null);
      setSelected(seed());
      setPendingDestination({ kind: "upload", files: chosen });
      return;
    }
    // Solo-family: no destination to pick — proceed with no familyIds (the server defaults to the
    // sole family, unchanged).
    runUpload(chosen, []);
  }

  // Run the actual per-file upload (or hand off to the board) against a settled destination. Called
  // directly for a solo-family viewer, or from the destination modal's Add for a >1-family viewer.
  function runUpload(selectedFiles: File[], chosenFamilies: string[]) {
    // F2 board mode (ADR-0015): hand execution to the board — it prepares each file per-item (so one
    // prepare failure doesn't abort the batch) and drives the per-item pool. No prepare, no batched
    // action, no transition here.
    if (onImportFiles) {
      setError(null);
      setNote(null);
      onImportFiles(selectedFiles, chosenFamilies);
      setSelected(seed());
      return;
    }
    // issue #20 — direct-to-storage: this legacy (non-board) path uploads each file straight to object
    // storage (request target → PUT bytes → record row) instead of POSTing bytes through a Server
    // Action. The chosen albums (a solo contributor sends none; the server defaults to their sole
    // family) ride along on each per-file `record`. Each file is independent — one failure never aborts
    // the batch — and a partial success surfaces a soft note, matching the previous batch behavior.
    startTransition(async () => {
      let added = 0;
      let failed = 0;
      let hardError: string | null = null;
      for (const file of selectedFiles) {
        const prep = await prepareAlbumPhoto(file);
        if (!prep.ok) {
          // A prepare failure (HEIC or a canvas encode failure — issue #20 removed the size cap) is a
          // hard, up-front error for this path: there is no per-tile retry here, so name it and stop.
          hardError =
            prep.error === "heic_unsupported"
              ? hub.actions.photoHeicUnsupported
              : hub.actions.photoEncodeFailed;
          break;
        }
        // uploadPhotoDirect never throws — a network/server failure comes back as { error }.
        const result = await uploadPhotoDirect(prep.file, chosenFamilies);
        if ("error" in result) failed += 1;
        else added += 1;
      }

      if (hardError) {
        setError(hardError);
        setNote(null);
        // Files uploaded before the hard failure already landed — reflect them (and clear the
        // consumed selection) instead of leaving them invisible until a manual reload.
        if (added > 0) {
          setSelected(seed());
          router.refresh();
        }
        return;
      }
      if (added === 0) {
        setError(hub.album.uploadError);
        setNote(null);
        return;
      }
      setError(null);
      // A partial success (some files failed) is not an error — surface a soft note so the
      // contributor knows exactly what landed and can retry the rest.
      setNote(failed > 0 ? hub.album.photosPartial(added, failed) : null);
      setSelected(seed());
      router.refresh();
    });
  }

  // Open the OS file picker. Reset the input's value first so re-choosing the SAME file(s) still
  // fires a change event (the browser suppresses change when the value is unchanged).
  function openPicker() {
    const input = fileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }

  // #94 — the no-fan-out gate moved OFF the menu items and INTO the destination modal (Add is disabled
  // there until ≥1 family is chosen). The menu items are now only disabled while an add is in flight;
  // an empty selection no longer blocks opening the picker, because choosing files/importing is what
  // OPENS the destination modal in the first place.
  const busy = pending || googlePending;
  const addDisabled = busy;
  const importDisabled = busy;

  async function runGoogleImport() {
    // Claim a fresh generation; this also supersedes any older loop still running (e.g. one the
    // viewer cancelled a moment ago), so only THIS loop may mutate the shared import state.
    const gen = (importGenRef.current += 1);
    const stale = () => importGenRef.current !== gen;
    setError(null);
    setNote(hub.album.googlePhotosImporting);
    setGooglePending(true);
    try {
      const started = await startGooglePhotosImportAction();
      // Superseded while the session was being minted — abandon quietly.
      if (stale()) return;
      if ("error" in started) {
        setError(started.error);
        setNote(null);
        return;
      }
      // Open Google's Picker UI. Do NOT pass `noopener` in window features: with noopener,
      // window.open returns null EVEN WHEN the picker opened successfully (HTML/MDN), which
      // previously aborted the import before polling — picker tab open, photos never imported.
      // A sized `popup=yes` window also makes /autoclose more reliable than a full browser tab.
      // Sever opener after open (same protection as noopener) so the cross-origin picker cannot
      // reverse-tabnab the hub; pickerUriForWeb also rejects non-Google Photos hosts.
      let pickerUrl: string;
      try {
        pickerUrl = pickerUriForWeb(started.pickerUri);
      } catch {
        setError(hub.album.googlePhotosImportFailed);
        setNote(null);
        return;
      }
      const popup = window.open(
        pickerUrl,
        "chronicle-google-photos-picker",
        "popup=yes,width=1100,height=800",
      );
      if (!popup) {
        setError(hub.album.googlePhotosPopupBlocked);
        setNote(null);
        return;
      }
      try {
        popup.opener = null;
      } catch {
        /* ignore if the browser already isolated the browsing context */
      }
      setNote(hub.album.googlePhotosWaiting);

      const pollIntervalMs = started.pollIntervalMs ?? PICKER_POLL_INTERVAL_MS;
      const pollTimeoutMs = started.pollTimeoutMs ?? PICKER_POLL_TIMEOUT_MS;
      const deadline = Date.now() + pollTimeoutMs;
      let ready = false;
      // #94 UX: a >1-family viewer's destination modal opens the MOMENT the picker returns (popup
      // closed) rather than after the readiness poll resolves — no dead air. `opened` tracks whether
      // we've already stashed the payload + shown the modal in its "preparing" state.
      let opened = false;
      const openPreparingModal = () => {
        setGooglePending(false);
        setError(null);
        setNote(null);
        setGoogleSessionReady(false);
        setSelected(seed());
        setPendingDestination({ kind: "google", sessionId: started.sessionId });
        opened = true;
      };
      // Close the popup and stop — used whenever this loop is abandoned (cancelled/superseded).
      const closePopup = () => {
        try {
          if (!popup.closed) popup.close();
        } catch {
          /* ignore cross-origin / already-closed */
        }
      };
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        // The viewer cancelled this import (or a newer one superseded it) — stop before any further
        // poll/state write. A stale loop must never touch the shared modal state.
        if (stale()) {
          closePopup();
          return;
        }
        // The user has returned from the picker (Google autocloses on confirm). Show the destination
        // modal NOW in its preparing state, then keep polling readiness in the background.
        if (!opened && showPicker && popup.closed) openPreparingModal();
        const polled = await pollGooglePhotosImportAction(started.sessionId);
        // Re-check after the await: a Cancel can land while the poll was in flight.
        if (stale()) {
          closePopup();
          return;
        }
        if ("error" in polled) {
          closePopup();
          if (opened) setPendingDestination(null);
          setError(polled.error);
          setNote(null);
          return;
        }
        if (polled.mediaItemsSet) {
          // Google can flip mediaItemsSet before mediaItems.list is ready.
          await new Promise((r) => setTimeout(r, 500));
          ready = true;
          break;
        }
      }
      // Best-effort close if /autoclose didn't (e.g. browser treated it as a tab).
      closePopup();
      // Superseded/cancelled during the final readiness settle — drop the session untouched.
      if (stale()) return;
      if (!ready) {
        // Timed out: retract the preparing modal (if we opened one) and surface the timeout.
        if (opened) setPendingDestination(null);
        setError(hub.album.googlePhotosPickerTimedOut);
        setNote(null);
        return;
      }

      // #94 — the session is ready. A >1-family viewer picks a destination in the modal before
      // anything imports; a solo-family viewer proceeds straight through with no familyIds (the
      // server defaults to the sole family).
      if (showPicker) {
        // If the popup never reported closed (e.g. a browser treated it as a tab), the modal was
        // never opened above — open it now, already ready. Otherwise just flip the open modal from
        // preparing → ready so its Add enables (without re-seeding a selection the viewer may have
        // already adjusted while it prepared).
        if (!opened) {
          setError(null);
          setNote(null);
          setGooglePending(false);
          setSelected(seed());
          setPendingDestination({ kind: "google", sessionId: started.sessionId });
        }
        setGoogleSessionReady(true);
        return;
      }
      await runGoogleComplete(started.sessionId, []);
    } catch {
      // A superseded loop must not report its own failure over the newer run.
      if (stale()) return;
      // A hard failure (e.g. the readiness poll REJECTS) can strike after the preparing modal is
      // already open — retract it so it can't spin forever, then surface the error behind it. A
      // ready google modal has already `return`ed above, so this only ever clears a preparing one.
      setPendingDestination((prev) => (prev?.kind === "google" ? null : prev));
      setError(hub.album.googlePhotosImportFailed);
      setNote(null);
    } finally {
      // Only the current generation owns the busy flag — a superseded loop clearing it would wrongly
      // re-enable the menu behind the newer loop that now owns the flow.
      if (!stale()) setGooglePending(false);
    }
  }

  // Complete a ready Google import against a settled destination — the board handoff (F2) or the
  // batched completion action. Called directly for a solo-family viewer (from `runGoogleImport`) or
  // from the destination modal's Add for a >1-family viewer. Its own try/catch keeps a modal-driven
  // completion (which runs OUTSIDE runGoogleImport's try) from surfacing as an unhandled rejection.
  async function runGoogleComplete(sessionId: string, chosenFamilies: string[]) {
    try {
      // F2 board mode (ADR-0015): hand the session off to the board, which runs the list-first step +
      // per-item pool and owns the progress display. Clear our own pending/note so the board's tiles
      // are the single source of progress truth.
      if (onImportGoogle) {
        setNote(null);
        setGooglePending(false);
        onImportGoogle(sessionId, chosenFamilies);
        return;
      }

      setGooglePending(true);
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      for (const familyId of chosenFamilies) formData.append("familyIds", familyId);
      const completed = await completeGooglePhotosImportAction(formData);
      if ("error" in completed) {
        setError(completed.error);
        setNote(null);
        return;
      }
      setError(null);
      setNote(
        completed.failed > 0 || completed.skipped > 0
          ? hub.album.googlePhotosPartial(
              completed.added,
              completed.failed,
              completed.skipped,
            )
          : completed.added > 0
            ? hub.album.googlePhotosPartial(completed.added, 0, 0)
            : null,
      );
      setSelected(seed());
      router.refresh();
    } catch {
      setError(hub.album.googlePhotosImportFailed);
      setNote(null);
    } finally {
      setGooglePending(false);
    }
  }

  // The destination modal's Add: run the stashed payload against the chosen destination, then close.
  function onDestinationAdd() {
    const payload = pendingDestination;
    if (!payload) return;
    const chosenFamilies = [...selected];
    setPendingDestination(null);
    if (payload.kind === "upload") {
      runUpload(payload.files, chosenFamilies);
    } else {
      void runGoogleComplete(payload.sessionId, chosenFamilies);
    }
  }

  // The destination modal's Cancel (also Escape / backdrop): drop the stashed payload untouched —
  // nothing has been stored (upload/import fires only on Add), so there is zero cleanup. If a Google
  // import is still preparing (its readiness loop is running), signal it to abort so a late "ready"
  // result can't reopen the modal or fire the completion after the viewer backed out.
  function onDestinationCancel() {
    // A preparing Google import still has a loop polling in the background — bump the generation so
    // that loop goes inert (it won't reopen the modal or fire the import for the abandoned session).
    // A ready modal's loop has already exited, so the bump is a harmless no-op there.
    if (pendingDestination?.kind === "google") importGenRef.current += 1;
    setPendingDestination(null);
  }

  function onDisconnect() {
    startTransition(async () => {
      setError(null);
      setNote(null);
      // The action can REJECT (throw) at the transport level (network drop, Server Action failure)
      // rather than return an { error } shape — same hardening as onFilesChosen. Without this catch
      // the rejection is swallowed by the transition, leaving the menu stuck on "Disconnecting…" with
      // no error and no way to retry.
      let result;
      try {
        result = await disconnectGooglePhotosAction();
      } catch {
        setError(hub.album.googlePhotosDisconnectError);
        return;
      }
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Hidden file input — the "Add to album" button clicks it programmatically, so no visible
          native "choose files" control appears. The label keeps it accessibly named. */}
      {showFileUpload ? (
        <label
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          {hub.album.addLabel}
          <input
            ref={fileInputRef}
            type="file"
            name="photo"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => onFilesChosen(e.currentTarget.files)}
            tabIndex={-1}
          />
        </label>
      ) : null}

      {/* #94 — the destination modal replaces the standing "Which albums?" fieldset. It renders only
          for a >1-family viewer once a payload is stashed (files chosen / picker completed); a
          solo-family viewer never opens it. The title is count-aware for the device path (chosen-file
          count) and count-agnostic for Google import (the returned count isn't known until after the
          picker, which completes only on Add). Cancel/Escape/backdrop discard the payload untouched. */}
      {pendingDestination ? (
        <AlbumDestinationModal
          families={families}
          selected={selected}
          onToggle={toggle}
          title={
            pendingDestination.kind === "upload"
              ? hub.album.destinationTitle(pendingDestination.files.length)
              : hub.album.destinationTitleGeneric
          }
          // Google-only: hold the modal in its preparing (spinner, Add-disabled) state until the
          // picked session is confirmed ready. Device uploads have no async prep, so never preparing.
          preparing={pendingDestination.kind === "google" && !googleSessionReady}
          onAdd={onDestinationAdd}
          onCancel={onDestinationCancel}
          restoreFocusRef={addMenuTriggerRef}
        />
      ) : null}

      {/*
        #93 — the album's SINGLE right-justified entry point. Every add affordance that used to sit
        inline (device picker, Google connect/import) plus the Manage-connections Disconnect row now
        lives inside one "Add Photos ▾" dropdown, pinned to the right (marginLeft:auto inside the menu).
        The menu renders only when there is ≥1 add action available; each item is gated exactly as
        before (`showFileUpload`, `googlePhotosConfigured`, `googlePhotosConnected`) and every action
        behaves identically — this is pure consolidation.
      */}
      {showFileUpload || googlePhotosConfigured ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <AddPhotosMenu
            label={hub.album.addPhotosMenu}
            icon={
              (iconified ?? compact) ? (
                <ImagePlus size={ICON_SHEET_GLYPH_SIZE} strokeWidth={2} aria-hidden />
              ) : undefined
            }
            triggerRef={addMenuTriggerRef}
            device={
              showFileUpload
                ? {
                    label: hub.album.addFromDevice,
                    disabled: addDisabled,
                    onSelect: openPicker,
                  }
                : undefined
            }
            google={
              googlePhotosConfigured
                ? googlePhotosConnected
                  ? {
                      kind: "import",
                      label: hub.album.googlePhotosImport,
                      disabled: importDisabled,
                      onSelect: () => void runGoogleImport(),
                    }
                  : {
                      kind: "connect",
                      label: hub.album.googlePhotosConnect,
                      href: "/api/google-photos/connect",
                    }
                : undefined
            }
            manage={
              googlePhotosConfigured && googlePhotosConnected
                ? {
                    header: googlePhotosEmail ?? hub.album.googlePhotosSourceName,
                    disconnectLabel: hub.album.googlePhotosDisconnect,
                    pendingLabel: hub.album.googlePhotosDisconnecting,
                    onDisconnect,
                    pending: busy,
                  }
                : undefined
            }
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--accent-strong)",
            background: "var(--accent-soft)",
            border: "var(--border-width) solid var(--accent)",
            borderRadius: "var(--radius-md)",
            padding: "12px 16px",
            margin: 0,
            maxWidth: 480,
          }}
        >
          {error}
        </p>
      ) : null}

      {note ? (
        <p
          role="status"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            margin: 0,
          }}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
