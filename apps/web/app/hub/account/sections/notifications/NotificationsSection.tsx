"use client";

/**
 * Account › Notifications (#280) — the settings surface for the three Person-global notification
 * streams. Unlike the device-local Appearance controls, these choices SYNC to the account (persisted
 * via notificationStreamPrefs), not device-local. Relocated from /hub/settings.
 *
 * Prefs get/set live in `@/lib/notification-prefs` (`server-only`); this client module must not
 * import `@chronicle/core`.
 *
 * The UI only ever offers every_item|off — digest cadences aren't built yet (see actions.ts), so
 * this control never renders daily_digest/weekly_digest even though the DB type allows them.
 */
import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { NotificationFrequency, NotificationStream } from "@chronicle/db";
import { SegmentedControl } from "@/app/_kindred/SegmentedControl";
import { notificationsCopy } from "./copy";
import { saveNotificationStreamFrequencyAction } from "./actions";

const NOTIFICATION_STREAMS = [
  "questions_for_me",
  "answers_to_my_asks",
  "family_activity",
] as const satisfies readonly NotificationStream[];

type SaveState = "idle" | "saving" | "saved" | "error";

// The control only offers these two options; anything else stored for a stream (e.g. a digest
// cadence from a future release) collapses to "every_item" for display purposes below.
type UiFrequency = "every_item" | "off";

export interface NotificationsSectionProps {
  initialFrequencies: Record<NotificationStream, NotificationFrequency>;
}

// Any stored frequency other than "off" (including digest cadences the UI doesn't offer yet)
// displays as "every_item" here — the control has no digest option, so there's nothing else to show.
function toUiFrequency(frequency: NotificationFrequency): UiFrequency {
  return frequency === "off" ? "off" : "every_item";
}

export function NotificationsSection({ initialFrequencies }: NotificationsSectionProps) {
  const [frequencies, setFrequencies] = useState<Record<NotificationStream, UiFrequency>>(() => {
    const initial = {} as Record<NotificationStream, UiFrequency>;
    for (const stream of NOTIFICATION_STREAMS) {
      initial[stream] = toUiFrequency(initialFrequencies[stream]);
    }
    return initial;
  });
  const [saveState, setSaveState] = useState<Partial<Record<NotificationStream, SaveState>>>({});
  const savingRef = useRef<Set<NotificationStream>>(new Set());

  const mark = useCallback((stream: NotificationStream, state: SaveState) => {
    setSaveState((s) => ({ ...s, [stream]: state }));
    if (state === "saved") {
      window.setTimeout(() => {
        setSaveState((s) => (s[stream] === "saved" ? { ...s, [stream]: "idle" } : s));
      }, 2000);
    }
  }, []);

  const handleSelect = useCallback(
    async (stream: NotificationStream, next: UiFrequency) => {
      if (savingRef.current.has(stream)) return;
      const previous = frequencies[stream];
      if (previous === next) return;
      savingRef.current.add(stream);
      setFrequencies((f) => ({ ...f, [stream]: next }));
      mark(stream, "saving");
      const result = await saveNotificationStreamFrequencyAction(stream, next);
      if ("ok" in result) {
        mark(stream, "saved");
      } else {
        setFrequencies((f) => ({ ...f, [stream]: previous }));
        mark(stream, "error");
      }
      savingRef.current.delete(stream);
    },
    [frequencies, mark],
  );

  function hint(stream: NotificationStream) {
    const state = saveState[stream];
    if (state === "saving") return notificationsCopy.notificationsSaving;
    if (state === "saved") return notificationsCopy.notificationsSaved;
    if (state === "error") return notificationsCopy.notificationsSaveError;
    return null;
  }

  return (
    <section aria-labelledby="account-notifications">
      <h2 id="account-notifications" style={sectionTitle}>
        {notificationsCopy.notificationsHeading}
      </h2>
      <p style={sectionIntro}>{notificationsCopy.notificationsIntro}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {NOTIFICATION_STREAMS.map((stream) => {
          const streamLabel = notificationsCopy.streamLabels[stream];
          const hintText = hint(stream);
          return (
            <div key={stream}>
              <span style={streamLabelStyle}>{streamLabel}</span>
              <SegmentedControl
                ariaLabel={notificationsCopy.streamFrequencyAria(streamLabel)}
                items={[
                  { key: "every_item", label: notificationsCopy.frequencyEveryItem },
                  { key: "off", label: notificationsCopy.frequencyOff },
                ]}
                active={frequencies[stream]}
                onSelect={(key) => void handleSelect(stream, key as UiFrequency)}
                variant="radio"
              />
              {hintText ? (
                <span
                  style={{
                    ...hintStyle,
                    color:
                      saveState[stream] === "error" ? "var(--accent-strong)" : "var(--text-muted)",
                  }}
                >
                  {hintText}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story-lg)",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const sectionIntro: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: "0 0 16px",
  lineHeight: "var(--leading-snug)",
};

const streamLabelStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-body)",
  display: "block",
  marginBottom: 6,
};

const hintStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--text-label)",
  marginTop: 4,
  display: "block",
};
