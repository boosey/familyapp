import type { Metadata, Viewport } from "next";
import { Newsreader, Public_Sans, DM_Mono, Baloo_2, Nunito, Source_Sans_3 } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { isClerkConfigured } from "../lib/clerk-config";
import { kindredClerkAppearance } from "../lib/clerk-appearance";
import { ALL_PREFERENCES, buildPrePaintScript } from "./_kindred/preferences/registry";
import { DEFAULT_SKIN_ID } from "./_kindred/skin-constants";

/**
 * Self-hosted via next/font (no runtime Google Fonts request, no FOUT chain).
 * Exposes CSS variables that `_kindred/tokens.css` reads through `--font-newsreader`,
 * `--font-public-sans`, and `--font-dm-mono` (mapped to `--font-story`/`--font-ui`/`--font-mono`).
 */
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-newsreader",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-public-sans",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-dm-mono",
});

// Playful skin display + read fonts (Baloo 2 headings, Nunito body). Exposed as CSS variables the
// `_skins/playful.css` token block reads through `--font-baloo` / `--font-nunito`.
const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-baloo",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-nunito",
});

// Playful skin display/UI/read face: Source Sans 3 — a hosted, cross-platform humanist sans that
// closely matches the Segoe UI look the owner signed off on in the "Playful & warm" mockup, so the
// approved single-crisp-sans-throughout design renders the same on every OS (not just Windows).
// Exposed as the `--font-source-sans` variable that `_skins/playful.css` points --font-display/ui/
// read/story at.
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: "swap",
  variable: "--font-source-sans",
});

export const metadata: Metadata = {
  title: "Tell Me Again",
  description: "A warm place to tell your stories.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let narrators pinch-zoom; never trap them.
  maximumScale: 5,
  // ADR-0025 mobile Phase B: `cover` is REQUIRED for `env(safe-area-inset-*)` to report non-zero on
  // iOS — the fixed bottom tab bar reads `safe-area-inset-bottom` to clear the home indicator. Without
  // it the insets are 0 and the bar collides with the indicator. Content already draws inside the safe
  // area (the app has no full-bleed edge chrome besides that bar), so cover is safe here.
  viewportFit: "cover",
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
      <Analytics />
    </body>
  );
  const inner = isClerkConfigured()
    ? await wrapWithClerk(body)
    : body;
  // className goes on <html> so the CSS variables are exposed at :root, which is where
  // _kindred/tokens.css references them via var(--font-newsreader) / var(--font-public-sans).
  //
  // `data-skin` carries a STATIC SSR default (unlike `data-theme`, which is pre-paint-script-only):
  // a skin swaps fonts + shape, so a pre-script flash of the wrong skin is far more jarring than a
  // palette flash. It is sourced from DEFAULT_SKIN_ID (not a hardcoded literal) so it can never drift
  // out of lockstep with the registry default and silently reintroduce a first-paint flash.
  return (
    <html lang="en" data-theme="heirloom" data-skin={DEFAULT_SKIN_ID} className={`${newsreader.variable} ${publicSans.variable} ${dmMono.variable} ${baloo.variable} ${nunito.variable} ${sourceSans.variable}`} suppressHydrationWarning>
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
