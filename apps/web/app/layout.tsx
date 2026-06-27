import type { Metadata, Viewport } from "next";
import { Newsreader, Public_Sans } from "next/font/google";
import "./globals.css";

/**
 * Self-hosted via next/font (no runtime Google Fonts request, no FOUT chain).
 * Exposes CSS variables that `_kindred/tokens.css` reads through `--kin-font-*`.
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

export const metadata: Metadata = {
  title: "Family Chronicle",
  description: "A warm place to tell your stories.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let elders pinch-zoom; never trap them.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // className goes on <html> so the CSS variables are exposed at :root, which is where
  // _kindred/tokens.css references them via var(--font-newsreader) / var(--font-public-sans).
  return (
    <html lang="en" className={`${newsreader.variable} ${publicSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
