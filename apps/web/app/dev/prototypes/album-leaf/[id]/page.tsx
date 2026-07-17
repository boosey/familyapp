import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { isDevSurfaceEnabled } from "@/lib/dev-surface";
import { getProtoStory } from "../../mock-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AlbumLeafStoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDevSurfaceEnabled()) redirect("/");
  const { id } = await params;
  const story = getProtoStory(id);
  if (!story) notFound();

  return (
    <main style={{ minHeight: "100dvh", background: "#F0F3F1", color: "#121816" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 18px 72px" }}>
        <Link
          href="/dev/prototypes/album-leaf"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: "#5A6A64",
            textDecoration: "none",
          }}
        >
          ← Album Leaf
        </Link>

        <div
          aria-hidden
          style={{
            marginTop: 20,
            height: 220,
            background:
              story.tone === "warm" ? "#D7EBE7" : story.tone === "cool" ? "#D9E4F2" : "#E4EDD4",
            border: "2px solid #B8C4BE",
            borderRadius: 6,
            display: "flex",
            alignItems: "flex-end",
            padding: 16,
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "#0E5C52",
          }}
        >
          Cover photo
        </div>

        <p
          style={{
            margin: "22px 0 8px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            letterSpacing: "0.04em",
            color: "#5A6A64",
          }}
        >
          {story.narrator} · {story.year} · {story.place} · {story.duration}
        </p>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-story)",
            fontSize: "clamp(1.9rem, 4vw, 2.6rem)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          {story.title}
        </h1>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 18 }}>
          {story.body.map((p) => (
            <p
              key={p.slice(0, 24)}
              style={{
                margin: 0,
                fontFamily: "var(--font-story)",
                fontSize: "1.35rem",
                lineHeight: 1.65,
              }}
            >
              {p}
            </p>
          ))}
        </div>
      </div>
    </main>
  );
}
