/**
 * /terms — public Terms and Conditions.
 *
 * The "Text Messaging (SMS)" section is required for Twilio A2P 10DLC / toll-free
 * verification (see `terms` in `_copy/legal.ts`). Like /privacy, this page MUST stay
 * publicly reachable without authentication — Clerk's middleware here is non-blocking
 * (never calls auth.protect()), so this route is not gated. Do not add an auth check.
 *
 * Content lives in `app/_copy/legal.ts`; this file is a thin renderer over `<LegalDocument>`.
 */
import type { Metadata } from "next";
import { legal, common } from "@/app/_copy";
import { LegalDocument } from "@/app/_legal/LegalDocument";

export const runtime = "nodejs";
// Static legal content — allow full static generation so crawlers/reviewers get it fast.
export const dynamic = "force-static";

const { terms } = legal;

export const metadata: Metadata = {
  title: `${terms.title} — ${terms.appName}`,
  description: `The terms that govern your use of ${terms.appName}, including our text-message (SMS) program.`,
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsAndConditionsPage() {
  return <LegalDocument doc={terms} appName={common.appName} />;
}
