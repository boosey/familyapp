import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getProtoStory } from "../../mock-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SundayLetterStoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (process.env.NODE_ENV === "production") redirect("/");
  const { id } = await params;
  const story = getProtoStory(id);
  if (!story) notFound();

  return (
    <main style={{ minHeight: "100dvh", background: "#F4F5F0", color: "#161912" }}>
      <article style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>
        <Link
          href="/dev/prototypes/sunday-letter"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: "#5C6552",
            textDecoration: "none",
          }}
        >
          ← This week&apos;s mail
        </Link>

        <div
          style={{
            marginTop: 24,
            background: "#FFFEFA",
            border: "2px solid #B8C0A8",
            borderRadius: 4,
            padding: "clamp(24px, 4vw, 40px)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              letterSpacing: "0.05em",
              color: "#5C6552",
            }}
          >
            {story.recorded}
          </p>
          <p
            style={{
              margin: "18px 0 0",
              fontFamily: "var(--font-story)",
              fontSize: "1.35rem",
              fontStyle: "italic",
            }}
          >
            Dear family,
          </p>

          <div
            aria-hidden
            style={{
              float: "right",
              width: "42%",
              maxWidth: 220,
              margin: "8px 0 16px 20px",
              aspectRatio: "4 / 5",
              background:
                story.tone === "warm" ? "#D7EBE7" : story.tone === "cool" ? "#D9E4F2" : "#E4EDD4",
              border: "2px solid #B8C0A8",
              display: "flex",
              alignItems: "flex-end",
              padding: 10,
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#3F6212",
            }}
          >
            Photo
          </div>

          {story.body.map((p) => (
            <p
              key={p.slice(0, 28)}
              style={{
                margin: "16px 0 0",
                fontFamily: "var(--font-story)",
                fontSize: "1.3rem",
                lineHeight: 1.7,
              }}
            >
              {p}
            </p>
          ))}

          <p
            style={{
              margin: "28px 0 0",
              fontFamily: "var(--font-story)",
              fontSize: "1.3rem",
              fontStyle: "italic",
              clear: "both",
            }}
          >
            With love,
            <br />
            {story.narrator}
          </p>
        </div>
      </article>
    </main>
  );
}
