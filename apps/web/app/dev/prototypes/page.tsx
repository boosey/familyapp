/**
 * DEV-ONLY clickable UX prototypes.
 * Three directions: Album Leaf, Voice Theater, Sunday Letter.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDEAS = [
  {
    href: "/dev/prototypes/album-leaf",
    name: "Album Leaf",
    promise: "Photo-first rows, hard borders, underline tabs — like opening a real album.",
    swatch: "#0E5C52",
  },
  {
    href: "/dev/prototypes/voice-theater",
    name: "Voice Theater",
    promise: "Stories as performances. Sparse program hub; tell/listen as full stages.",
    swatch: "#1E4E8C",
  },
  {
    href: "/dev/prototypes/sunday-letter",
    name: "Sunday Letter",
    promise: "One-column letters with date, salutation, and a single inset photo.",
    swatch: "#3F6212",
  },
] as const;

export default function PrototypesIndex() {
  if (!isDevSurfaceEnabled()) {
    redirect("/");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#F0F3F1",
        color: "#121816",
        padding: "clamp(28px, 5vw, 56px) clamp(18px, 4vw, 40px)",
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "0.8rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#5A6A64",
        }}
      >
        Dev · Prototypes
      </p>
      <h1
        style={{
          margin: "10px 0 8px",
          fontFamily: "var(--font-story)",
          fontSize: "clamp(2.2rem, 5vw, 3.4rem)",
          fontWeight: 500,
          letterSpacing: "-0.03em",
          lineHeight: 1.1,
        }}
      >
        Three directions
      </h1>
      <p
        style={{
          margin: "0 0 32px",
          maxWidth: "42ch",
          fontFamily: "var(--font-ui)",
          fontSize: "1.15rem",
          color: "#5A6A64",
          lineHeight: 1.5,
        }}
      >
        Clickable mocks — not wired to real data. Pick a lane; ignore the rest of the app chrome.
      </p>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          maxWidth: 640,
        }}
      >
        {IDEAS.map((idea, i) => (
          <li key={idea.href}>
            <Link
              href={idea.href}
              style={{
                display: "grid",
                gridTemplateColumns: "8px 1fr",
                gap: 18,
                textDecoration: "none",
                color: "inherit",
                background: "#fff",
                border: "2px solid #B8C4BE",
                borderRadius: 6,
                padding: "20px 22px",
              }}
            >
              <span style={{ background: idea.swatch, borderRadius: 2 }} aria-hidden />
              <span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    letterSpacing: "0.06em",
                    color: "#5A6A64",
                    marginBottom: 6,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-story)",
                    fontSize: "1.65rem",
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  {idea.name}
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-ui)",
                    fontSize: "1.05rem",
                    color: "#5A6A64",
                    lineHeight: 1.45,
                  }}
                >
                  {idea.promise}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <p style={{ marginTop: 36 }}>
        <Link href="/dev/seed" style={{ color: "#0E5C52", fontFamily: "var(--font-ui)" }}>
          ← Back to seed
        </Link>
      </p>
    </main>
  );
}
