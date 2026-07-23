"use client";

/**
 * Onboarding state machine (client): welcome → name → dob → phone (optional SMS opt-in).
 *
 * Design rules from the handoff that this preserves:
 *  - Name and date of birth are the required asks; phone/SMS consent is optional. The name step
 *    exists because manual Clerk sign-up never collects one, so without it a Person keeps the
 *    email-prefix placeholder forever.
 *  - Voice-first but never voice-only: each voice control captures a clip via `useMicRecorder`,
 *    transcribes it server-side, and PRE-FILLS the typed field (the name input, or the DOB
 *    dropdowns via an LLM date-parse). The typed path is always available; voice is a shortcut, and
 *    a mic/transcription failure quietly falls back to typing.
 *  - The final Continue (or Skip on the phone step) submits name + DOB (+ optional SMS opt-in) in
 *    one server call; on success it routes straight into the single intake surface at
 *    /hub/about-you. The old "doors" fork (which let a user skip family creation) is gone; family
 *    creation now happens earlier via the /families/start path.
 */
import { useState, useRef, useCallback, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KindredButton, KindredVoiceButton } from "@/app/_kindred";
import {
  completeAccountOnboarding,
  transcribeOnboardingName,
  transcribeOnboardingDob,
} from "./actions";
import { useMicRecorder } from "@/lib/use-mic-recorder";
import { useRecordingGesture } from "@/app/_kindred/useRecordingGesture";
import { common, welcome } from "@/app/_copy";
import styles from "@/app/_onboarding/onboarding-card.module.css";

type Step = "welcome" | "name" | "dob" | "phone";

const NOW_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 120 }, (_, i) => NOW_YEAR - i);

/**
 * Days in a given month (1-12), leap-year aware. Pure date-picker affordance — it keeps the day
 * dropdown from offering impossible days (e.g. Feb 31). The authoritative validation still lives in
 * core's completeOnboarding; this just prevents the user from selecting a date it would reject.
 * When the year isn't chosen yet we assume a leap year so Feb shows 29 (never hides a valid day).
 */
