// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoriesControls, type SelfDraft } from "./StoriesControls";

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

  it("only sets aria-controls once the controlled list is actually rendered", () => {
    // Collapsed: the <ul> the id points at isn't in the DOM, so aria-controls must be absent to
    // avoid dangling to a non-existent element.
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={drafts} />);
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-controls")).toBeNull();

    fireEvent.click(button);
    const listId = button.getAttribute("aria-controls");
    expect(listId).toBeTruthy();
    // The referenced element exists.
    expect(document.getElementById(listId!)).not.toBeNull();
  });

  it("describes each resume link by its own date meta so duplicates are distinguishable", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={drafts} />);
    fireEvent.click(screen.getByRole("button"));

    const resumeLinks = screen.getAllByRole("link", { name: "Finish" });
    for (const link of resumeLinks) {
      const describedBy = link.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      // The meta element it points at exists and is the sibling date span.
      expect(document.getElementById(describedBy!)).not.toBeNull();
    }
    // The two links reference DIFFERENT meta ids (per-draft, not a shared one).
    expect(resumeLinks[0]?.getAttribute("aria-describedby")).not.toBe(
      resumeLinks[1]?.getAttribute("aria-describedby"),
    );
  });

  it("points the Tell a story link at /hub/tell", () => {
    render(<StoriesControls activeFamilies={[]} selected="all" selfDrafts={[]} />);
    const tell = screen.getByRole("link", { name: "Tell a story" });
    expect(tell.getAttribute("href")).toBe("/hub/tell");
  });
});
