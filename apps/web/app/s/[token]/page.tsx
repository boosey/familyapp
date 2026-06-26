/**
 * The elder entry surface — the entire interface. Tapping the personal link opens this one
 * full-screen page. No login, no account, no install: the session token in the URL IS the
 * identity. If the token does not resolve, we fail WARMLY toward the human (a gentle line, no
 * troubleshooting, nothing for the elder to fix).
 */
import { resolveElderSession } from "@chronicle/capture";
import { getElderProfile } from "@chronicle/core";
import { getRuntime } from "@/lib/runtime";
import { ElderRecorder } from "./ElderRecorder";

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
    // Warm, dead-end-free message. No "invalid token", no retry, no support form.
    return (
      <main className="screen">
        <h1 className="greeting">Welcome.</h1>
        <p className="subtle">
          This link is resting for now. Whoever invited you will help you get
          started again.
        </p>
      </main>
    );
  }

  const profile = await getElderProfile(db, resolved.personId);
  const spokenName = profile?.spokenName ?? "there";

  return (
    <main className="screen">
      <h1 className="greeting">Hello, {spokenName}.</h1>
      <p className="subtle">
        Whenever you’re ready, tap the button and tell me anything you’d like.
        Take all the time you want.
      </p>
      <ElderRecorder token={token} />
    </main>
  );
}
