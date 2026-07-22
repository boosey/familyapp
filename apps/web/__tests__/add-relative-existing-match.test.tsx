// @vitest-environment jsdom
/**
 * #251 — add-relative offers connect-existing when the typed name matches an unplaced member,
 * instead of silently minting a duplicate. "Add as someone new" mints via typed Placement (#318).
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UnplacedMember } from "@chronicle/core";
import type { MintPlacement } from "@/app/hub/tree/placement";
import { AddRelativeForm } from "@/app/hub/tree/add-relative-form";

afterEach(() => {
  cleanup();
});

const UNPLACED: UnplacedMember[] = [
  { personId: "kelly", displayName: "Kelly Boudreaux", role: "member" },
];

it("offers connect-existing when the typed name matches an unplaced member (#251)", async () => {
  const onSuccess = vi.fn();
  const onMint = vi.fn(async () => ({ ok: true as const }));
  const onLinkExisting = vi.fn(async () => ({ ok: true as const }));
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={onLinkExisting}
      onMint={onMint}
      onSuccess={onSuccess}
    />,
  );

  const name = container.querySelector('input[name="displayName"]') as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Kelly Boudreaux" } });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  expect(onMint).not.toHaveBeenCalled();
  expect(screen.getByTestId("add-relative-existing-match")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-use-existing"));
  });

  expect(onLinkExisting).toHaveBeenCalledWith(
    "fam-1",
    "kelly",
    "partner",
    "john",
    undefined,
    {
      coParentPersonIds: undefined,
      stepParentOfChildIds: undefined,
      nature: undefined,
    },
  );
  expect(onSuccess).toHaveBeenCalled();
  expect(onMint).not.toHaveBeenCalled();
});

it("Add as someone new mints via typed MintPlacement (#251/#318)", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  const onLinkExisting = vi.fn(async () => ({ ok: true as const }));
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={onLinkExisting}
      onMint={onMint}
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

  expect(onLinkExisting).not.toHaveBeenCalled();
  expect(onMint).toHaveBeenCalledTimes(1);
  const placement = onMint.mock.calls[0]![0];
  expect(placement.kind).toBe("mint");
  expect(placement.displayName).toBe("Kelly Boudreaux");
  expect(placement.relation).toBe("partner");
  expect(placement.receiverPersonId).toBe("john");
});

it("mints immediately when the name does not match an unplaced member", async () => {
  const onMint = vi.fn(async () => ({ ok: true as const }));
  const onLinkExisting = vi.fn(async () => ({ ok: true as const }));
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      unplacedMembers={UNPLACED}
      onLinkExisting={onLinkExisting}
      onMint={onMint}
    />,
  );

  fireEvent.change(container.querySelector('input[name="displayName"]') as HTMLInputElement, {
    target: { value: "Someone Else" },
  });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  expect(screen.queryByTestId("add-relative-existing-match")).toBeNull();
  expect(onMint).toHaveBeenCalledTimes(1);
  expect(onLinkExisting).not.toHaveBeenCalled();
});

it("connect-existing for partner with childOptions shows step offer before link (#285)", async () => {
  const onSuccess = vi.fn();
  const onMint = vi.fn(async () => ({ ok: true as const }));
  const onLinkExisting = vi.fn(async () => ({ ok: true as const }));
  const kids = [
    { id: "kid-1", name: "Kid One" },
    { id: "kid-2", name: "Kid Two" },
  ];
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      childOptions={kids}
      unplacedMembers={UNPLACED}
      onLinkExisting={onLinkExisting}
      onMint={onMint}
      onSuccess={onSuccess}
    />,
  );

  fireEvent.change(container.querySelector('input[name="displayName"]') as HTMLInputElement, {
    target: { value: "Kelly Boudreaux" },
  });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });

  expect(screen.getByTestId("add-relative-existing-match")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-use-existing"));
  });

  expect(onLinkExisting).not.toHaveBeenCalled();
  expect(screen.getByTestId("add-relative-step-offer")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-confirm"));
  });

  expect(onLinkExisting).toHaveBeenCalledWith(
    "fam-1",
    "kelly",
    "partner",
    "john",
    undefined,
    {
      coParentPersonIds: undefined,
      stepParentOfChildIds: ["kid-1"],
      nature: undefined,
    },
  );
  expect(onSuccess).toHaveBeenCalled();
  expect(onMint).not.toHaveBeenCalled();
});

it("connect-existing partner step skip links partner-only with explicit empty ids (#285/#318)", async () => {
  const kids = [{ id: "kid-1", name: "Kid One" }];
  const onMint = vi.fn(async () => ({ ok: true as const }));
  const onLinkExisting = vi.fn(async () => ({ ok: true as const }));
  const { container } = render(
    <AddRelativeForm
      familyId="fam-1"
      anchorPersonId="john"
      initialRelation="partner"
      childOptions={kids}
      unplacedMembers={UNPLACED}
      onLinkExisting={onLinkExisting}
      onMint={onMint}
    />,
  );

  fireEvent.change(container.querySelector('input[name="displayName"]') as HTMLInputElement, {
    target: { value: "Kelly Boudreaux" },
  });

  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-use-existing"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("add-relative-step-skip"));
  });

  expect(onLinkExisting).toHaveBeenCalledWith(
    "fam-1",
    "kelly",
    "partner",
    "john",
    undefined,
    {
      coParentPersonIds: undefined,
      stepParentOfChildIds: [],
      nature: undefined,
    },
  );
});
