import type { Metadata, Viewport } from "next";
import { Newsreader, Public_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import { isClerkConfigured } from "../lib/clerk-config";
import { kindredClerkAppearance } from "../lib/clerk-appearance";
import { AccountMenuMount } from "./_kindred";
import { FONT_SIZE_STEPS_PT, DEFAULT_FONT_SIZE_INDEX } from "../lib/constants";
import { FONT_SIZE_STORAGE_KEY } from "./_kindred/font-scale-constants";

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

export const metadata: Metadata = {
  title: "Family Chronicle",
  description: "A warm place to tell your stories.",
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
    </body>
  );
  const inner = isClerkConfigured()
    ? await wrapWithClerk(body)
    : body;
  // className goes on <html> so the CSS variables are exposed at :root, which is where
  // _kindred/tokens.css references them via var(--font-newsreader) / var(--font-public-sans).
  return (
    <html lang="en" data-theme="heirloom" className={`${newsreader.variable} ${publicSans.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the persisted reading-size step BEFORE first paint to avoid a flash/reflow.
            Reads the same constants as KindredFontScale — single source of truth. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var S=${JSON.stringify(FONT_SIZE_STEPS_PT)};var i=+localStorage.getItem(${JSON.stringify(FONT_SIZE_STORAGE_KEY)});if(!(Number.isInteger(i)&&i>=0&&i<S.length))i=${DEFAULT_FONT_SIZE_INDEX};document.documentElement.style.fontSize=S[i]+'pt';}catch(e){}})()`,
          }}
        />
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
