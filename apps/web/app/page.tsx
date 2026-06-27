/**
 * Root landing. The product has no public marketing surface in Phase 1, and crucially the elder
 * NEVER lands here — they only ever follow their personal link to /s/[token]. This page exists so
 * the deployment has a root; it intentionally reveals nothing and asks for nothing.
 */
export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-page)",
        padding: "6vh 6vw",
        gap: 12,
      }}
    >
      <div className="kin-eyebrow">Est. 2026</div>
      <h1
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-display-lg)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--text-body)",
          margin: 0,
          lineHeight: "var(--leading-tight)",
        }}
      >
        Family Chronicle
      </h1>
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-ui)",
          color: "var(--text-muted)",
          maxWidth: "32ch",
          textAlign: "center",
          margin: 0,
          lineHeight: "var(--leading-body)",
        }}
      >
        A warm place to tell your stories.
      </p>
    </main>
  );
}
