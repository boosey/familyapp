// @vitest-environment jsdom
/**
 * #251 — add-relative offers connect-existing when the typed name matches an unplaced member,
 * instead of silently minting a duplicate. "Add as someone new" still calls addRelativeAction.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UnplacedMember } from "@chronicle/core";

const { addRelativeAction, linkExistingMemberAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
  linkExistingMemberAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../app/hub/kin/actions", () => ({ addRelativeAction }));
vi.mock("../app/hub/tree/actions", () => ({
  linkExistingMemberAction,
}));

import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
  linkExistingMemberAction.mockClear();
});

const UNPLACED: UnplacedMember[] = [
  { personId: "kelly", displayName: "Kelly Boudreaux", role: "member" },
];

it("offers connect-existing when the typed name matches an unplaced member (#251)", async () => {
  const onSuccess = vi.fn();
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={linkExistingMemberAction}
      onSuccess={onSuccess}
    />,
  );

  const name = container.querySelector('input[name="displayName"]') as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Kelly Boudreaux" } });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  expect(addRelativeAction).not.toHaveBeenCalled();
  expect(screen.getByTestId("add-relative-existing-match")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-use-existing"));
  });

  expect(linkExistingMemberAction).toHaveBeenCalledWith(
    "fam-1",
    "kelly",
    "partner",
    "john",
    undefined,
  );
  expect(onSuccess).toHaveBeenCalled();
  expect(addRelativeAction).not.toHaveBeenCalled();
});

it("Add as someone new still mints via addRelativeAction (#251)", async () => {
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={linkExistingMemberAction}
    />,
  );

  fireEvent.change(container.querySelector('input[name="displayName"]') as HTMLInputElement, {
    target: { value: "Kelly Boudreaux" },
  });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-create-new"));
  });

  expect(linkExistingMemberAction).not.toHaveBeenCalled();
  expect(addRelativeAction).toHaveBeenCalledTimes(1);
  const fd = addRelativeAction.mock.calls[0]![0] as FormData;
  expect(fd.get("displayName")).toBe("Kelly Boudreaux");
  expect(fd.get("relation")).toBe("partner");
});

it("mints immediately when the name does not match an unplaced member", async () => {
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={linkExistingMemberAction}
    />,
  );

  fireEvent.change(container.querySelector('input[name="displayName"]') as HTMLInputElement, {
    target: { value: "Someone Else" },
  });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  expect(screen.queryByTestId("add-relative-existing-match")).toBeNull();
  expect(addRelativeAction).toHaveBeenCalledTimes(1);
  expect(linkExistingMemberAction).not.toHaveBeenCalled();
});
