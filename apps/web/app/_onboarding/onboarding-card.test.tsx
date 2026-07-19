// @vitest-environment jsdom
/**
 * Regression guard for issue #222 — the "full playful signature" on the onboarding surfaces.
 *
 * Two axes:
 *  1. jsdom render: WelcomeFlow (welcome step) carries the module .eyebrow / .headline / .card classes
 *     (mirrors StoryCard.test.tsx). This bonds the components to the shared module.
 *  2. CSS-source guard (no jsdom needed): the module suppresses the signature under BOTH
 *     data-reduce-motion="on" and data-tone="solemn" (issue #222 acceptance criterion), neutralizing
 *     the tape ::before, the highlighter headline background-image, and the sticker eyebrow.
 */
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";
import { welcome } from "@/app/_copy";
import styles from "./onboarding-card.module.css";

// The mic recorder touches browser APIs (MediaRecorder/getUserMedia) that jsdom lacks; stub it so the
// welcome step renders. The welcome step never invokes it, but the hook runs at module init.
vi.mock("@/lib/use-mic-recorder", () => ({
  useMicRecorder: () => ({ phase: "idle", start: vi.fn(), finish: vi.fn() }),
}));

// next/navigation's useRouter isn't provided outside the app runtime.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

describe("onboarding card — WelcomeFlow welcome step wiring", () => {
  it("applies the module .card, .headline and .eyebrow classes", () => {
    const { container } = render(<WelcomeFlow initialName="" invited={false} />);

    const eyebrow = screen.getByText(welcome.introEyebrowDefault);
    expect(eyebrow.className).toContain(styles.eyebrow);

    const headline = screen.getByText(welcome.greetingDefault);
    expect(headline.className).toContain(styles.headline);

    const card = container.querySelector(`.${styles.card}`);
    expect(card).toBeTruthy();
  });
});

describe("onboarding card — CSS suppression guard (issue #222 acceptance)", () => {
  // Vitest runs with cwd = apps/web; resolve the module relative to that so the read is stable
  // regardless of how import.meta.url is scheme-encoded across runners.
  const css = readFileSync(
    pathJoin(process.cwd(), "app/_onboarding/onboarding-card.module.css"),
    "utf8",
  );
  // Collapse whitespace so assertions are robust to formatting.
  const flat = css.replace(/\s+/g, " ");

  it("scopes the playful signature to data-skin=playful (tape, highlighter, sticker)", () => {
    expect(css).toContain(':root[data-skin="playful"]');
    // tape strip on the card ::before
    expect(flat).toMatch(/\.card::before\s*\{[^}]*background:\s*var\(--tape-bg\)/);
    // highlighter wash on the headline
    expect(flat).toMatch(/\.headline\s*\{[^}]*var\(--highlighter\)/);
    // sticker eyebrow pill
    expect(flat).toMatch(/\.eyebrow\s*\{[^}]*var\(--sticker-coral-bg\)/);
  });

  it("suppresses under BOTH reduce-motion and solemn", () => {
    expect(css).toContain(':root[data-reduce-motion="on"]');
    expect(css).toContain('[data-tone="solemn"]');
  });

  it("neutralizes tape, highlighter, and sticker under suppression", () => {
    // Tape ::before is hidden.
    expect(flat).toMatch(/\.card::before[^{]*,[^{]*\.card::before\s*\{[^}]*display:\s*none/);
    // Highlighter headline background-image reverts to none.
    expect(flat).toMatch(/\.headline[^{]*,[^{]*\.headline\s*\{[^}]*background-image:\s*none/);
    // Sticker eyebrow loses its pill background AND reverts ink + display, so a suppressed eyebrow
    // is a truly plain eyebrow (not the pill's rust ink / inline-block residue).
    expect(flat).toMatch(/\.eyebrow[^{]*,[^{]*\.eyebrow\s*\{[^}]*background:\s*none/);
    expect(flat).toMatch(/\.eyebrow[^{]*,[^{]*\.eyebrow\s*\{[^}]*color:\s*var\(--accent\)/);
    expect(flat).toMatch(/\.eyebrow[^{]*,[^{]*\.eyebrow\s*\{[^}]*display:\s*block/);
  });
});
