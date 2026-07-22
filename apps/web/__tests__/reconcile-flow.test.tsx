// @vitest-environment jsdom
/**
 * #337 — ReconcileFlow picker → confirm → action. Maps either start side to mention+account API args.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { ReconcileFlow } from "@/app/hub/kin/reconcile-flow";
import type { ReconcilePersonView } from "@/lib/reconcile-eligibility";

afterEach(cleanup);

function rp(over: Partial<ReconcilePersonView> & { personId: string }): ReconcilePersonView {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    isActiveMember: over.isActiveMember ?? false,
    hasAccount: over.hasAccount ?? false,
    isMention: over.isMention ?? false,
  };
}

const mention = rp({ personId: "mia-mention", displayName: "Mia", isMention: true });
const member = rp({
  personId: "mia-real",
  displayName: "Mia Real",
  isActiveMember: true,
  hasAccount: true,
});

describe("ReconcileFlow (#337)", () => {
  it("from a mention, picks a member and confirms with both names", async () => {
    const onReconcile = vi.fn(async () => ({ ok: true as const, accountPersonId: "mia-real" }));
    const onSuccess = vi.fn();
    render(
      <ReconcileFlow
        familyId="F"
        start={mention}
        pool={[mention, member]}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        onReconcile={onReconcile}
      />,
    );
    expect(screen.getByTestId("reconcile-picker-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("reconcile-candidate-mia-real"));
    expect(screen.getByTestId("reconcile-confirm-modal")).toBeTruthy();
    expect(screen.getByTestId("reconcile-confirm-body").textContent).toContain("Mia");
    expect(screen.getByTestId("reconcile-confirm-body").textContent).toContain("Mia Real");
    fireEvent.click(screen.getByTestId("reconcile-confirm-submit"));
    await waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(1));
    expect(onReconcile).toHaveBeenCalledWith({
      familyId: "F",
      mentionPersonId: "mia-mention",
      accountPersonId: "mia-real",
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("mia-real"));
  });

  it("from a member, maps the picked mention to the same API args", async () => {
    const onReconcile = vi.fn(async () => ({ ok: true as const, accountPersonId: "mia-real" }));
    render(
      <ReconcileFlow
        familyId="F"
        start={member}
        pool={[mention, member]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onReconcile={onReconcile}
      />,
    );
    fireEvent.click(screen.getByTestId("reconcile-candidate-mia-mention"));
    fireEvent.click(screen.getByTestId("reconcile-confirm-submit"));
    await waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(1));
    expect(onReconcile).toHaveBeenCalledWith({
      familyId: "F",
      mentionPersonId: "mia-mention",
      accountPersonId: "mia-real",
    });
  });

  it("surfaces an action error on the confirm step", async () => {
    const onReconcile = vi.fn(async () => ({ ok: false as const, error: hub.reconcile.failed }));
    render(
      <ReconcileFlow
        familyId="F"
        start={mention}
        pool={[mention, member]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onReconcile={onReconcile}
      />,
    );
    fireEvent.click(screen.getByTestId("reconcile-candidate-mia-real"));
    fireEvent.click(screen.getByTestId("reconcile-confirm-submit"));
    await waitFor(() => expect(screen.getByTestId("reconcile-error")).toBeTruthy());
    expect(screen.getByTestId("reconcile-error").textContent).toBe(hub.reconcile.failed);
  });
});
