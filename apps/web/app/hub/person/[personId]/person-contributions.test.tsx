// @vitest-environment jsdom
/**
 * Tree Slice B — the per-person contributions tab shell (PersonContributions).
 *
 * The AUTHORIZATION for each list is tested exhaustively in packages/core (narrows-never-grants);
 * here we verify the SHELL behavior given already-authorized lists injected as props:
 *   1. `initialSection` selects the right tab on first render (deep-link honored).
 *   2. Each tab renders its own list; switching tabs swaps the visible section.
 *   3. Empty states render per tab when a list is empty.
 *   4. Story cards link to /hub/stories/[id]; photo tiles pull bytes from /api/album-photo/[id].
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { PersonContributions } from "./PersonContributions";

// next/navigation is not wired in jsdom — stub the hooks the shell uses on tab switch.
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/hub/person/p1",
}));

afterEach(() => {
  cleanup();
  push.mockReset();
});

const stories = [
  { id: "s1", title: "A wedding", summary: null },
  { id: "s2", title: null, summary: "A summer" },
];
const photos = [{ id: "ph1", caption: "On the porch" }];
const mentions = [{ id: "m1", title: "Grandpa's tale", summary: null }];

function renderShell(section: "stories" | "photos" | "mentions") {
  return render(
    <PersonContributions
      initialSection={section}
      stories={stories}
      photos={photos}
      mentions={mentions}
    />,
  );
}

it("honors initialSection=stories and renders story cards linking to /hub/stories/[id]", () => {
  renderShell("stories");
  const list = screen.getByTestId("person-section-stories");
  expect(list).toBeTruthy();
  const links = screen.getAllByRole("link");
  const storyLink = links.find((a) => a.getAttribute("href") === "/hub/stories/s1");
  expect(storyLink).toBeTruthy();
  expect(storyLink!.textContent).toBe("A wedding");
  // The untitled story falls back to its summary.
  expect(links.find((a) => a.getAttribute("href") === "/hub/stories/s2")!.textContent).toBe("A summer");
  // Photos/mentions sections are NOT mounted.
  expect(screen.queryByTestId("person-section-photos")).toBeNull();
  expect(screen.queryByTestId("person-section-mentions")).toBeNull();
});

it("honors initialSection=photos and renders photo tiles from the audited byte route", () => {
  renderShell("photos");
  expect(screen.getByTestId("person-section-photos")).toBeTruthy();
  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.getAttribute("src")).toBe("/api/album-photo/ph1?variant=thumb");
  expect(img.getAttribute("alt")).toBe("On the porch");
  expect(screen.queryByTestId("person-section-stories")).toBeNull();
});

it("honors initialSection=mentions and renders the mentions list", () => {
  renderShell("mentions");
  const list = screen.getByTestId("person-section-mentions");
  expect(list).toBeTruthy();
  expect(list.textContent).toContain("Grandpa's tale");
});

it("switches sections when a tab is clicked (and pushes ?section=)", () => {
  renderShell("stories");
  expect(screen.getByTestId("person-section-stories")).toBeTruthy();

  fireEvent.click(screen.getByRole("tab", { name: hub.personPage.tabPhotos }));
  expect(screen.getByTestId("person-section-photos")).toBeTruthy();
  expect(screen.queryByTestId("person-section-stories")).toBeNull();
  expect(push).toHaveBeenCalledWith("/hub/person/p1?section=photos");

  fireEvent.click(screen.getByRole("tab", { name: hub.personPage.tabMentions }));
  expect(screen.getByTestId("person-section-mentions")).toBeTruthy();
  expect(push).toHaveBeenLastCalledWith("/hub/person/p1?section=mentions");
});

it("shows the per-tab empty state when a list is empty", () => {
  render(
    <PersonContributions initialSection="stories" stories={[]} photos={[]} mentions={[]} />,
  );
  expect(screen.getByTestId("person-section-stories").textContent).toBe(hub.personPage.storiesEmpty);

  fireEvent.click(screen.getByRole("tab", { name: hub.personPage.tabPhotos }));
  expect(screen.getByTestId("person-section-photos").textContent).toBe(hub.personPage.photosEmpty);

  fireEvent.click(screen.getByRole("tab", { name: hub.personPage.tabMentions }));
  expect(screen.getByTestId("person-section-mentions").textContent).toBe(hub.personPage.mentionsEmpty);
});
