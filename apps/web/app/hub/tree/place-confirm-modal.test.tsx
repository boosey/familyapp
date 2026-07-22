// @vitest-environment jsdom
/**
 * PlaceConfirmModal (#286) — shared confirm for tray New person (mint) + unplaced link.
 * Covers grilled fields, kin-options gate, and partner→kids offer (never silent).
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlaceConfirmModal } from "./place-confirm-modal";
import type { MintPlacement } from "./placement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { listPersonKinOptionsAction } = vi.hoisted(() => ({
  listPersonKinOptionsAction: vi.fn(async () => ({
    ok: true as const,
    partners: [] as { id: string; name: string }[],
    children: [] as { id: string; name: string }[],
  })),
}));
vi.mock("./actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions")>();
  return { ...actual, listPersonKinOptionsAction };
});

afterEach(() => {
  cleanup();
  listPersonKinOptionsAction.mockReset();
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
    partners: [],
    children: [],
  }));
});

const fetchAnchors = vi.fn(async () => ({
  ok: true as const,
  persons: [
    { personId: "self", displayName: "You" },
    { personId: "elena", displayName: "Elena" },
  ],
}));

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

it("New person mint opens shared modal with unlocked receiver, relation, and nature (#286/#318)", async () => {
  const onMint = vi.fn(async (_p: MintPlacement) => ({ ok: true as const }));
  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "mint" }}
      receiverLocked={false}
      onMint={onMint}
      onFetchAnchors={fetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );

  expect(screen.getByTestId("place-confirm-modal")).toBeTruthy();
  await flush();
  await flush();

  expect(screen.getByTestId("place-confirm-name")).toBeTruthy();
  const receiver = screen.getByTestId("place-confirm-receiver") as HTMLSelectElement;
  expect(receiver.tagName).toBe("SELECT");
  fireEvent.change(screen.getByTestId("place-confirm-relation"), { target: { value: "child" } });
  expect(screen.getByTestId("place-confirm-nature")).toBeTruthy();

  fireEvent.change(screen.getByTestId("place-confirm-name"), { target: { value: "Ada" } });
  fireEvent.change(receiver, { target: { value: "elena" } });
  await flush();

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });

  expect(onMint).toHaveBeenCalledTimes(1);
  const placement = onMint.mock.calls[0]![0];
  expect(placement).toMatchObject({
    kind: "mint",
    familyId: "F",
    displayName: "Ada",
    receiverPersonId: "elena",
    relation: "child",
    nature: "biological",
  });
});

it("locked receiver (zone/kebab path) shows read-only receiver name (#286)", async () => {
  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "mint" }}
      receiver={{ personId: "elena", displayName: "Elena" }}
      receiverLocked
      partners={[]}
      children={[]}
      initialRelation="partner"
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );

  const receiver = screen.getByTestId("place-confirm-receiver");
  expect(receiver.tagName).not.toBe("SELECT");
  expect(receiver.textContent).toMatch(/Elena/);
  expect((screen.getByTestId("place-confirm-relation") as HTMLSelectElement).value).toBe("partner");
});

it("unplaced link with co-parents and editable nature (#286)", async () => {
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
    partners: [{ id: "p2", name: "Partner Two" }],
    children: [],
  }));
  const onLink = vi.fn(async () => ({ ok: true as const }));

  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      receiverLocked={false}
      onLink={onLink}
      onFetchAnchors={fetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );

  await flush();
  await flush();

  expect(screen.getByTestId("place-confirm-subject").textContent).toMatch(/Rosa/);
  fireEvent.change(screen.getByTestId("place-confirm-relation"), { target: { value: "child" } });
  expect(screen.getByTestId("place-confirm-coparents")).toBeTruthy();
  fireEvent.click(screen.getByTestId("place-confirm-coparent-p2"));
  fireEvent.change(screen.getByTestId("place-confirm-nature"), { target: { value: "adoptive" } });

  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });

  expect(onLink).toHaveBeenCalledWith("F", "u1", "child", "self", "p2", {
    coParentPersonIds: ["p2"],
    nature: "adoptive",
    stepParentOfChildIds: undefined,
  });
});

it("partner→kids offer waits for kin options then never silent-writes (#286)", async () => {
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
    partners: [],
    children: [
      { id: "kid-1", name: "Kid One" },
      { id: "kid-2", name: "Kid Two" },
    ],
  }));
  const onLink = vi.fn(async () => ({ ok: true as const }));

  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      onLink={onLink}
      onFetchAnchors={fetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
  await flush();
  await flush();

  fireEvent.change(screen.getByTestId("place-confirm-relation"), { target: { value: "partner" } });
  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });
  expect(onLink).not.toHaveBeenCalled();
  expect(screen.getByTestId("place-confirm-step-offer")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByTestId("place-confirm-step-child-kid-2"));
  });
  await act(async () => {
    fireEvent.click(screen.getByTestId("place-confirm-step-confirm"));
  });

  expect(onLink).toHaveBeenCalledWith("F", "u1", "partner", "self", undefined, {
    coParentPersonIds: undefined,
    nature: undefined,
    stepParentOfChildIds: ["kid-1"],
  });
});

it("partner→kids skip commits explicit empty stepParentOfChildIds (#318 offer-never-silent)", async () => {
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: true as const,
    partners: [],
    children: [{ id: "kid-1", name: "Kid One" }],
  }));
  const onLink = vi.fn(async () => ({ ok: true as const }));

  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      onLink={onLink}
      onFetchAnchors={fetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
  await flush();
  await flush();

  fireEvent.change(screen.getByTestId("place-confirm-relation"), { target: { value: "partner" } });
  await act(async () => {
    fireEvent.submit(screen.getByTestId("place-confirm-submit").closest("form")!);
  });
  expect(onLink).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByTestId("place-confirm-step-skip"));
  });

  expect(onLink).toHaveBeenCalledWith("F", "u1", "partner", "self", undefined, {
    coParentPersonIds: undefined,
    nature: undefined,
    stepParentOfChildIds: [],
  });
});

it("kin-options reject keeps submit disabled (#285/#286)", async () => {
  listPersonKinOptionsAction.mockImplementation(async () => ({
    ok: false as const,
    error: "failed" as const,
  }) as never);
  const onLink = vi.fn(async () => ({ ok: true as const }));

  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      onLink={onLink}
      onFetchAnchors={fetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
  await flush();
  await flush();

  const submit = screen.getByTestId("place-confirm-submit") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(screen.getByTestId("place-confirm-error").textContent).toMatch(/Couldn't do that/i);
  expect(onLink).not.toHaveBeenCalled();
});

it("re-render with new subject object identity does not refetch or reset receiver (#286)", async () => {
  const onFetchAnchors = vi.fn(async () => ({
    ok: true as const,
    persons: [
      { personId: "self", displayName: "You" },
      { personId: "elena", displayName: "Elena" },
    ],
  }));

  const { rerender } = render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      onFetchAnchors={onFetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
  await flush();
  await flush();

  expect(onFetchAnchors).toHaveBeenCalledTimes(1);
  const receiver = screen.getByTestId("place-confirm-receiver") as HTMLSelectElement;
  fireEvent.change(receiver, { target: { value: "elena" } });
  expect(receiver.value).toBe("elena");

  rerender(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "link", personId: "u1", displayName: "Rosa" }}
      onFetchAnchors={onFetchAnchors}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );
  await flush();

  expect(onFetchAnchors).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("place-confirm-loading-anchors")).toBeNull();
  expect((screen.getByTestId("place-confirm-receiver") as HTMLSelectElement).value).toBe("elena");
});

it("partners-only seed keeps submit disabled until kin fetch completes (#286)", async () => {
  let resolveKin!: (value: {
    ok: true;
    partners: { id: string; name: string }[];
    children: { id: string; name: string }[];
  }) => void;
  const kinPromise = new Promise<{
    ok: true;
    partners: { id: string; name: string }[];
    children: { id: string; name: string }[];
  }>((resolve) => {
    resolveKin = resolve;
  });
  const onFetchKin = vi.fn(() => kinPromise);

  render(
    <PlaceConfirmModal
      familyId="F"
      subject={{ kind: "mint" }}
      receiver={{ personId: "elena", displayName: "Elena" }}
      receiverLocked
      partners={[{ id: "p2", name: "Partner Two" }]}
      onFetchKinOptions={onFetchKin}
      onClose={() => {}}
      onSuccess={() => {}}
    />,
  );

  // Partial seed (partners only) must NOT mark kin ready — submit stays gated.
  const submit = screen.getByTestId("place-confirm-submit") as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  expect(onFetchKin).toHaveBeenCalledWith("F", "elena");

  await act(async () => {
    resolveKin({
      ok: true,
      partners: [{ id: "p2", name: "Partner Two" }],
      children: [{ id: "kid-1", name: "Kid One" }],
    });
    await kinPromise;
  });
  await flush();

  expect((screen.getByTestId("place-confirm-submit") as HTMLButtonElement).disabled).toBe(false);
});
