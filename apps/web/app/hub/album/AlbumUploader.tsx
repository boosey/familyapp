"use client";

/**
 * Album upload control (ADR-0009 · #15 · #16). A single "Add to album" button that opens the OS file
 * picker directly (the file input itself is hidden — no visible "choose files" control) and uploads
 * the chosen files the moment the picker closes. It calls the `uploadAlbumPhotoAction` server action
 * (which re-resolves auth and re-validates the target albums server-side — the client passes only the
 * files + its picker choice). On success it refreshes the server component so the new tiles appear; on
 * failure it surfaces the action's error string. The control sits ABOVE the album grid.
 *
 * Multi-select (#16): the hidden file input carries `multiple`, so the OS picker lets the contributor
 * choose MANY photos at once. Each selected file is appended as its own `photo` entry on the FormData,
 * which the action reads via `getAll("photo")` — each becomes its own album photo placed into the SAME
 * chosen album(s). The action returns a batch summary (`added`/`failed`); a partial success (some files
 * failed) surfaces a gentle inline note rather than an error.
 *
 * #16 — multi-family placement: a contributor in >=2 families sees a checkbox per family and chooses
 * which albums receive the batch BEFORE opening the picker. The default pre-selection is the album
 * currently on screen (`currentFamilyId`), pre-checked but deselectable; at least one must stay
 * selected (the button is disabled otherwise). A solo-family contributor sees NO checkboxes — the
 * server defaults to the sole family (behavior unchanged).
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pickerUriForWeb } from "@chronicle/photos-google/picker";
import { uploadAlbumPhotoAction } from "./actions";
import {
  completeGooglePhotosImportAction,
  disconnectGooglePhotosAction,
  pollGooglePhotosImportAction,
  startGooglePhotosImportAction,
} from "./google-photos-actions";
import { prepareAlbumPhoto } from "./prepare-photo";
import { KindredButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { FamilyPicker } from "../FamilyPicker";
import { ManageConnectionsMenu } from "./ManageConnectionsMenu";
import { seedComposeFamilies } from "@/lib/compose-scope";

export interface AlbumFamilyOption {
  familyId: string;
  familyName: string;
}

/** Most photos per batch — kept in sync with the server's MAX_BATCH_FILES (the server is authoritative). */
const MAX_BATCH_FILES = 30;

