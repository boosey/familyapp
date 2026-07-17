/**
 * Root landing — brand-first front door for account holders.
 * Photo plane + solid ink band. No staggered entrance choreography.
 */
import Link from "next/link";
import { KindredButton } from "@/app/_kindred";
import { common, auth, legal } from "@/app/_copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="spark-landing">
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
        <p className="spark-landing__brand">{common.appName}</p>
        <h1 className="spark-landing__headline">{auth.landing.headline}</h1>
        <p className="spark-landing__tagline">{auth.landing.tagline}</p>

        <div className="spark-landing__ctas">
          <Link href="/sign-up" style={{ textDecoration: "none" }}>
            <KindredButton label={auth.landing.signUp} size="large" />
          </Link>
          <Link href="/sign-in" style={{ textDecoration: "none" }}>
            <KindredButton label={auth.landing.signIn} variant="secondary" size="large" />
          </Link>
        </div>

        <p className="spark-landing__note">{auth.landing.narratorNote}</p>

        <footer className="spark-landing__footer">
          <Link href="/privacy" className="spark-landing__privacy">
            {legal.privacy.title}
          </Link>
        </footer>
      </div>
    </main>
  );
}
