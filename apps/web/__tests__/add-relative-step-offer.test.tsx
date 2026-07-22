// @vitest-environment jsdom
/**
 * #285 / #318 / ADR-0027 — partner add must prompt for step parent-of to existing kids before write
 * (never silent). Declining writes partner-only. Mint goes through typed Placement.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MintPlacement } from "@/app/hub/tree/placement";
import { AddRelativeForm } from "@/app/hub/kin/add-relative-form";

afterEach(() => {
  cleanup();
});

const KIDS = [
  { id: "kid-1", name: "Kid One" },
  { id: "kid-2", name: "Kid Two" },
];

it("pauses on partner submit to offer step parent-of when the anchor has children", async () => {
  const onMint = vi.fn(async () => ({ ok: true as const }));
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
      onMint={onMint}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });

  expect(screen.getByTestId("add-relative-step-offer")).toBeTruthy();
  expect(onMint).not.toHaveBeenCalled();
});

it("Continue forwards checked kids as stepParentOfChildIds on typed MintPlacement", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
      onMint={onMint}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-confirm"));
  });

  expect(onMint).toHaveBeenCalledTimes(1);
  const placement = onMint.mock.calls[0]![0];
  expect(placement.kind).toBe("mint");
  expect(placement.relation).toBe("partner");
  expect(placement.receiverPersonId).toBe("anchor");
  expect(placement.stepParentOfChildIds).toEqual(["kid-1"]);
});

it("Partner only skips step parent-of (explicit empty stepParentOfChildIds)", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={KIDS}
      onMint={onMint}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-skip"));
  });

  expect(onMint).toHaveBeenCalledTimes(1);
  expect(onMint.mock.calls[0]![0].stepParentOfChildIds).toEqual([]);
});

it("does not prompt when the anchor has no children", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="anchor"
      initialRelation="partner"
      childOptions={[]}
      onMint={onMint}
    />,
  );

  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add relative/i }).closest("form")!);
  });

  expect(screen.queryByTestId("add-relative-step-offer")).toBeNull();
  expect(onMint).toHaveBeenCalledTimes(1);
  expect(onMint.mock.calls[0]![0].stepParentOfChildIds).toBeUndefined();
});
