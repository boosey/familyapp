/**
 * Root landing ("Tell Me Again") — the account-holder front door and the public homepage Google's
 * OAuth reviewer visits when verifying the Google Photos integration (#154). A login-free
 * link-session visitor NEVER lands here; they only ever follow their personal /s/[token] capture
 * link. The scroll-driven experience lives in the client `<LandingExperience>`; this server
 * component owns the page-level metadata so the crawler gets a clear, on-domain description.
 */
import type { Metadata } from "next";
import { LandingExperience } from "./_landing/LandingExperience";
import { auth } from "./_copy";

export const runtime = "nodejs";

const { landing } = auth;

export const metadata: Metadata = {
  title: `${landing.brand} — ${landing.what.title}`,
  description: landing.lede,
  alternates: { canonical: "/" },
  openGraph: {
    title: `${landing.brand} — ${landing.what.title}`,
    description: landing.lede,
    url: "https://tellmeagain.app",
    siteName: landing.brand,
    type: "website",
    images: [{ url: "/logo.png", width: 528, height: 528, alt: landing.brand }],
  },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingExperience />;
}
