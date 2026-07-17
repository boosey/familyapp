/**
 * Root landing — the account-holder front door. A login-free link-session visitor NEVER lands here;
 * they only ever follow their personal /s/[token] capture link. This is the marketing-light
 * entry for relatives: brand first, one promise, then the two real doors.
 */
import Link from "next/link";
import { KindredButton } from "@/app/_kindred";
import { common, auth, legal } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="spark-landing">
      {/* Full-bleed atmospheric plane — edge-to-edge, not an inset card */}
      <div className="spark-landing__media" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing-hero.jpg"
          alt=""
          className="spark-landing__photo"
        />
        <div className="spark-landing__veil" />
      </div>

      <div className="spark-landing__content">
        <p className="spark-landing__brand spark-rise">{common.appName}</p>
        <h1 className="spark-landing__headline spark-rise spark-rise-delay-1">
          {auth.landing.headline}
        </h1>
        <p className="spark-landing__tagline spark-rise spark-rise-delay-2">
          {auth.landing.tagline}
        </p>

        <div className="spark-landing__ctas spark-rise spark-rise-delay-3">
          <Link href="/sign-up" style={{ textDecoration: "none" }}>
            <KindredButton label={auth.landing.signUp} size="large" />
          </Link>
          <Link href="/sign-in" style={{ textDecoration: "none" }}>
            <KindredButton label={auth.landing.signIn} variant="secondary" size="large" />
          </Link>
        </div>

        <p className="spark-landing__note spark-rise spark-rise-delay-4">
          {auth.landing.narratorNote}
        </p>

        <footer className="spark-landing__footer">
          <Link href="/privacy" className="spark-landing__privacy">
            {legal.privacy.title}
          </Link>
        </footer>
      </div>
    </main>
  );
}
