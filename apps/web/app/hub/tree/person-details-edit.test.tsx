// @vitest-environment jsdom
/**
 * Tree Slice C (ADR-0021) — details-sheet EDIT mode component tests.
 *
 * The auth PREDICATE is tested exhaustively in packages/core; here we verify the SHEET's behavior
 * given the server-projected `editable` flag (injected via the `checkEditable`/`saveEdit` seams):
 *   1. Edit button shows ONLY when the server says editable; hidden otherwise.
 *   2. Editing → Save calls the save action with the typed patch, then onSaved fires.
 *   3. #5: an UNKNOWN (nameless) card opens directly in edit mode when editable.
 *   4. #5: an UNKNOWN card that is NOT editable opens read-only (no Edit, no form).
 *   5. A server "not-allowed" save result surfaces an inline error (defense-in-depth is server-side).
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TreeNode } from "@chronicle/core";
import { hub } from "@/app/_copy";
import { PersonDetails } from "./person-details";
import type { PersonEditabilityResult, SavePersonEditResult } from "./actions";

afterEach(cleanup);

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? null,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: false,
    hasHiddenChildren: false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
    membership: over.membership ?? "tree-only",
    isSteward: over.isSteward ?? false,
  };
}

const editableYes = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: true });
const editableNo = async (): Promise<PersonEditabilityResult> => ({ ok: true, editable: false });
const saveOk = async (): Promise<SavePersonEditResult> => ({ ok: true });

it("shows the Edit button only when the server says editable", async () => {
  const { unmount } = render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableYes}
      saveEdit={saveOk}
    />,
  );
  expect(await screen.findByTestId("tree-details-edit")).toBeTruthy();
  unmount();

  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableNo}
      saveEdit={saveOk}
    />,
  );
  // Give the (resolved-not-editable) probe a tick; the button must never appear.
  await waitFor(() => expect(screen.queryByTestId("tree-details-edit")).toBeNull());
});

it("Save sends the typed patch to the save action and fires onSaved", async () => {
  const saveEdit = vi.fn(
    async (
      _familyId: string,
      _personId: string,
      _patch: unknown,
    ): Promise<SavePersonEditResult> => ({ ok: true }),
  );
  const onSaved = vi.fn();
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice", birthYear: 1950 })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      onSaved={onSaved}
      checkEditable={editableYes}
      saveEdit={saveEdit}
    />,
  );
  fireEvent.click(await screen.findByTestId("tree-details-edit"));

  const nameInput = screen.getByTestId("tree-edit-name") as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "Alice B. Cooper" } });
  fireEvent.change(screen.getByTestId("tree-edit-sex"), { target: { value: "female" } });
  fireEvent.click(screen.getByTestId("tree-edit-save"));

  await waitFor(() => expect(saveEdit).toHaveBeenCalledTimes(1));
  const [familyId, personId, patch] = saveEdit.mock.calls[0]!;
  expect(familyId).toBe("F");
  expect(personId).toBe("p1");
  expect(patch).toMatchObject({ displayName: "Alice B. Cooper", sex: "female", lifeStatus: "living" });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith("p1"));
});

it("#5 — an UNKNOWN (nameless) card opens directly in edit mode when editable", async () => {
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: null, identified: true })}
      relationToViewer={null}
      familyId="F"
      startInEdit
      onClose={() => {}}
      checkEditable={editableYes}
      saveEdit={saveOk}
    />,
  );
  expect(await screen.findByTestId("tree-person-edit-form")).toBeTruthy();
});

it("#5 — an UNKNOWN card that is NOT editable stays read-only (no form, no Edit)", async () => {
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: null, identified: true })}
      relationToViewer={null}
      familyId="F"
      startInEdit
      onClose={() => {}}
      checkEditable={editableNo}
      saveEdit={saveOk}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId("tree-details-edit")).toBeNull());
  expect(screen.queryByTestId("tree-person-edit-form")).toBeNull();
});

it("remounts with fresh edit state when the keyed person changes (regression: Gemini #1 state pollution)", async () => {
  // The canvas renders <PersonDetails key={node.personId}>. Double-clicking a DIFFERENT card while the
  // sheet is open must discard the previous person's in-progress edits, not save them onto the new one.
  // This reproduces the canvas's keying: enter edit, type a stale value, switch the person in the same
  // slot. With the key the subtree remounts (editing resets, stale value gone); without it, the stale
  // edit-form state would leak onto the new person — which is exactly the bug.
  function Host({ personId, name }: { personId: string; name: string }) {
    return (
      <PersonDetails
        key={personId}
        node={node({ personId, displayName: name, birthYear: 1950 })}
        relationToViewer={null}
        familyId="F"
        onClose={() => {}}
        checkEditable={editableYes}
        saveEdit={saveOk}
      />
    );
  }
  const { rerender } = render(<Host personId="p1" name="Alice" />);
  fireEvent.click(await screen.findByTestId("tree-details-edit"));
  const nameInput = () => screen.getByTestId("tree-edit-name") as HTMLInputElement;
  fireEvent.change(nameInput(), { target: { value: "STALE EDIT" } });
  expect(nameInput().value).toBe("STALE EDIT");

  // Switch to a different person in the same slot — the key change remounts with fresh state.
  rerender(<Host personId="p2" name="Bob" />);
  await waitFor(() => expect(screen.getByTestId("tree-person-details").textContent).toContain("Bob"));
  // The stale in-progress edit is gone (fresh mount is read-only for the new person).
  expect(screen.queryByDisplayValue("STALE EDIT")).toBeNull();
});

it("rejects an invalid year of death instead of silently clearing it (regression: Gemini #3)", async () => {
  // A typo in the death-year field must NOT be coerced NaN→null and saved (which would quietly wipe
  // an existing year of death). It must surface a validation error and write nothing.
  const saveEdit = vi.fn(async (): Promise<SavePersonEditResult> => ({ ok: true }));
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Grandpa", lifeStatus: "deceased", deathYear: 1990 })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableYes}
      saveEdit={saveEdit}
    />,
  );
  fireEvent.click(await screen.findByTestId("tree-details-edit"));
  // A non-integer year is the reachable invalid case for a numeric field (parsedYear → NaN); a number
  // input coerces free-text like "19x0" to "" on its own, so we exercise the NaN path with "19.5".
  fireEvent.change(screen.getByTestId("tree-edit-death-year"), { target: { value: "19.5" } });
  fireEvent.click(screen.getByTestId("tree-edit-save"));

  const err = await screen.findByTestId("tree-edit-error");
  expect(err.textContent).toBe(hub.tree.editErrorDeathDate);
  expect(saveEdit).not.toHaveBeenCalled();
});

it("surfaces an inline error when the server rejects the save (not-allowed)", async () => {
  const saveEdit = async (): Promise<SavePersonEditResult> => ({ ok: false, error: "not-allowed" });
  render(
    <PersonDetails
      node={node({ personId: "p1", displayName: "Alice" })}
      relationToViewer={null}
      familyId="F"
      onClose={() => {}}
      checkEditable={editableYes}
      saveEdit={saveEdit}
    />,
  );
  fireEvent.click(await screen.findByTestId("tree-details-edit"));
  fireEvent.click(screen.getByTestId("tree-edit-save"));
  const err = await screen.findByTestId("tree-edit-error");
  expect(err.textContent).toBe(hub.tree.editErrorNotAllowed);
});
