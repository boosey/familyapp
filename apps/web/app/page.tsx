/**
 * Root landing. The product has no public marketing surface in Phase 1, and crucially the elder
 * NEVER lands here — they only ever follow their personal link to /s/[token]. This page exists so
 * the deployment has a root; it intentionally reveals nothing and asks for nothing.
 */
export default function Home() {
  return (
    <main className="screen">
      <p className="subtle">Family Chronicle</p>
    </main>
  );
}
