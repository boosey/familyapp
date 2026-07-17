// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoryCard } from "./StoryCard";
import styles from "./StoryCard.module.css";
import type { StoryItem } from "./story-browse-types";

const item: StoryItem = {
  id: "s1",
  title: "Grandpa's boat",
  summary: "A summer on the water.",
  prose: "…",
  tags: ["boats", "1962", "naples"],
  personId: "p1",
  personName: "Al Boudreaux",
  eraYear: 1962,
  eraLabel: "Naples",
  eventLabel: "1962 · NAPLES",
  families: [{ id: "f1", name: "Boudreaux", shortName: "B" }],
  isNew: true,
  coverPhotoId: "ph1",
  photoIds: ["ph1", "ph2"],
  href: "/hub/stories/s1",
};

afterEach(cleanup);

describe("StoryCard", () => {
  it("renders title, event label, a cover image, and one sticker per content tag", () => {
    // Decorative photos carry alt="" (role none/presentation), so query the DOM by tag, not by role.
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry />,
    );

    expect(screen.getByText("Grandpa's boat")).toBeTruthy();
    expect(screen.getByText("1962 · NAPLES")).toBeTruthy();

    const imgs = container.querySelectorAll("img");
    expect(imgs[0]?.getAttribute("src")).toBe("/api/album-photo/ph1");

    for (const t of item.tags) expect(screen.getByText(t)).toBeTruthy();
  });

  it("links to the passed pre-built href", () => {
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=timeline" index={1} />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/hub/stories/s1?from=timeline");
  });

  it("applies a sticker palette class to each content tag (rotating i % 4)", () => {
    render(<StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry />);

    const boats = screen.getByText("boats");
    expect(boats.className).toContain(styles.sticker);
    expect(boats.className).toContain(styles.sticker0);
    expect(screen.getByText("1962").className).toContain(styles.sticker1);
    expect(screen.getByText("naples").className).toContain(styles.sticker2);
  });

  it("renders family tags with shortName and does NOT stickerize them", () => {
    render(<StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry />);

    const family = screen.getByText("B");
    expect(family.className).toContain(styles.familyTag);
    expect(family.className).not.toContain(styles.sticker);
  });

  it("renders non-cover photos as a thumbnail row", () => {
    render(<StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry />);

    const thumbs = screen.getAllByTestId("card-photo-thumb");
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]?.getAttribute("src")).toBe("/api/album-photo/ph2");
  });

  it("sets an inline --tilt custom property from the index parity", () => {
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=feed" index={1} masonry />,
    );
    const link = container.querySelector("a") as HTMLElement;
    // Odd index leans one way; even the other. Assert the value is present + parity-driven.
    expect(link.style.getPropertyValue("--tilt")).toBe("-0.55deg");
  });

  it("applies the feature class to the anchor for variant=feature", () => {
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry variant="feature" />,
    );
    const link = container.querySelector("a") as HTMLElement;
    expect(link.className).toContain(styles.feature);
  });

  it("renders the New badge for a story new to the viewer", () => {
    render(<StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry />);
    expect(screen.getByText("New")).toBeTruthy();
  });

  it("renders a text-only story with no images", () => {
    const textOnly: StoryItem = { ...item, coverPhotoId: null, photoIds: [] };
    const { container } = render(
      <StoryCard item={textOnly} href="/hub/stories/s1?from=feed" index={0} masonry />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});
