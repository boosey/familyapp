// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
vi.mock("../app/hub/stories/[id]/actions", () => ({ deleteStoryAction: vi.fn(async () => undefined) }));
import { OwnerActionMenu } from "@/app/hub/stories/[id]/OwnerActionMenu";

afterEach(cleanup);

it("shows Edit story, Add photos, Manage sharing, Delete — and NOT Edit details", () => {
  const { getByText, queryByText, getByLabelText } = render(
    <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={vi.fn()} onManageSharing={vi.fn()} />,
  );
  fireEvent.click(getByLabelText(/story options/i));
  expect(getByText(/edit story/i)).toBeTruthy();
  expect(getByText(/add photos/i)).toBeTruthy();
  expect(getByText(/manage sharing/i)).toBeTruthy();
  expect(getByText(/delete story/i)).toBeTruthy();
  expect(queryByText(/edit details/i)).toBeNull();
});

it("Add photos fires onAddPhotos", () => {
  const onAddPhotos = vi.fn();
  const { getByText, getByLabelText } = render(
    <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={onAddPhotos} onManageSharing={vi.fn()} />,
  );
  fireEvent.click(getByLabelText(/story options/i));
  fireEvent.click(getByText(/add photos/i));
  expect(onAddPhotos).toHaveBeenCalled();
});

it("renders absolutely nothing when isOwner is false", () => {
  const { container } = render(
    <OwnerActionMenu storyId="S" isOwner={false} onEditStory={vi.fn()} onAddPhotos={vi.fn()} onManageSharing={vi.fn()} />,
  );
  expect(container.firstChild).toBeNull();
});

it("renders the menu trigger with aria-haspopup when isOwner is true", () => {
  const { getByLabelText } = render(
    <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={vi.fn()} onManageSharing={vi.fn()} />,
  );
  const trigger = getByLabelText("Story options");
  expect(trigger).toBeTruthy();
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
});

it("opens the menu on clicking the trigger (aria-expanded true), and Escape closes it", () => {
  const { getByLabelText, getByRole, queryByRole } = render(
    <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={vi.fn()} onManageSharing={vi.fn()} />,
  );
  const trigger = getByLabelText("Story options");

  expect(queryByRole("menu")).toBeNull();

  fireEvent.click(trigger);
  expect(getByRole("menu")).toBeTruthy();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

  fireEvent.keyDown(document, { key: "Escape" });
  expect(queryByRole("menu")).toBeNull();
});

it("closes the menu on clicking outside", () => {
  const { getByLabelText, getByRole, queryByRole, getByTestId } = render(
    <div>
      <div data-testid="outside">Outside Element</div>
      <OwnerActionMenu storyId="S" isOwner onEditStory={vi.fn()} onAddPhotos={vi.fn()} onManageSharing={vi.fn()} />
    </div>,
  );
  const trigger = getByLabelText("Story options");

  fireEvent.click(trigger);
  expect(getByRole("menu")).toBeTruthy();

  fireEvent.pointerDown(getByTestId("outside"));
  expect(queryByRole("menu")).toBeNull();
});
