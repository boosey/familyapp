/**
 * The narrator entry surface. Tapping the personal link opens this one full-screen page. No login,
 * no account, no install: the session token in the URL IS the identity. If the token does not
 * resolve, we fail WARMLY toward the human.
 *
 * Rendered in the Kindred Conversation kit screen: a paper card with the inviter's prompt and one
 * loud voice button.
 */
import { resolveLinkSession } from "@chronicle/capture";
import { getNarratorProfile, listPendingAsksForNarrator } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { NarratorRecorder } from "./NarratorRecorder";
import { KindredPromptCard } from "@/app/_kindred";
import { capture } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NarratorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { db } = await getRuntime();

  const resolved = await resolveLinkSession(db, token);

  if (!resolved) {
    return (
      <main className="kin-fullbleed" style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
        <h1 style={{ fontFamily: "var(--font-story)", fontSize: "var(--text-display)", fontWeight: 400, margin: 0, color: "var(--text-body)" }}>{capture.resting.welcome}</h1>
        <p style={{ maxWidth: "32ch", textAlign: "center", marginTop: 16, color: "var(--text-muted)", fontFamily: "var(--font-ui)", fontSize: "var(--text-ui)" }}>
          {capture.resting.body}
        </p>
      </main>
    );
  }

  const profile = await getNarratorProfile(db, resolved.personId);
  const spokenName = profile?.spokenName ?? "there";

  // Pull the next queued/routed Ask for this narrator. If one exists, surface it as the prompt
  // (named asker, their words) and pair the recording to it via askId so the approval write
  // can flip the Ask to `answered`.
  const pending = await listPendingAsksForNarrator(db, resolved.personId, { limit: 1 });
  const nextAsk = pending[0] ?? null;
  const initial = spokenName.charAt(0).toUpperCase();
  const now = new Date();
  const dateLabel = now.toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <main className="kin-fullbleed">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "20px 28px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "var(--support)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {initial}
        </span>
        <div>
          <div style={{ fontSize: 19, fontWeight: 600, color: "var(--text-body)" }}>{spokenName}</div>
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>{capture.narrator.conversationDate(dateLabel)}</div>
        </div>
      </header>

      <section
        style={{
          flex: 1,
          padding: "32px clamp(20px, 5vw, 56px)",
          display: "flex",
          flexDirection: "column",
          gap: 28,
          maxWidth: 720,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-story)",
            fontSize: "52px",
            fontWeight: 400,
            lineHeight: 1.06,
            letterSpacing: "-0.01em",
            color: "var(--text-body)",
            margin: 0,
          }}
        >
          {capture.narrator.hello(spokenName)}
        </h1>
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--text-ui)", margin: 0, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: "26ch" }}>
          {capture.narrator.invite}
        </p>
        <KindredPromptCard
          eyebrow={nextAsk ? capture.narrator.eyebrowAsked(nextAsk.askerSpokenName) : capture.narrator.eyebrowDefault}
          question={
            nextAsk
              ? nextAsk.ask.questionText
              : capture.narrator.starterPrompt
          }
        />
      </section>

      <footer
        style={{
          padding: "28px clamp(20px, 5vw, 56px) clamp(24px, 5vw, 48px)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <NarratorRecorder token={token} askId={nextAsk?.ask.id ?? null} />
      </footer>
    </main>
  );
}
