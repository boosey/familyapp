// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoriesControls, type SelfDraft } from "./StoriesControls";
import { hub } from "@/app/_copy";

// FamilyChips (mounted only for ≥2 families) pulls next/navigation hooks; these tests keep
// activeFamilies at length < 2 so the chip bar never mounts, isolating the draft-reminder + Tell-a-
// story assertions from the router. The ≥2-families chip-mount gate is not exercised here.
const drafts: SelfDraft[] = [
  { storyId: "d1", kind: "voice", recordedAt: "2026-07-10T12:00:00.000Z" },
  { storyId: "d2", kind: "text", recordedAt: "2026-07-11T12:00:00.000Z" },
];

afterEach(cleanup);

describe("StoriesControls", () => {
  it("shows the draft-reminder button with count + action when there are drafts", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={drafts} />);
    expect(screen.getByText("You have 2 draft stories")).toBeTruthy();
    expect(screen.getByText("finish them")).toBeTruthy();
  });

  it("omits the draft-reminder button when there are no drafts", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={[]} />);
    expect(screen.queryByText("finish them")).toBeNull();
    expect(screen.queryByText(/You have \d+ draft/)).toBeNull();
  });

  it("collapses the resume list by default and expands it on click, one link per draft", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={drafts} />);

    // Collapsed: no resume links in the DOM.
    expect(screen.queryByRole("link", { name: "Finish" })).toBeNull();

    fireEvent.click(screen.getByRole("button"));

    const resumeLinks = screen.getAllByRole("link", { name: "Finish" });
    expect(resumeLinks).toHaveLength(2);
    expect(resumeLinks[0]?.getAttribute("href")).toBe("/hub/tell/d1");
    expect(resumeLinks[1]?.getAttribute("href")).toBe("/hub/tell/d2");
  });

  it("flips aria-expanded false→true on the draft-reminder button when clicked", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={drafts} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("points the Tell a story link at /hub/tell", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={[]} />);
    const tell = screen.getByRole("link", { name: "Tell a story" });
    expect(tell.getAttribute("href")).toBe("/hub/tell");
  });

  // #138 — compact intake reminder button replaces the former full-width banner.
  it("shows the compact intake reminder linking to /hub/about-you when intake is incomplete", () => {
    render(
      <StoriesControls
        activeFamilies={[]}
        selected="all"
        selfDrafts={[]}
        intakeIncomplete
      />,
    );
    const intake = screen.getByRole("link", { name: hub.intake.aria });
    expect(intake.getAttribute("href")).toBe("/hub/about-you");
    expect(screen.getByText(hub.intake.reminderTop)).toBeTruthy();
  });

  it("omits the intake reminder when intake is complete (default)", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={[]} />);
    expect(screen.queryByRole("link", { name: hub.intake.aria })).toBeNull();
  });

  it("shows BOTH reminders beside Tell a story when drafts exist AND intake is incomplete", () => {
    render(
      <StoriesControls
        activeFamilies={[]}
        selected="all"
        selfDrafts={drafts}
        intakeIncomplete
      />,
    );
    // draft reminder (button) + intake reminder (link) + Tell a story (link) all present.
    expect(screen.getByText("You have 2 draft stories")).toBeTruthy();
    expect(screen.getByRole("link", { name: hub.intake.aria })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tell a story" })).toBeTruthy();
  });
});
