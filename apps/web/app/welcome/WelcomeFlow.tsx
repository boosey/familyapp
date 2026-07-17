"use client";

/**
 * Onboarding state machine (client): welcome → name → dob.
 *
 * Design rules from the handoff that this preserves:
 *  - Name and date of birth are the required asks; the rest of onboarding is optional. The name step
 *    exists because manual Clerk sign-up never collects one, so without it a Person keeps the
 *    email-prefix placeholder forever.
 *  - Voice-first but never voice-only: each voice control captures a clip via `useMicRecorder`,
 *    transcribes it server-side, and PRE-FILLS the typed field (the name input, or the DOB
 *    dropdowns via an LLM date-parse). The typed path is always available; voice is a shortcut, and
 *    a mic/transcription failure quietly falls back to typing.
 *  - The final Continue submits name + DOB in one server call; on success it routes straight into
 *    the single intake surface at /hub/about-you. The old "doors" fork (which let a user skip family
 *    creation) is gone; family creation now happens earlier via the /families/start path.
 */
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { KindredButton, KindredVoiceButton } from "@/app/_kindred";
import {
  completeAccountOnboarding,
  transcribeOnboardingName,
  transcribeOnboardingDob,
} from "./actions";
import { useMicRecorder } from "@/lib/use-mic-recorder";
import { common, welcome } from "@/app/_copy";

type Step = "welcome" | "name" | "dob";

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

  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameComplete = name.trim().length > 0;
  const dobComplete = month !== "" && day !== "" && year !== "";

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

  const voiceBusy = micPhase === "saving" || transcribing;
  // A recording/transcription in flight must block forward navigation: leaving the step mid-capture
  // orphans the MediaRecorder (its onstop would route through the NEXT step's action) — mirrors
  // AboutYouFlow, which disables its "next" control on `micPhase !== "idle" || transcribing`.
  const voiceActive = micPhase !== "idle" || transcribing;
  const voiceLabel = transcribing
    ? welcome.voiceOneMoment
    : micPhase === "listening"
      ? welcome.voiceStop
      : welcome.sayItOutLoud;
  const onVoiceClick =
    micPhase === "listening" ? finish : micPhase === "idle" && !transcribing ? startVoice : undefined;

  async function submit() {
    if (!nameComplete || !dobComplete) return;
    setBusy(true);
    setError(null);
    try {
      await completeAccountOnboarding({
        displayName: name.trim(),
        year: Number(year),
        month: Number(month),
        day: Number(day),
      });
      router.push("/hub/about-you");
    } catch {
      setError(welcome.dobSaveError);
      setBusy(false);
    }
  }

  /* ── Layout primitives ─────────────────────────────────────────────────── */
  const page: CSSProperties = {
    minHeight: "100dvh",
    background: "var(--atmosphere)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(24px, 5vw, 56px) 16px",
  };
  const card: CSSProperties = {
    maxWidth: 560,
    width: "100%",
    background: "color-mix(in srgb, var(--surface-card) 94%, transparent)",
    border: "var(--border-width) solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-lift)",
    padding: "clamp(28px, 5vw, 48px)",
    backdropFilter: "blur(10px)",
  };
  const serifHeadline: CSSProperties = {
    fontFamily: "var(--font-story)",
    fontSize: "var(--text-display)",
    fontWeight: 500,
    color: "var(--text-body)",
    margin: 0,
    lineHeight: "var(--leading-tight)",
    letterSpacing: "var(--tracking-display)",
  };
  const sub: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--text-muted)",
    lineHeight: "var(--leading-body)",
    margin: "12px 0 0",
  };
  const errorBox: CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--text-ui-sm)",
    color: "var(--accent-strong)",
    background: "var(--accent-soft)",
    border: "var(--border-width) solid var(--accent)",
    borderRadius: "var(--radius-md)",
    padding: "12px 16px",
    margin: "20px 0 0",
  };
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
      <main style={page}>
        <div style={card}>
          <div className="kin-eyebrow">{invited ? welcome.introEyebrowInvited : welcome.introEyebrowDefault}</div>
          <h1 style={{ ...serifHeadline, marginTop: 12 }}>
            {invited ? welcome.greetingInvited : welcome.greetingDefault}
          </h1>
          <p style={sub}>
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
      <main style={page}>
        <div style={card}>
          <h1 style={serifHeadline}>{welcome.nameTitle}</h1>
          <p style={sub}>{welcome.nameBody}</p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "28px 0 20px" }}>
            <KindredVoiceButton
              listening={micPhase === "listening"}
              saving={voiceBusy}
              label={voiceLabel}
              onClick={onVoiceClick}
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
      <main style={page}>
        <div style={card}>
          <h1 style={serifHeadline}>{welcome.birthdayTitle}</h1>
          <p style={sub}>
            {welcome.birthdayBody}
          </p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "28px 0 20px" }}>
            <KindredVoiceButton
              listening={micPhase === "listening"}
              saving={voiceBusy}
              label={voiceLabel}
              onClick={onVoiceClick}
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

          {error ? <p style={errorBox}>{error}</p> : null}

          <div style={{ marginTop: 28 }}>
            <KindredButton
              label={busy ? welcome.oneMoment : welcome.continue}
              size="large"
              fullWidth
              disabled={!dobComplete || busy || voiceActive}
              onClick={submit}
            />
          </div>
        </div>
      </main>
    );
  }

  // `step` is exhaustively handled above (welcome | name | dob); unreachable.
  return null;
}
