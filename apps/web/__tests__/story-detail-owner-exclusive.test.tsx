// @vitest-environment jsdom
//
// Regression test for the silent-revoke bug: StoryEditor and the Manage-Sharing overlay are two
// independent owner-only surfaces that both mutate the story's family-target set from
// independent local snapshots (both POST the full set). If both can be open at once, whichever
// submits last silently clobbers/reverts families added by the other. The fix makes them
// mutually exclusive by disabling the OwnerActionMenu kebab while either surface is open, so a
// second surface can never be opened concurrently. This test guards that a `disabled`
// OwnerActionMenu cannot be used to invoke any menu item (in particular "Edit story" / "Manage
// sharing"), and that the menu behaves normally when not disabled.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
vi.mock("../app/hub/stories/[id]/actions", () => ({ deleteStoryAction: vi.fn(async () => undefined) }));
import { OwnerActionMenu } from "@/app/hub/stories/[id]/OwnerActionMenu";

afterEach(cleanup);

it("disabled=true: trigger is disabled and clicking it does not reveal menu items", () => {
  const onEditStory = vi.fn();
  const onManageSharing = vi.fn();
  const { getByLabelText, queryByText, queryByRole } = render(
    <OwnerActionMenu
      storyId="S"
      isOwner
      disabled
      onEditStory={onEditStory}
      onAddPhotos={vi.fn()}
      onManageSharing={onManageSharing}
    />,
  );
  const trigger = getByLabelText(/story options/i) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);

  fireEvent.click(trigger);

  expect(queryByRole("menu")).toBeNull();
  expect(queryByText(/edit story/i)).toBeNull();
  expect(queryByText(/manage sharing/i)).toBeNull();
  expect(onEditStory).not.toHaveBeenCalled();
  expect(onManageSharing).not.toHaveBeenCalled();
});

it("disabled=false: the menu opens normally and items are reachable", () => {
  const { getByLabelText, getByText, getByRole } = render(
    <OwnerActionMenu
      storyId="S"
      isOwner
      disabled={false}
      onEditStory={vi.fn()}
      onAddPhotos={vi.fn()}
      onManageSharing={vi.fn()}
    />,
  );
  const trigger = getByLabelText(/story options/i) as HTMLButtonElement;
  expect(trigger.disabled).toBe(false);

  fireEvent.click(trigger);

  expect(getByRole("menu")).toBeTruthy();
  expect(getByText(/edit story/i)).toBeTruthy();
  expect(getByText(/manage sharing/i)).toBeTruthy();
});
