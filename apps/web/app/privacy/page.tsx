/**
 * /privacy — public Privacy Policy.
 *
 * Required for Google OAuth branding/verification of the Google Photos Picker integration
 * (see the "Google User Data" section in `_copy/legal.ts`). This page MUST stay publicly
 * reachable without authentication: Clerk's middleware here is non-blocking (never calls
 * auth.protect()), so this route is not gated — do not add an auth check.
 *
 * Content lives in `app/_copy/legal.ts`; this file is a thin renderer over `<LegalDocument>`.
 */
import type { Metadata } from "next";
import { legal, common } from "@/app/_copy";
import { LegalDocument } from "@/app/_legal/LegalDocument";

export const runtime = "nodejs";
// Static legal content — allow full static generation so Google's crawler always gets it fast.
export const dynamic = "force-static";

const { privacy } = legal;

export const metadata: Metadata = {
  title: `${privacy.title} — ${privacy.appName}`,
  description: `How ${privacy.appName} collects, uses, and protects your information, including Google user data.`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return <LegalDocument doc={privacy} appName={common.appName} />;
}
