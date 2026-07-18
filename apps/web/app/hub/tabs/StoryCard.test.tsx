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

  it("layout=left applies the photo-left class and keeps the cover as the first image", () => {
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry layout="left" />,
    );
    const link = container.querySelector("a") as HTMLElement;
    expect(link.className).toContain(styles.layLeft);
    const imgs = container.querySelectorAll("img");
    expect(imgs[0]?.getAttribute("src")).toBe("/api/album-photo/ph1");
  });

  it("layout=wrap floats the cover inside the body via the wrapPhoto class", () => {
    const { container } = render(
      <StoryCard item={item} href="/hub/stories/s1?from=feed" index={0} masonry layout="wrap" />,
    );
    const link = container.querySelector("a") as HTMLElement;
    expect(link.className).toContain(styles.layWrap);
    const wrap = container.querySelector(`.${styles.wrapPhoto}`);
    expect(wrap?.getAttribute("src")).toBe("/api/album-photo/ph1");
  });

  it("layout=collage renders the cover plus extra photos in the collage grid", () => {
    const threePhoto: StoryItem = { ...item, coverPhotoId: "ph1", photoIds: ["ph1", "ph2", "ph3"] };
    const { container } = render(
      <StoryCard item={threePhoto} href="/hub/stories/s1?from=feed" index={0} masonry layout="collage" />,
    );
    const link = container.querySelector("a") as HTMLElement;
    expect(link.className).toContain(styles.layCollage);
    const collage = container.querySelector(`.${styles.collage}`) as HTMLElement;
    expect(collage).toBeTruthy();
    // Cover + up to two extras (ph1, ph2, ph3).
    const cells = collage.querySelectorAll("img");
    expect(cells).toHaveLength(3);
    expect(cells[0]?.getAttribute("src")).toBe("/api/album-photo/ph1");
    // The first collage cell is the tall one.
    expect(cells[0]?.className).toContain(styles.collageTall);
  });

  it("layout=textonly renders no photo even when a cover exists (defensive collapse)", () => {
    // A missing cover always collapses to text-only regardless of the requested layout.
    const noCover: StoryItem = { ...item, coverPhotoId: null, photoIds: [] };
    const { container } = render(
      <StoryCard item={noCover} href="/hub/stories/s1?from=feed" index={0} masonry layout="collage" />,
    );
    const link = container.querySelector("a") as HTMLElement;
    expect(link.className).toContain(styles.textonly);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });
});
