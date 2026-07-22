/**
 * addRelativeAction — honors an optional `?anchor=` (Task 7): a submitted `anchorPersonId` is forwarded
 * to core's `addRelative` so the add is targeted at that person; omitting it (empty/absent) forwards NO
 * anchor (core then defaults to the viewer). The core call + runtime are mocked at the module boundary
 * (matching tree-page.test.tsx / the other `@chronicle/core`-mocking web tests) so this stays a pure
 * unit test of the action's parse-and-forward wiring.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const getCurrentAuthContext = vi.fn();
const listActiveFamiliesForPerson = vi.fn();
const addRelative = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: {}, auth: { getCurrentAuthContext } }),
}));
vi.mock("@chronicle/core", async () => {
  const actual = await vi.importActual<typeof import("@chronicle/core")>("@chronicle/core");
  return {
    ...actual,
    listActiveFamiliesForPerson: (...a: unknown[]) => listActiveFamiliesForPerson(...a),
    addRelative: (...a: unknown[]) => addRelative(...a),
  };
});

import { addRelativeAction } from "@/app/hub/tree/kin-actions";

const FAMILY_ID = "fam-1";

function baseForm(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("familyId", FAMILY_ID);
  fd.set("relation", "parent");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: "viewer-1" });
  listActiveFamiliesForPerson.mockResolvedValue([{ familyId: FAMILY_ID }]);
  addRelative.mockResolvedValue({ allowed: true, createdPersonId: "p-new" });
});

afterEach(() => {
  vi.clearAllMocks();
});

it("forwards anchorPersonId to addRelative when the form carries one", async () => {
  const result = await addRelativeAction(baseForm({ anchorPersonId: "p-123" }));

  expect(result).toBeUndefined();
  expect(addRelative).toHaveBeenCalledTimes(1);
  const input = addRelative.mock.calls[0]![2] as { anchorPersonId?: string };
  expect(input.anchorPersonId).toBe("p-123");
});

it("does NOT forward an anchor when the field is absent", async () => {
  await addRelativeAction(baseForm());

  expect(addRelative).toHaveBeenCalledTimes(1);
  const input = addRelative.mock.calls[0]![2] as { anchorPersonId?: string };
  expect(input.anchorPersonId).toBeUndefined();
  expect("anchorPersonId" in input).toBe(false);
});

it("does NOT forward an anchor when the field is blank/whitespace", async () => {
  await addRelativeAction(baseForm({ anchorPersonId: "   " }));

  expect(addRelative).toHaveBeenCalledTimes(1);
  const input = addRelative.mock.calls[0]![2] as { anchorPersonId?: string };
  expect(input.anchorPersonId).toBeUndefined();
  expect("anchorPersonId" in input).toBe(false);
});