function daysInMonth(monthStr: string, yearStr: string): number {
  if (monthStr === "") return 31;
  const month = Number(monthStr);
  const year = yearStr === "" ? 2000 : Number(yearStr);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function WelcomeFlow({
  initialName,
  invited,
}: {
  initialName: string;
  invited: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");

  // Name — pre-filled from a real Clerk name, or blank when the stored name was the email-prefix
  // fallback (see initialOnboardingName). This is the required identity the whole fix hinges on.
  const [name, setName] = useState(initialName);

  // DOB
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");

  // Optional phone + SMS consent (Twilio TFV — recipient opt-in at account setup)
  const [phone, setPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameComplete = name.trim().length > 0;
  const dobComplete = month !== "" && day !== "" && year !== "";
  const hasPhone = phone.trim().length > 0;
  const phoneStepReady = !hasPhone || smsConsent;

  // Fill the DOB dropdowns from a parsed spoken date — only the fields the speaker clearly stated,
  // and only a day that fits the (possibly just-spoken) month/year. Reads month/year from the parse
  // result directly (not the not-yet-committed state) so a same-utterance "March 3rd 1952" lands.
  function applySpokenDate(d: { year: number | null; month: number | null; day: number | null }) {
    const m = d.month != null ? String(d.month) : month;
    const y = d.year != null ? String(d.year) : year;
    if (d.month != null) setMonth(m);
    if (d.year != null) setYear(y);
    if (d.day != null) {
      // A spoken day that doesn't fit the (possibly just-spoken) month clears rather than persists a
      // wrong value ("the 31st of February").
      setDay(d.day <= daysInMonth(m, y) ? String(d.day) : "");
    } else if (day !== "" && Number(day) > daysInMonth(m, y)) {
      // A partial spoken correction (month/year only) can strand a previously-picked day out of range
      // — clear it, exactly as the typed-path <select> handlers do below.
      setDay("");
    }
  }

  // One recorder for both steps: onRecorded branches on the CURRENT step (the hook reads the latest
  // callback via its optsRef, so this closure's `step` is always current at stop time).
  const { phase: micPhase, start, finish } = useMicRecorder({
    onRecorded: async (blob) => {
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("audio", blob, "onboarding.webm");
        if (step === "name") {
          const { name: spoken } = await transcribeOnboardingName(form);
          if (spoken) setName(spoken);
          else setMicError(true);
        } else {
          const d = await transcribeOnboardingDob(form);
          if (d.year != null || d.month != null || d.day != null) applySpokenDate(d);
          else setMicError(true);
        }
      } catch {
        setMicError(true);
      } finally {
        setTranscribing(false);
      }
    },
    onError: () => setMicError(true),
  });

  function goToStep(next: Step) {
    setMicError(false);
    setStep(next);
  }

  // Start a fresh recording, clearing any prior mic error first.
  function startVoice() {
    setMicError(false);
    void start();
  }

  const { holdToRecord } = useRecordingGesture();
  const heldRef = useRef(false);
  const onHoldStart = useCallback(async () => {
    if (micPhase !== "idle" || transcribing) return;
    heldRef.current = true;
    setMicError(false);
    await start();
    // Released before the mic was ready → stop immediately (finish is idempotent if start failed).
    if (!heldRef.current) finish();
  }, [micPhase, transcribing, start, finish]);
  const onHoldEnd = useCallback(() => {
    heldRef.current = false;
    if (micPhase === "listening") finish();
  }, [micPhase, finish]);

  const voiceBusy = micPhase === "saving" || transcribing;
  // A recording/transcription in flight must block forward navigation: leaving the step mid-capture
  // orphans the MediaRecorder (its onstop would route through the NEXT step's action) — mirrors
  // AboutYouFlow, which disables its "next" control on `micPhase !== "idle" || transcribing`.
  const voiceActive = micPhase !== "idle" || transcribing;
  const voiceLabel = transcribing
    ? welcome.voiceOneMoment
    : holdToRecord
      ? micPhase === "listening"
        ? common.voiceButton.releaseToFinish
        : common.voiceButton.holdToSpeak
      : micPhase === "listening"
        ? welcome.voiceStop
        : welcome.sayItOutLoud;
  const onVoiceClick =
    micPhase === "listening" ? finish : micPhase === "idle" && !transcribing ? startVoice : undefined;

  async function submit(opts: { includePhone: boolean }) {
    if (!nameComplete || !dobComplete) return;
    if (opts.includePhone && hasPhone && !smsConsent) return;
    setBusy(true);
    setError(null);
    try {
      await completeAccountOnboarding({
        displayName: name.trim(),
        year: Number(year),
        month: Number(month),
        day: Number(day),
        ...(opts.includePhone && hasPhone
          ? { phone: phone.trim(), smsConsent: true }
          : {}),
      });
      router.push("/hub/about-you");
    } catch (err) {
      const message = err instanceof Error ? err.message : welcome.dobSaveError;
      setError(message);
      setBusy(false);
    }
  }

  /* ── Layout primitives ─────────────────────────────────────────────────── */
  // page/card/headline/sub/errorBox moved to _onboarding/onboarding-card.module.css (classes carry
  // the Scrapbook signature; inline styles would out-specify [data-skin]). The serif headline keeps its
  // per-step font-size as an inline override on top of the module's .headline. voiceHint stays inline
  // (not part of the signature).
  const voiceHint: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-label)",
    color: "var(--text-muted)",
    textAlign: "center",
    margin: "10px 0 0",
  };

  /* ── Welcome ───────────────────────────────────────────────────────────── */
  if (step === "welcome") {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <div className={styles.eyebrow}>{invited ? welcome.introEyebrowInvited : welcome.introEyebrowDefault}</div>
          <h1 className={styles.headline} style={{ fontSize: "var(--text-display)", marginTop: 12 }}>
            {invited ? welcome.greetingInvited : welcome.greetingDefault}
          </h1>
          <p className={styles.sub}>
            {welcome.introBody}
          </p>
          <div style={{ marginTop: 28 }}>
            <KindredButton
              label={welcome.begin}
              size="large"
              onClick={() => goToStep("name")}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ── Name (asked before DOB — guarantees a real, user-entered name) ──────── */
  if (step === "name") {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.headline} style={{ fontSize: "var(--text-display)" }}>{welcome.nameTitle}</h1>
          <p className={styles.sub}>{welcome.nameBody}</p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "28px 0 20px" }}>
            <KindredVoiceButton
              listening={micPhase === "listening"}
              saving={voiceBusy}
              label={voiceLabel}
              holdToRecord={holdToRecord}
              onHoldStart={holdToRecord ? onHoldStart : undefined}
              onHoldEnd={holdToRecord ? onHoldEnd : undefined}
              onClick={holdToRecord ? undefined : onVoiceClick}
            />
            {micError ? (
              <p style={voiceHint}>{welcome.voiceError}</p>
            ) : null}
          </div>

          <label className="kin-form-label">
            {welcome.nameLabel}
            <input
              type="text"
              className="kin-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={welcome.namePlaceholder}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameComplete && !voiceActive) goToStep("dob");
              }}
            />
          </label>

          <div style={{ marginTop: 28 }}>
            <KindredButton
              label={welcome.continue}
              size="large"
              fullWidth
              disabled={!nameComplete || voiceActive}
              onClick={() => goToStep("dob")}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ── DOB (the one required step) ───────────────────────────────────────── */
  if (step === "dob") {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.headline} style={{ fontSize: "var(--text-display)" }}>{welcome.birthdayTitle}</h1>
          <p className={styles.sub}>
            {welcome.birthdayBody}
          </p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "28px 0 20px" }}>
            <KindredVoiceButton
              listening={micPhase === "listening"}
              saving={voiceBusy}
              label={voiceLabel}
              holdToRecord={holdToRecord}
              onHoldStart={holdToRecord ? onHoldStart : undefined}
              onHoldEnd={holdToRecord ? onHoldEnd : undefined}
              onClick={holdToRecord ? undefined : onVoiceClick}
            />
            {micError ? (
              <p style={voiceHint}>{welcome.voiceError}</p>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1fr", gap: 10 }}>
            <label className="kin-form-label">
              {welcome.monthLabel}
              <select
                className="kin-field"
                value={month}
                onChange={(e) => {
                  const m = e.target.value;
                  setMonth(m);
                  // Drop an out-of-range day if the new month is shorter (e.g. 31 → Feb).
                  if (day !== "" && Number(day) > daysInMonth(m, year)) setDay("");
                }}
              >
                <option value="">{welcome.monthLabel}</option>
                {common.months.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="kin-form-label">
              {welcome.dayLabel}
              <select className="kin-field" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">{welcome.dayLabel}</option>
                {Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="kin-form-label">
              {welcome.yearLabel}
              <select
                className="kin-field"
                value={year}
                onChange={(e) => {
                  const y = e.target.value;
                  setYear(y);
                  // Re-clamp for the Feb-29 leap-year case once a concrete year is known.
                  if (day !== "" && Number(day) > daysInMonth(month, y)) setDay("");
                }}
              >
                <option value="">{welcome.yearLabel}</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? <p className={styles.errorBox}>{error}</p> : null}

          <div style={{ marginTop: 28 }}>
            <KindredButton
              label={welcome.continue}
              size="large"
              fullWidth
              disabled={!dobComplete || busy || voiceActive}
              onClick={() => goToStep("phone")}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ── Phone (optional SMS opt-in — Twilio TFV / TCPA recipient consent) ──── */
  if (step === "phone") {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.headline} style={{ fontSize: "var(--text-display)" }}>{welcome.phoneTitle}</h1>
          <p className={styles.sub}>{welcome.phoneBody}</p>

          <label className="kin-form-label" style={{ marginTop: 24 }}>
            {welcome.phoneLabel}
            <input
              type="tel"
              className="kin-field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={welcome.phonePlaceholder}
              autoFocus
              data-testid="welcome-phone"
            />
          </label>

          {hasPhone ? (
            <label
              className="kin-form-label"
              style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 16, cursor: "pointer" }}
              data-testid="welcome-sms-consent"
            >
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={(e) => setSmsConsent(e.target.checked)}
                style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }}
                data-testid="welcome-sms-consent-checkbox"
              />
              <span style={{ fontSize: "var(--text-ui-sm)", lineHeight: 1.45, fontWeight: 400 }}>
                {welcome.smsConsentLabel}{" "}
                <Link
                  href="/privacy"
                  style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 2 }}
                  aria-label={welcome.smsConsentPrivacyAria}
                >
                  {welcome.smsConsentPrivacyLink}
                </Link>
              </span>
            </label>
          ) : null}

          {error ? <p className={styles.errorBox}>{error}</p> : null}

          <div style={{ marginTop: 28, display: "grid", gap: 10 }}>
            <KindredButton
              label={busy ? welcome.oneMoment : hasPhone ? welcome.continue : welcome.phoneSkip}
              size="large"
              fullWidth
              disabled={!phoneStepReady || busy}
              onClick={() => void submit({ includePhone: hasPhone })}
              data-testid="welcome-phone-continue"
            />
            {hasPhone ? (
              <KindredButton
                label={welcome.phoneSkip}
                size="large"
                fullWidth
                variant="ghost"
                disabled={busy}
                onClick={() => void submit({ includePhone: false })}
                data-testid="welcome-phone-skip"
              />
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  // `step` is exhaustively handled above (welcome | name | dob | phone); unreachable.
  return null;
}
