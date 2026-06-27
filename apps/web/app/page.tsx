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
        background: "var(--kin-bg)",
        padding: "6vh 6vw",
        gap: 12,
      }}
    >
      <div className="kin-eyebrow">Est. 2026</div>
      <h1
        style={{
          fontFamily: "var(--kin-font-serif)",
          fontSize: "clamp(40px, 8vw, 84px)",
          letterSpacing: "-.015em",
          color: "var(--kin-ink)",
          margin: 0,
        }}
      >
        Family Chronicle
      </h1>
      <p className="kin-muted" style={{ maxWidth: "32ch", textAlign: "center", margin: 0 }}>
        A warm place to tell your stories.
      </p>
    </main>
  );
}
