"use client";

/**
 * LandingExperience — the public "Tell Me Again" front door. A scroll-driven, Playful-skinned
 * marketing page that clearly describes the product (the homepage Google's OAuth reviewer visits,
 * #154) and links the Privacy Policy (#153).
 *
 * Motion is enhancement, never load-bearing: all copy renders server-side and is fully legible with
 * zero JS. On the client a single rAF-throttled scroll handler feeds window.scrollY through the pure
 * functions in `landing-motion.ts` and writes the results to CSS custom properties that
 * `landing.module.css` consumes (JS does the math, CSS consumes the var). When the visitor prefers
 * reduced motion — via the OS setting OR the in-app `data-reduce-motion` toggle — the handler parks
 * every property at its resting value and the page is simply static.
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import { KindredButton } from "@/app/_kindred";
import { auth, legal } from "@/app/_copy";
import styles from "./landing.module.css";
import {
  SCROLL_SPEEDS,
  scrollFraction,
  parallaxOffset,
  heroExit,
} from "./landing-motion";

const { landing } = auth;

/** The primary/secondary call-to-action pair — used in both the hero and the closing section. */
function LandingCta() {
  return (
    <div className={styles.ctaRow}>
      <Link href="/sign-up" className={styles.ctaLink}>
        <KindredButton label={landing.primaryCta} size="large" />
      </Link>
      <Link href="/sign-in" className={styles.ctaLink}>
        <KindredButton label={landing.signIn} variant="secondary" size="large" />
      </Link>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const mqReduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toggled =
    document.documentElement.getAttribute("data-reduce-motion") === "on";
  return mqReduced || toggled;
}

export function LandingExperience() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const set = (name: string, value: string) => root.style.setProperty(name, value);
    const rest = () => {
      set("--py-slow", "0px");
      set("--py-medium", "0px");
      set("--py-fast", "0px");
      set("--sp", "0");
      set("--hero", "0");
    };

    let frame = 0;
    const apply = () => {
      frame = 0;
      if (prefersReducedMotion()) {
        rest();
        return;
      }
      const sy = window.scrollY;
      const vh = window.innerHeight;
      set("--py-slow", `${parallaxOffset(sy, SCROLL_SPEEDS.slow)}px`);
      set("--py-medium", `${parallaxOffset(sy, SCROLL_SPEEDS.medium)}px`);
      set("--py-fast", `${parallaxOffset(sy, SCROLL_SPEEDS.fast)}px`);
      set("--sp", `${scrollFraction(sy, document.documentElement.scrollHeight, vh)}`);
      set("--hero", `${heroExit(sy, vh)}`);
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    mq?.addEventListener?.("change", apply);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mq?.removeEventListener?.("change", apply);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.progressRail} aria-hidden>
        <span className={styles.progressFill} />
      </div>

      {/* Parallax depth field — purely decorative. */}
      <div className={styles.decor} aria-hidden>
        <span className={`${styles.blob} ${styles.blobA} ${styles.driftSlowUp}`} />
        <span className={`${styles.ring} ${styles.ringA} ${styles.driftMediumDown}`} />
        <span className={`${styles.blob} ${styles.blobB} ${styles.driftFastUp}`} />
        <span className={`${styles.ring} ${styles.ringB} ${styles.driftSlowUp}`} />
        <span className={`${styles.blob} ${styles.blobC} ${styles.driftMediumDown}`} />
      </div>

      <main>
        {/* ---- hero ---- */}
        <section className={styles.hero}>
          <p className={styles.eyebrow}>{landing.eyebrow}</p>
          <h1 className={styles.refrain}>
            <span className={styles.mark}>{landing.refrain}</span>
          </h1>
          <p className={styles.lede}>{landing.lede}</p>
          <LandingCta />
          <p className={styles.narratorNote}>{landing.narratorNote}</p>
          <span className={styles.scrollCue}>
            <span className={styles.scrollCueDot} aria-hidden />
            {landing.scrollCue}
          </span>
        </section>

        {/* ---- what it is ---- */}
        <section className={styles.section}>
          <p className={styles.kicker}>{landing.what.eyebrow}</p>
          <h2 className={styles.sectionTitle}>{landing.what.title}</h2>
          <p className={styles.sectionBody}>{landing.what.body}</p>
        </section>

        {/* ---- how it works ---- */}
        <section className={styles.section}>
          <p className={styles.kicker}>{landing.steps.eyebrow}</p>
          <h2 className={styles.sectionTitle}>{landing.steps.title}</h2>
          <ol className={styles.stepList}>
            {landing.steps.items.map((step) => (
              <li key={step.n} className={styles.stepCard}>
                <span className={styles.tape} aria-hidden />
                <span className={styles.stepNum}>{step.n}</span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p className={styles.stepBody}>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- why now ---- */}
        <section className={styles.section}>
          <p className={styles.kicker}>{landing.why.eyebrow}</p>
          <h2 className={styles.sectionTitle}>{landing.why.title}</h2>
          <p className={styles.sectionBody}>{landing.why.body}</p>
        </section>

        {/* ---- trust + privacy (#153) ---- */}
        <section className={styles.trust}>
          <p className={styles.kicker}>{landing.trust.eyebrow}</p>
          <h2 className={styles.sectionTitle}>{landing.trust.title}</h2>
          <p className={styles.sectionBody}>{landing.trust.body}</p>
          <Link href="/privacy" className={styles.privacyLink}>
            {landing.trust.privacyCta}
          </Link>
        </section>

        {/* ---- closing CTA ---- */}
        <section className={styles.closing}>
          <h2 className={styles.closingTitle}>{landing.closing.title}</h2>
          <p className={styles.closingBody}>{landing.closing.body}</p>
          <LandingCta />
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerBrand}>
          © {landing.brand}
        </span>
        <span>{landing.footer.tagline}</span>
        <nav className={styles.footerLinks} aria-label="Legal">
          <Link href="/privacy" className={styles.footerLink}>
            {landing.footer.privacy}
          </Link>
          <a
            href={`mailto:${legal.privacy.contactEmail}`}
            className={styles.footerLink}
          >
            {landing.footer.contact}
          </a>
        </nav>
      </footer>
    </div>
  );
}
