"use client";

/**
 * Onboarding state machine (client): welcome → dob → doors → interview → done.
 *
 * Design rules from the handoff that this preserves:
 *  - Date of birth is the ONE required ask; everything in the interview is optional and exitable.
 *  - Voice-first but never voice-only: every voice control is a visible STUB here (no mic in this
 *    environment) paired with a real typed path that is the actual way data is captured.
 *  - The interview can be left at any question via the always-visible "Take me to the hub" exit;
 *    whatever was answered is saved on the way out.
 */
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { KindredButton, KindredVoiceButton, KindredChip } from "@/app/_kindred";
import { saveDob, saveInterviewFacts, type InterviewFacts } from "./actions";

type Step = "welcome" | "dob" | "doors" | "interview" | "done";

interface InterviewQuestion {
  key: "birthplace" | "placesLived" | "keyMoments";
  chip: string;
  prompt: string;
  placeholder: string;
  voiceLabel: string;
}

const QUESTIONS: InterviewQuestion[] = [
  {
    key: "birthplace",
    chip: "Born in",
    prompt: "Where were you born?",
    placeholder: "e.g. Lafayette, Louisiana",
    voiceLabel: "Tap to answer",
  },
  {
    key: "placesLived",
    chip: "Lived in",
    prompt: "Where have you lived since?",
    placeholder: "e.g. New Orleans, then Houston",
    voiceLabel: "Tap to answer",
  },
  {
    key: "keyMoments",
    chip: "A moment",
    prompt: "What's one moment you'd want remembered?",
    placeholder: "e.g. The summer we drove out to the coast",
    voiceLabel: "Tap to answer",
  },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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
  fullName,
  firstName,
  invited,
  hubDestination,
}: {
  fullName: string;
  firstName: string;
  invited: boolean;
  hubDestination: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");

  // DOB
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");

  // Interview
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");

  const [busy, setBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dobComplete = month !== "" && day !== "" && year !== "";

  function showVoiceStub() {
    setVoiceNote(true);
  }

  async function submitDob() {
    if (!dobComplete) return;
    setBusy(true);
    setError(null);
    try {
      await saveDob({ year: Number(year), month: Number(month), day: Number(day) });
      setStep("doors");
    } catch {
      setError("Something went wrong saving that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function buildFacts(committed: Record<string, string>): InterviewFacts {
    return {
      birthplace: committed.birthplace || undefined,
      placesLived: committed.placesLived ? [committed.placesLived] : undefined,
      keyMoments: committed.keyMoments ? [committed.keyMoments] : undefined,
    };
  }

  /** Commit the current draft into answers and return the merged map. */
  function commitDraft(): Record<string, string> {
    const current = QUESTIONS[qIndex];
    const merged = { ...answers };
    if (current && draft.trim()) merged[current.key] = draft.trim();
    setAnswers(merged);
    return merged;
  }

  async function nextQuestion() {
    const merged = commitDraft();
    if (qIndex < QUESTIONS.length - 1) {
      const next = qIndex + 1;
      const nextQ = QUESTIONS[next];
      setQIndex(next);
      setDraft(nextQ ? (answers[nextQ.key] ?? "") : "");
      setVoiceNote(false);
      return;
    }
    // Last question — persist and land on the closing screen.
    setBusy(true);
    try {
      await saveInterviewFacts(buildFacts(merged));
      setStep("done");
    } catch {
      setError("We couldn't save your answers. You can still continue to the hub.");
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  async function exitToHub() {
    const merged = commitDraft();
    setBusy(true);
    try {
      await saveInterviewFacts(buildFacts(merged));
    } catch {
      // Best-effort save on exit; never block the user from leaving.
    } finally {
      router.push(hubDestination);
    }
  }

  /* ── Layout primitives ─────────────────────────────────────────────────── */
  const page: CSSProperties = {
    minHeight: "100dvh",
    background: "var(--surface-page)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "clamp(24px, 5vw, 56px) 16px",
  };
  const card: CSSProperties = {
    maxWidth: 560,
    width: "100%",
    background: "var(--surface-card)",
    border: "var(--border-width) solid var(--border)",
    borderRadius: "var(--radius-xl)",
    boxShadow: "var(--shadow-lift)",
    padding: "clamp(28px, 5vw, 48px)",
  };
  const serifHeadline: CSSProperties = {
    fontFamily: "var(--font-story)",
    fontSize: "var(--text-display)",
    fontWeight: 500,
    color: "var(--text-body)",
    margin: 0,
    lineHeight: "var(--leading-tight)",
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
          <div className="kin-eyebrow">{invited ? "You're invited in" : "Welcome"}</div>
          <h1 style={{ ...serifHeadline, marginTop: 12 }}>
            {invited
              ? `Welcome to the family, ${firstName}.`
              : "Welcome to Family Chronicle."}
          </h1>
          <p style={sub}>
            A couple of quick things and you&apos;ll be in. The only thing we truly need is your
            birthday — it helps us tell your stories at your pace.
          </p>
          <div style={{ marginTop: 28 }}>
            <KindredButton
              label="Let's begin"
              size="large"
              onClick={() => setStep("dob")}
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
          <h1 style={serifHeadline}>Before we go in — when were you born?</h1>
          <p style={sub}>
            This is the one thing we ask for. It shapes the questions and the pace we&apos;ll use
            with you later. Nothing else on this screen is required.
          </p>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "28px 0 20px" }}>
            <KindredVoiceButton label="Say it out loud" onClick={showVoiceStub} />
            {voiceNote ? (
              <p style={voiceHint}>Voice isn&apos;t available here yet — use the fields below.</p>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1fr", gap: 10 }}>
            <label className="kin-form-label">
              Month
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
                <option value="">Month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="kin-form-label">
              Day
              <select className="kin-field" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Day</option>
                {Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="kin-form-label">
              Year
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
                <option value="">Year</option>
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
              label={busy ? "One moment…" : "Continue"}
              size="large"
              fullWidth
              disabled={!dobComplete || busy}
              onClick={submitDob}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ── Doors (the fork) ──────────────────────────────────────────────────── */
  if (step === "doors") {
    return (
      <main style={page}>
        <div style={{ maxWidth: 720, width: "100%" }}>
          <h1 style={{ ...serifHeadline, textAlign: "center" }}>
            You&apos;re in, {firstName}. Where to first?
          </h1>
          <p style={{ ...sub, textAlign: "center", maxWidth: "46ch", margin: "12px auto 0" }}>
            You can always do the other one later — there&apos;s no wrong choice here.
          </p>

          <div
            style={{
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              marginTop: 32,
            }}
          >
            <button
              type="button"
              onClick={() => router.push(hubDestination)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                background: "var(--accent-soft)",
                border: "var(--border-width) solid var(--accent)",
                borderRadius: "var(--radius-xl)",
                boxShadow: "var(--shadow-card)",
                padding: "clamp(24px, 4vw, 36px)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  letterSpacing: "var(--tracking-mono)",
                  color: "var(--accent-strong)",
                }}
              >
                PRIMARY
              </div>
              <div style={{ ...serifHeadline, fontSize: "var(--text-story-lg)", margin: "10px 0 8px" }}>
                Go to the hub
              </div>
              <div style={{ ...sub, margin: 0 }}>
                See your family&apos;s stories and start asking questions right away.
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("interview");
                setQIndex(0);
                setDraft(answers.birthplace ?? "");
                setVoiceNote(false);
              }}
              style={{
                textAlign: "left",
                cursor: "pointer",
                background: "var(--surface-card)",
                border: "var(--border-width) solid var(--border-strong)",
                borderRadius: "var(--radius-xl)",
                boxShadow: "var(--shadow-card)",
                padding: "clamp(24px, 4vw, 36px)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-label)",
                  letterSpacing: "var(--tracking-mono)",
                  color: "var(--support)",
                }}
              >
                ABOUT 12 MINUTES
              </div>
              <div style={{ ...serifHeadline, fontSize: "var(--text-story-lg)", margin: "10px 0 8px" }}>
                Tell your story
              </div>
              <div style={{ ...sub, margin: 0 }}>
                Answer a few gentle questions so your family has something to ask you about.
              </div>
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ── Interview ─────────────────────────────────────────────────────────── */
  if (step === "interview") {
    const q = QUESTIONS[qIndex];
    if (!q) return null; // qIndex is always in-bounds by construction; defensive for the type-checker.
    const isLast = qIndex === QUESTIONS.length - 1;

    // Captured-facts ribbon: Name ✓, Born ✓, then each interview fact (✓ done · ● current · pending).
    const ribbon: { label: string; mark: string }[] = [
      { label: fullName.split(" ")[0] ?? fullName, mark: "✓" },
      { label: "Born", mark: "✓" },
      ...QUESTIONS.map((item, i) => {
        const done = Boolean(answers[item.key]) && i < qIndex;
        const current = i === qIndex;
        return { label: item.chip, mark: done ? "✓" : current ? "●" : "·" };
      }),
    ];

    return (
      <main style={{ ...page, justifyContent: "flex-start", paddingTop: "clamp(20px, 4vw, 40px)" }}>
        <div style={{ maxWidth: 620, width: "100%" }}>
          {/* Top bar: ribbon + exit */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 36,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ribbon.map((c, i) => (
                <KindredChip key={i} kind="status" label={`${c.label} ${c.mark}`} />
              ))}
            </div>
            <KindredButton
              label="Take me to the hub →"
              variant="ghost"
              size="small"
              onClick={exitToHub}
            />
          </div>

          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-label)",
              letterSpacing: "var(--tracking-mono)",
              color: "var(--support)",
              margin: "0 0 12px",
            }}
          >
            QUESTION {qIndex + 1} OF {QUESTIONS.length}
          </p>
          <h1 style={{ ...serifHeadline, fontSize: "var(--text-prompt)" }}>{q.prompt}</h1>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "32px 0 20px" }}>
            <KindredVoiceButton label={q.voiceLabel} onClick={showVoiceStub} />
            {voiceNote ? (
              <p style={voiceHint}>Voice isn&apos;t available here yet — type your answer below.</p>
            ) : null}
          </div>

          <label className="kin-form-label">
            Type instead
            <textarea
              className="kin-field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={q.placeholder}
              style={{ minHeight: 96 }}
            />
          </label>

          {error ? <p style={errorBox}>{error}</p> : null}

          <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
            <KindredButton
              label={isLast ? (busy ? "Saving…" : "Finish") : "Next"}
              size="large"
              disabled={busy}
              onClick={nextQuestion}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ── Done ──────────────────────────────────────────────────────────────── */
  return (
    <main style={page}>
      <div style={{ ...card, textAlign: "center" }}>
        <div className="kin-eyebrow">Thank you</div>
        <h1 style={{ ...serifHeadline, marginTop: 12 }}>That&apos;s a beautiful start.</h1>
        <p style={{ ...sub, maxWidth: "42ch", margin: "12px auto 0" }}>
          Your family will see these and have something to ask you about. There&apos;s always more
          to tell whenever you&apos;re ready.
        </p>
        {error ? <p style={errorBox}>{error}</p> : null}
        <div style={{ marginTop: 28 }}>
          <KindredButton
            label="Take me to the hub"
            size="large"
            onClick={() => router.push(hubDestination)}
          />
        </div>
      </div>
    </main>
  );
}
