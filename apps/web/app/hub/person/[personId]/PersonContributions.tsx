"use client";
/**
 * PersonContributions — the client tab shell for /hub/person/[personId] (tree Slice B).
 *
 * Three deep-linkable sections: Stories | Photos | Mentions (`?section=stories|photos|mentions`,
 * default `stories`). The server component does ALL the audited reads (each already narrows to the
 * viewer's authorized subset — "narrows, never grants") and hands the three lightweight lists in as
 * props; this shell only switches which one is on screen and syncs the URL. Photo bytes come from the
 * audited `/api/album-photo/[photoId]` route, which re-checks read authorization per request.
 *
 * The active section is controlled state seeded from the server-resolved `initialSection`; switching a
 * tab updates it AND pushes `?section=` (shallow) so the view is deep-linkable and back/forward works.
 */
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { hub } from "@/app/_copy";
import { albumPhotoSrc } from "@/app/hub/album/photo-src";
import hubTabStyles from "@/app/hub/HubTabs.module.css";

export type PersonSection = "stories" | "photos" | "mentions";

export interface PersonStoryCard {
  id: string;
  title: string | null;
  summary: string | null;
}

export interface PersonPhotoCard {
  id: string;
  caption: string | null;
}

export interface PersonContributionsProps {
  initialSection: PersonSection;
  stories: PersonStoryCard[];
  photos: PersonPhotoCard[];
  mentions: PersonStoryCard[];
}

export function PersonContributions({
  initialSection,
  stories,
  photos,
  mentions,
}: PersonContributionsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [section, setSection] = useState<PersonSection>(initialSection);

  const change = (key: string) => {
    const next = key as PersonSection;
    setSection(next);
    // Deep-link: reflect the section in the URL so refresh / share / back all land here.
    router.push(`${pathname}?section=${next}`);
  };

  // A plain 3-tab section nav — NOT the hub-shell nav (no Tell-a-story CTA, no overflow menu). It
  // reuses HubTabs.module.css's tab pill styling so the pills stay single-sourced, but renders its
  // own tablist so the Task-3 hub-shell affordances never leak onto the person page.
  const tabs = [
    { key: "stories" as const, label: hub.personPage.tabStories },
    { key: "photos" as const, label: hub.personPage.tabPhotos },
    { key: "mentions" as const, label: hub.personPage.tabMentions },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <nav className={hubTabStyles.nav} role="tablist" aria-label={hub.personPage.sectionsAria}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={tab.key === section}
              className={hubTabStyles.tab}
              onClick={() => change(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {section === "stories" && (
        <StoryList
          items={stories}
          empty={hub.personPage.storiesEmpty}
          testId="person-section-stories"
        />
      )}
      {section === "photos" && (
        <PhotoGrid items={photos} testId="person-section-photos" />
      )}
      {section === "mentions" && (
        <StoryList
          items={mentions}
          empty={hub.personPage.mentionsEmpty}
          testId="person-section-mentions"
        />
      )}
    </div>
  );
}

function StoryList({
  items,
  empty,
  testId,
}: {
  items: PersonStoryCard[];
  empty: string;
  testId: string;
}) {
  if (items.length === 0) {
    return (
      <p
        data-testid={testId}
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {empty}
      </p>
    );
  }
  return (
    <ul
      data-testid={testId}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}
    >
      {items.map((s) => (
        <li key={s.id}>
          <Link
            href={`/hub/stories/${s.id}`}
            style={{
              display: "block",
              background: "var(--surface-card)",
              border: "var(--border-width) solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "16px 20px",
              fontFamily: "var(--font-story)",
              fontSize: "var(--text-story)",
              color: "var(--text-body)",
              textDecoration: "none",
            }}
          >
            {s.title ?? s.summary ?? hub.stories.untitled}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PhotoGrid({ items, testId }: { items: PersonPhotoCard[]; testId: string }) {
  if (items.length === 0) {
    return (
      <p
        data-testid={testId}
        style={{
          fontFamily: "var(--font-story)",
          fontSize: "var(--text-story)",
          color: "var(--text-muted)",
          margin: 0,
        }}
      >
        {hub.personPage.photosEmpty}
      </p>
    );
  }
  return (
    <ul
      data-testid={testId}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 8,
      }}
    >
      {items.map((p) => (
        <li key={p.id}>
          <img
            src={albumPhotoSrc(p.id, { thumb: true })}
            alt={hub.personPage.photoAlt(p.caption)}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              objectFit: "cover",
              borderRadius: "var(--radius-sm)",
              display: "block",
              background: "var(--surface-sunken)",
            }}
          />
        </li>
      ))}
    </ul>
  );
}