/** Fallback poll timing when Google omits pollingConfig on the session. */
const PICKER_POLL_TIMEOUT_MS = 5 * 60 * 1000;
const PICKER_POLL_INTERVAL_MS = 2000;

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
  showFileUpload = true,
  googlePhotosConfigured = false,
  googlePhotosConnected = false,
  googlePhotosEmail = null,
  googlePhotosOauthConnected = false,
  googlePhotosOauthError = null,
}: {
  families: AlbumFamilyOption[];
  currentFamilyId: string;
  /**
   * The hub's `?scope=` signal ("all" | a family id). When it names a concrete family the viewer is
   * in, the default selection follows it (consistency with the ask picker); otherwise ("all" or
   * absent) the default falls back to the current album on screen.
   */
  scope?: string | null;
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
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A gentle, non-error note after a partial-success batch (some files landed, some didn't).
  const [note, setNote] = useState<string | null>(null);
  const oauthFlashHandled = useRef(false);

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
  const seed = () => {
    if (scope && scope !== "all") {
      const s = seedComposeFamilies(scope, familyIds);
      if (s.size > 0) return s;
    }
    return new Set([currentFamilyId]);
  };
  const [selected, setSelected] = useState<Set<string>>(seed);
  // The family switcher (and a scope change) is a same-route soft navigation, so this component is
  // NOT remounted — only its props change. Re-seed the picker whenever EITHER the scope or the
  // current-context family changes (the "adjust state during render on a prop change" pattern), so
  // the default always tracks the current signal. An in-progress selection is left untouched while
  // both stay the same (the key comparison guards that).
  const [prevKey, setPrevKey] = useState(`${scope ?? ""}|${currentFamilyId}`);
  const key = `${scope ?? ""}|${currentFamilyId}`;
  if (prevKey !== key) {
    setPrevKey(key);
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

  // Upload the files the OS picker just handed back. Triggered by the hidden input's change event —
  // there is no separate submit step; choosing files IS the upload.
  function onFilesChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Guard the obvious mistake client-side (fast, friendly) before spending an upload; the server
    // re-checks the same cap and is authoritative.
    if (files.length > MAX_BATCH_FILES) {
      setError(hub.actions.tooManyPhotos);
      setNote(null);
      return;
    }
    const selectedFiles = Array.from(files);
    startTransition(async () => {
      // Downscale oversized phone photos so they fit under Vercel's ~4.5 MB request body limit.
      const prepared: File[] = [];
      for (const file of selectedFiles) {
        const result = await prepareAlbumPhoto(file);
        if (!result.ok) {
          setError(
            result.error === "heic_unsupported"
              ? hub.actions.photoHeicUnsupported
              : result.error === "too_large"
                ? hub.actions.photoTooLarge
                : hub.actions.photoEncodeFailed,
          );
          setNote(null);
          return;
        }
        prepared.push(result.file);
      }

      // Build the payload explicitly: one `photo` entry per file (the action reads getAll("photo")),
      // plus the chosen albums when the multi-family picker is shown (a solo contributor sends none and
      // the server defaults to their sole family).
      const formData = new FormData();
      for (const file of prepared) formData.append("photo", file);
      if (showPicker) {
        for (const familyId of selected) formData.append("familyIds", familyId);
      }
      // The action can REJECT (throw) rather than return an error shape — most notably when the
      // request body exceeds the Server Action / platform size limit. Without this catch that
      // rejection is swallowed by the transition and the upload silently does nothing; surface a
      // clear, actionable message instead.
      let result;
      try {
        result = await uploadAlbumPhotoAction(formData);
      } catch {
        setError(hub.album.uploadError);
        setNote(null);
        return;
      }
      if ("error" in result) {
        setError(result.error);
        setNote(null);
        return;
      }
      setError(null);
      // A partial success (batch had ≥1 failure) is not an error — surface a soft note so the
      // contributor knows exactly what landed and can retry the rest.
      setNote(
        result.failed > 0
          ? hub.album.photosPartial(result.added, result.failed)
          : null,
      );
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

  // >=1 album must stay selected when the picker is shown, and never while an upload is in flight.
  const busy = pending || googlePending;
  const addDisabled = busy || (showPicker && selected.size === 0);
  const importDisabled =
    busy || (families.length > 1 && selected.size === 0);

  async function runGoogleImport() {
    setError(null);
    setNote(hub.album.googlePhotosImporting);
    setGooglePending(true);
    try {
      const started = await startGooglePhotosImportAction();
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
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const polled = await pollGooglePhotosImportAction(started.sessionId);
        if ("error" in polled) {
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
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore cross-origin / already-closed */
      }
      if (!ready) {
        setError(hub.album.googlePhotosPickerTimedOut);
        setNote(null);
        return;
      }

      const formData = new FormData();
      formData.append("sessionId", started.sessionId);
      if (showPicker) {
        for (const familyId of selected) formData.append("familyIds", familyId);
      }
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
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

      {showPicker ? (
        <fieldset
          style={{
            border: "var(--border-width) solid var(--border)",
            borderRadius: 8,
            padding: "12px 14px",
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <legend
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              color: "var(--text-meta)",
              padding: "0 6px",
            }}
          >
            {hub.album.chooseAlbums}
          </legend>
          <FamilyPicker
            families={families}
            selected={selected}
            onToggle={toggle}
            disabled={busy}
          />
        </fieldset>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {showFileUpload ? (
          <KindredButton
            type="button"
            variant="primary"
            size="small"
            disabled={addDisabled}
            onClick={openPicker}
            style={{ alignSelf: "flex-start" }}
          >
            {hub.album.addButton}
          </KindredButton>
        ) : null}

        {googlePhotosConfigured && !googlePhotosConnected ? (
          <a
            href="/api/google-photos/connect"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
              padding: "10px 4px",
            }}
          >
            {hub.album.googlePhotosConnect}
          </a>
        ) : null}

        {googlePhotosConfigured && googlePhotosConnected ? (
          <>
            <KindredButton
              type="button"
              variant="secondary"
              size="small"
              disabled={importDisabled}
              onClick={() => void runGoogleImport()}
            >
              {hub.album.googlePhotosImport}
            </KindredButton>
            <ManageConnectionsMenu
              label={hub.album.manageConnections}
              connections={[
                {
                  id: "google-photos",
                  header: googlePhotosEmail ?? hub.album.googlePhotosSourceName,
                  disconnectLabel: hub.album.googlePhotosDisconnect,
                  pendingLabel: hub.album.googlePhotosDisconnecting,
                  onDisconnect,
                  pending: busy,
                },
              ]}
            />
          </>
        ) : null}
      </div>

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
