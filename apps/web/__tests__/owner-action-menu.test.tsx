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
