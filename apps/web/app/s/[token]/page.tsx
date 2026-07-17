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
import styles from "./capture.module.css";

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
      <main className={`kin-fullbleed ${styles.restingMain}`} data-tone="solemn">
        <h1 className={styles.restingTitle}>{capture.resting.welcome}</h1>
        <p className={styles.restingBody}>{capture.resting.body}</p>
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
    <main className="kin-fullbleed" data-tone="solemn">
      <header className={styles.header}>
        <span className={styles.avatar}>{initial}</span>
        <div>
          <div className={styles.name}>{spokenName}</div>
          <div className={styles.date}>{capture.narrator.conversationDate(dateLabel)}</div>
        </div>
      </header>

      <section className={styles.section}>
        <h1 className={styles.hello}>{capture.narrator.hello(spokenName)}</h1>
        <p className={styles.invite}>{capture.narrator.invite}</p>
        <KindredPromptCard
          eyebrow={nextAsk ? capture.narrator.eyebrowAsked(nextAsk.askerSpokenName) : capture.narrator.eyebrowDefault}
          question={
            nextAsk
              ? nextAsk.ask.questionText
              : capture.narrator.starterPrompt
          }
        />
      </section>

      <footer className={styles.footer}>
        <NarratorRecorder token={token} askId={nextAsk?.ask.id ?? null} />
      </footer>
    </main>
  );
}
