"use client";

/**
 * Intake surface (client) — a short structured walk through the biographical profile, ONE question
 * at a time. Modeled on /welcome's retired interview step.
 *
 * Design rules this preserves:
 *  - One open question at a time; question text is rendered VERBATIM (already written warm — no
 *    per-question LLM phrasing on this surface).
 *  - Voice-first but never voice-only: the voice control is a visible STUB (no mic here) paired with
 *    a real typed path that is the actual way answers are captured.
 *  - Exit anytime via the always-visible "Take me to the hub" control; the current draft is saved
 *    on the way out (best-effort).
 *
 * This component receives ONLY plain data (question {key,text}, strings). It must NOT import from
 * @chronicle/interviewer — that index transitively pulls core-adapters → db, which cannot be in a
 * client bundle. The next question is always computed server-side by `submitIntakeAnswer`, which
 * makes the turn loop's in-session `askedIntakeKeys` stateless across HTTP.
 */
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { KindredButton, KindredVoiceButton } from "@/app/_kindred";
import { hub } from "@/app/_copy";
import { submitIntakeAnswer, type NextQuestion } from "./actions";

export function AboutYouFlow({
  initialQuestion,
  hubHref,
}: {
  initialQuestion: NextQuestion;
  hubHref: string;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<NextQuestion | null>(initialQuestion);
  const [askedKeys, setAskedKeys] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function next() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    const answeredKey = current.key;
    try {
      const result = await submitIntakeAnswer(askedKeys, answeredKey, draft);
      setAskedKeys((prev) => [...prev, answeredKey]);
      setDraft("");
      setVoiceNote(false);
      if (result.nextQuestion) {
        setCurrent(result.nextQuestion);
      } else {
        // Intake complete — show a brief thank-you, then land on the hub.
        setCurrent(null);
        setDone(true);
        router.push(hubHref);
      }
    } catch {
      setError(hub.aboutYou.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function exitToHub() {
    if (busy) {
      router.push(hubHref);
      return;
    }
    // Save the current draft first (best-effort), then leave — same pattern as the old WelcomeFlow.
    if (current && draft.trim()) {
      setBusy(true);
      try {
        await submitIntakeAnswer(askedKeys, current.key, draft);
      } catch {
        // Best-effort save on exit; never block the user from leaving.
      }
    }
    router.push(hubHref);
  }

  /* ── Layout primitives (mirrors WelcomeFlow) ───────────────────────────── */
  const page: CSSProperties = {
    minHeight: "100dvh",
    background: "var(--surface-page)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "clamp(24px, 5vw, 56px)",
    paddingBottom: "clamp(24px, 5vw, 56px)",
    paddingLeft: 16,
    paddingRight: 16,
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
  const monoEyebrow: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-label)",
    letterSpacing: "var(--tracking-mono)",
    color: "var(--support)",
    margin: "0 0 12px",
  };

  /* ── Done (brief thank-you while routing to the hub) ───────────────────── */
  if (done || !current) {
    return (
      <main style={page}>
        <div style={{ ...card, textAlign: "center" }}>
          <div className="kin-eyebrow">{hub.aboutYou.doneEyebrow}</div>
          <h1 style={{ ...serifHeadline, marginTop: 12 }}>{hub.aboutYou.doneTitle}</h1>
          <p style={{ ...sub, maxWidth: "42ch", margin: "12px auto 0" }}>{hub.aboutYou.doneBody}</p>
          {/* Fallback control: we router.push to the hub on completion, but if that navigation
              stalls the user must not be stranded on a buttonless card. */}
          <Link
            href={hubHref}
            style={{
              display: "inline-block",
              marginTop: 24,
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-ui-sm)",
              fontWeight: 600,
              color: "var(--accent-strong)",
              textDecoration: "none",
            }}
          >
            {hub.aboutYou.takeMeToHub}
          </Link>
        </div>
      </main>
    );
  }

  /* ── Question ──────────────────────────────────────────────────────────── */
  return (
    <main style={{ ...page, justifyContent: "flex-start", paddingTop: "clamp(20px, 4vw, 40px)" }}>
      <div style={{ maxWidth: 620, width: "100%" }}>
        {/* Top bar: eyebrow + exit */}
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
          <div className="kin-eyebrow">{hub.aboutYou.eyebrow}</div>
          <KindredButton
            label={hub.aboutYou.takeMeToHub}
            variant="ghost"
            size="small"
            onClick={exitToHub}
          />
        </div>

        <p style={monoEyebrow}>{hub.aboutYou.progress}</p>
        <h1 style={{ ...serifHeadline, fontSize: "var(--text-prompt)" }}>{current.text}</h1>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "32px 0 20px" }}>
          <KindredVoiceButton label={hub.aboutYou.voiceLabel} onClick={() => setVoiceNote(true)} />
          {voiceNote ? <p style={voiceHint}>{hub.aboutYou.voiceUnavailable}</p> : null}
        </div>

        <label className="kin-form-label">
          {hub.aboutYou.typeInstead}
          <textarea
            className="kin-field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ minHeight: 96 }}
          />
        </label>

        {error ? <p style={errorBox}>{error}</p> : null}

        <div style={{ display: "flex", gap: 12, marginTop: 24, justifyContent: "flex-end" }}>
          <KindredButton
            label={busy ? hub.aboutYou.saving : hub.aboutYou.next}
            size="large"
            disabled={busy}
            onClick={next}
          />
        </div>
      </div>
    </main>
  );
}
