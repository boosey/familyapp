/**
 * The elder entry surface. Tapping the personal link opens this one full-screen page. No login,
 * no account, no install: the session token in the URL IS the identity. If the token does not
 * resolve, we fail WARMLY toward the human.
 *
 * Rendered in the Kindred Conversation kit screen: a paper card with the inviter's prompt and one
 * loud voice button.
 */
import { resolveElderSession } from "@chronicle/capture";
import { getElderProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ElderRecorder } from "./ElderRecorder";
import { KindredPromptCard } from "@/app/_kindred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ElderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { db } = await getRuntime();

  const resolved = await resolveElderSession(db, token);

  if (!resolved) {
    return (
      <main className="kin-fullbleed" style={{ alignItems: "center", justifyContent: "center", padding: 32 }}>
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0 }}>Welcome.</h1>
        <p className="kin-muted" style={{ maxWidth: 32 + "ch", textAlign: "center", marginTop: 16 }}>
          This link is resting for now. Whoever invited you will help you get started again.
        </p>
      </main>
    );
  }

  const profile = await getElderProfile(db, resolved.personId);
  const spokenName = profile?.spokenName ?? "there";
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
          borderBottom: "1px solid var(--kin-line)",
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "var(--kin-sage)",
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
          <div style={{ fontSize: 19, fontWeight: 600, color: "var(--kin-ink)" }}>{spokenName}</div>
          <div style={{ fontSize: 14, color: "var(--kin-muted)" }}>Conversation · {dateLabel}</div>
        </div>
      </header>

      <section
        style={{
          flex: 1,
          padding: "32px clamp(20px, 5vw, 56px)",
          display: "flex",
          flexDirection: "column",
          gap: 28,
          maxWidth: 760,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <h1 style={{ fontSize: "var(--kin-text-title)", margin: 0, lineHeight: 1.1 }}>
          Hello, {spokenName}.
        </h1>
        <p className="kin-ink-2" style={{ fontSize: "var(--kin-text-h3)", margin: 0, lineHeight: 1.5 }}>
          Whenever you're ready, tap the button and tell me anything you'd like. Take all the time you want.
        </p>
        <KindredPromptCard
          eyebrow="A thought to start with"
          question="What's something from your day, or from long ago, that's been on your mind?"
        />
      </section>

      <footer
        style={{
          padding: "28px clamp(20px, 5vw, 56px) clamp(24px, 5vw, 48px)",
          borderTop: "1px solid var(--kin-line)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <ElderRecorder token={token} />
      </footer>
    </main>
  );
}
