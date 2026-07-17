import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { isClerkConfigured } from "../lib/clerk-config";
import { kindredClerkAppearance } from "../lib/clerk-appearance";
import { AccountMenuMount } from "./_kindred/AccountMenuMount";
import { ALL_PREFERENCES, buildPrePaintScript } from "./_kindred/preferences/registry";

/**
 * Self-hosted via next/font (no runtime Google Fonts request, no FOUT chain).
 * Exposes CSS variables that `_kindred/tokens.css` reads through `--font-fraunces`,
 * `--font-outfit`, and `--font-jetbrains` (mapped to `--font-story`/`--font-ui`/`--font-mono`).
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-fraunces",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-outfit",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Family Chronicle",
  description: "The living place where your family's stories keep sparking.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let narrators pinch-zoom; never trap them.
  maximumScale: 5,
};

/**
 * ClerkProvider is mounted ONLY when Clerk is configured. In dev (no Clerk envs) the cookie-stub
 * auth path is in effect and Clerk's React context would be dead weight (and would error if its
 * publishable key were missing). The dynamic import is gated by a server-evaluated env check so
 * the Clerk bundle is not pulled into the dev build at all.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const body = (
    <body>
      {children}
      {/* Global account menu — self-gates to signed-in account holders, so it renders on every
          authenticated screen and nothing on the landing / auth / link-session surfaces. Sits inside
          <body> so it is within ClerkProvider (needed for the Clerk sign-out path). */}
      <AccountMenuMount />
      <Analytics />
    </body>
  );
  const inner = isClerkConfigured()
    ? await wrapWithClerk(body)
    : body;
  // className goes on <html> so the CSS variables are exposed at :root, which is where
  // _kindred/tokens.css references them via var(--font-fraunces) / var(--font-outfit).
  return (
    <html lang="en" data-theme="spark" className={`${fraunces.variable} ${outfit.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply persisted app preferences (reading size, theme) BEFORE first paint to avoid a
            flash/reflow. Generated from the preference registry — the single source of truth shared
            with KindredFontScale / KindredThemePicker (ADR-0020). Adding a preference needs no edit here. */}
        <script dangerouslySetInnerHTML={{ __html: buildPrePaintScript(ALL_PREFERENCES) }} />
      </head>
      {inner}
    </html>
  );
}

async function wrapWithClerk(body: React.ReactElement): Promise<React.ReactElement> {
  // Dynamic import keeps @clerk/nextjs out of the dev bundle entirely when Clerk is not wired.
  const { ClerkProvider } = await import("@clerk/nextjs");
  return <ClerkProvider appearance={kindredClerkAppearance}>{body}</ClerkProvider>;
}
