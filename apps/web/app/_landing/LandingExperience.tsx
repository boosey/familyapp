"use client";

/**
 * LandingExperience — the public "Tell Me Again" front door. A scroll-driven, Scrapbook-skinned
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
import { BrandMark } from "@/app/_brand/BrandMark";
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

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    // Motion state is cached here and updated reactively (media-query `change` + a
    // MutationObserver on `data-reduce-motion`), so scroll frames never re-query it and
    // the page responds immediately to either toggle.
    let isReducedMotion = false;

    const updateMotionState = () => {
      const mqReduced = mq?.matches ?? false;
      const toggled =
        document.documentElement.getAttribute("data-reduce-motion") === "on";
      isReducedMotion = mqReduced || toggled;
      if (isReducedMotion) {
        rest();
      } else {
        apply();
      }
    };

    let frame = 0;
    const apply = () => {
      frame = 0;
      if (isReducedMotion) return;
      const sy = window.scrollY;
      const vh = window.innerHeight;
      set("--py-slow", `${parallaxOffset(sy, SCROLL_SPEEDS.slow)}px`);
      set("--py-medium", `${parallaxOffset(sy, SCROLL_SPEEDS.medium)}px`);
      set("--py-fast", `${parallaxOffset(sy, SCROLL_SPEEDS.fast)}px`);
      set("--sp", `${scrollFraction(sy, document.documentElement.scrollHeight, vh)}`);
      set("--hero", `${heroExit(sy, vh)}`);
    };

    const onScroll = () => {
      if (isReducedMotion) return;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    updateMotionState();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    mq?.addEventListener?.("change", updateMotionState);

    const observer =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(updateMotionState)
        : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-reduce-motion"],
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mq?.removeEventListener?.("change", updateMotionState);
      observer?.disconnect();
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
        <span className={`${styles.dot} ${styles.dotA} ${styles.driftFastUp}`} />
        <span className={`${styles.blob} ${styles.blobD} ${styles.driftFastDown}`} />
        <span className={`${styles.dot} ${styles.dotB} ${styles.driftSlowDown}`} />
        <span className={`${styles.ring} ${styles.ringC} ${styles.driftFastUp}`} />
        <span className={`${styles.blob} ${styles.blobE} ${styles.driftSlowDown}`} />
        <span className={`${styles.dot} ${styles.dotC} ${styles.driftMediumDown}`} />
      </div>

      <main>
        {/* ---- hero ---- */}
        <section className={styles.hero}>
          {/* Brand lockup — mark + exact app name, shown prominently so the homepage name
              matches the OAuth consent-screen app name Google verifies against (#154). */}
          <p className={styles.brandLockup}>
            <BrandMark size={48} className={styles.brandMark} />
            <span className={styles.wordmark}>{landing.brand}</span>
          </p>
          <p className={styles.eyebrow}>{landing.eyebrow}</p>
          <h1 className={styles.refrain}>
            <span className={styles.mark}>{landing.refrain}</span>
          </h1>
          <p className={styles.lede}>{landing.lede}</p>
          <LandingCta />
          <p className={styles.narratorNote}>{landing.narratorNote}</p>
          <span className={styles.scrollCue}>
            {landing.scrollCue}
            <svg
              className={styles.scrollChevron}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 8l7 7 7-7" />
            </svg>
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

        {/* ---- photos: device + Google Photos (the Google Photos OAuth scope this homepage discloses, #154) ---- */}
        <section className={styles.section}>
          <p className={styles.kicker}>{landing.photos.eyebrow}</p>
          <h2 className={styles.sectionTitle}>{landing.photos.title}</h2>
          <p className={styles.sectionBody}>{landing.photos.body}</p>
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
          <BrandMark size={20} className={styles.footerMark} />
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
