import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
