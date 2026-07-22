// @vitest-environment jsdom
/**
 * #285 / ADR-0027 — partner add must prompt for step parent-of to existing kids before write
 * (never silent). Declining writes partner-only.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { addRelativeAction } = vi.hoisted(() => ({
  addRelativeAction: vi.fn(async (_formData: FormData) => undefined),
}));
vi.mock("../app/hub/kin/actions", () => ({ addRelativeAction }));

import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";

afterEach(() => {
  cleanup();
  addRelativeAction.mockClear();
});

const KIDS = [
  { id: "kid-1", name: "Kid One" },
  { id: "kid-2", name: "Kid Two" },
];

it("pauses on partner submit to offer step parent-of when the anchor has children", async () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });

  expect(screen.getByTestId("add-relative-step-offer")).toBeTruthy();
  expect(addRelativeAction).not.toHaveBeenCalled();
});

it("Continue forwards checked kids as stepParentOfChildIds", async () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });
  // Uncheck kid-2
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-confirm"));
  });

  expect(addRelativeAction).toHaveBeenCalledTimes(1);
  const fd = addRelativeAction.mock.calls[0]![0] as FormData;
  expect(fd.getAll("stepParentOfChildIds")).toEqual(["kid-1"]);
});

it("Partner only skips step parent-of (empty stepParentOfChildIds)", async () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-skip"));
  });

  expect(addRelativeAction).toHaveBeenCalledTimes(1);
  const fd = addRelativeAction.mock.calls[0]![0] as FormData;
  expect(fd.getAll("stepParentOfChildIds")).toEqual([]);
});

it("does not prompt when the anchor has no children", async () => {
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={[]}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });

  expect(screen.queryByTestId("add-relative-step-offer")).toBeNull();
  expect(addRelativeAction).toHaveBeenCalledTimes(1);
});
