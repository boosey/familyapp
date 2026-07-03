/**
 * In-hub tell page — full-screen capture → review flow for a self-initiated telling (ADR-0007).
 *
 * The same surface as /hub/answer minus the question header: there is no ask to seed the capture
 * or the follow-up evaluator, so `ask` is null and StoryComposer shows a warm tell-prompt instead.
 *
 * Auth: account only, gated identically to /hub (anonymous → landing; family-less / not-onboarded →
 * the step they still owe via resolvePostAuthRoute). Nothing is read here — the composer's capture
 * action creates the story — so there is no content read to route through @chronicle/core.
 */
import { redirect } from "next/navigation";
import Link from "next/link";
import { getRuntime } from "@/lib/runtime";
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
import { hub } from "@/app/_copy";
import { StoryComposer } from "../StoryComposer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TellPage() {
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();

  // Anonymous → the real front door (mirrors the /hub gate).
  if (ctx.kind !== "account") {
    redirect("/");
  }

  // Family-first gate: a family-less / not-yet-onboarded account is bounced to the step it owes.
  // resolvePostAuthRoute returns "/hub" only for an onboarded member.
  const dest = await resolvePostAuthRoute(db, ctx.personId);
  if (dest !== "/hub") redirect(dest);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--surface-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Back nav */}
      <div
        style={{
          padding: "20px clamp(16px, 4vw, 32px) 0",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          alignSelf: "flex-start",
          boxSizing: "border-box",
        }}
      >
        <Link
          href="/hub?tab=stories"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-ui-sm)",
            color: "var(--text-meta)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {hub.compose.backToStories}
        </Link>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          maxWidth: 640,
          width: "100%",
          margin: "0 auto",
          padding: "32px clamp(16px, 4vw, 32px) 48px",
          boxSizing: "border-box",
        }}
      >
        <StoryComposer mode="tell" ask={null} draft={null} />
      </div>
    </main>
  );
}
