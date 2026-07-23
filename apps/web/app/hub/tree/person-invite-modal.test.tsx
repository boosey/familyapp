// @vitest-environment jsdom
/**
 * PersonInviteModal (#334, ADR-0028) — component-level tests for the in-place, person-bound Invite
 * modal shared by Tree's details sheet + kebab and List's details. `fetchTargets`/`submitInvite` are
 * injected fakes (mirrors how `TreeCanvas` injects `fetchSubtree` elsewhere) so these tests never touch
 * the real DB/auth context — the server actions themselves are exercised separately (integration-style)
 * via `person-invite-targets.test.ts`'s pure `resolvePersonInviteFamilies`.
 *
 *   1. Loading → resolved targets: family chips reflect the SERVER-PREPARED (already-filtered) set,
 *      with the single-eligible-family auto-seed honored, and name/email/phone prefilled.
 *   2. Zero eligible families → the "already a member everywhere" message, no form.
 *   3. A load failure → the load-error message, no form.
 *   4. Submit success → the ready-to-share link renders and Done closes the modal WITHOUT going through
 *      any parent-details state — the modal owns only its own close.
 *   5. Submit error → an inline error renders and the form stays mounted (no dead end).
 *   6. The × close button and Escape both call `onClose`.
 *   7. Copy: heading uses `hub.personInvite.heading(name)`, falling back to `fallbackName` while loading.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { PersonInviteModal } from "./PersonInviteModal";
import type { PersonInviteFormState, PersonInviteTargets, PersonInviteTargetsResult } from "./person-invite-actions";

afterEach(cleanup);

function targets(over: Partial<PersonInviteTargets> = {}): PersonInviteTargets {
  return {
    families: over.families ?? [{ id: "fam-1", name: "The Riccis", shortName: null }],
    // `"seededFamilyId" in over` (not `??`) because `null` is a meaningful, deliberately-passed value
    // here (no seed) — `??` would wrongly fall back to the default whenever a test passes `null`.
    seededFamilyId: "seededFamilyId" in over ? (over.seededFamilyId ?? null) : "fam-1",
    displayName: over.displayName ?? "Elena Ricci",
    email: over.email ?? "",
    phone: over.phone ?? "",
  };
}

function neverSubmits(): Promise<PersonInviteFormState> {
  // Only used by tests that never click a submit button — kept distinct from a resolved fake so an
  // accidental submit surfaces as an unhandled/never-resolved promise instead of silently passing.
  return new Promise(() => {});
}

/* ── 1. Resolved targets: chips + seed + prefill ────────────────────────────── */

it("renders the family chips from the server-prepared (already-filtered) set, seeded when exactly one remains", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({
    ok: true,
    data: targets({
      families: [{ id: "fam-1", name: "The Riccis", shortName: null }],
      seededFamilyId: "fam-1",
      email: "elena@example.com",
      phone: "+15551234567",
    }),
  }));
  render(
    <PersonInviteModal
      personId="elena"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={neverSubmits as never}
    />,
  );

  expect(screen.getByTestId("person-invite-loading")).toBeTruthy();
  expect(fetchTargets).toHaveBeenCalledWith("elena");

  await screen.findByText("The Riccis");
  const chip = screen.getByRole("button", { name: "The Riccis" });
  expect(chip.getAttribute("aria-pressed")).toBe("true"); // single eligible family auto-seeds

  // Prefill with contacts → name + both contacts are display-only locked values (hidden inputs POST).
  expect(screen.getByTestId("invite-name-locked").textContent).toBe("Elena Ricci");
  expect(screen.getByTestId("invite-email-locked").textContent).toBe("elena@example.com");
  expect(screen.getByTestId("invite-phone-locked").textContent).toBe("+15551234567");
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("does not seed a chip when more than one family is eligible", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({
    ok: true,
    data: targets({
      families: [
        { id: "fam-1", name: "The Riccis", shortName: null },
        { id: "fam-2", name: "The Boudreauxs", shortName: null },
      ],
      seededFamilyId: null,
    }),
  }));
  render(
    <PersonInviteModal
      personId="elena"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={neverSubmits as never}
    />,
  );
  await screen.findByText("The Riccis");
  expect(screen.getByRole("button", { name: "The Riccis" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "The Boudreauxs" }).getAttribute("aria-pressed")).toBe("false");
});

/* ── 2/3. No eligible families / load error ─────────────────────────────────── */

it("shows the no-eligible-families message (no form) when every family already has this person", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({
    ok: true,
    data: targets({ families: [], seededFamilyId: null }),
  }));
  render(
    <PersonInviteModal
      personId="elena"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={neverSubmits as never}
    />,
  );
  const msg = await screen.findByTestId("person-invite-no-families");
  expect(msg.textContent).toBe(hub.personInvite.noEligibleFamilies);
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("shows the load-error message (no form) when the server action fails", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({
    ok: false,
    error: "not-eligible",
  }));
  render(
    <PersonInviteModal
      personId="elena"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={neverSubmits as never}
    />,
  );
  const msg = await screen.findByTestId("person-invite-load-error");
  expect(msg.textContent).toBe(hub.personInvite.loadError);
});

/* ── 4/5. Submit success / error ─────────────────────────────────────────────── */

it("submit success shows the ready-to-share link; Done calls onClose", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({ ok: true, data: targets() }));
  const submitInvite = vi.fn(
    async (): Promise<PersonInviteFormState> => ({
      status: "sent",
      link: "https://tellmeagain.app/join/tok123",
      sendingTo: "elena@example.com",
    }),
  );
  const onClose = vi.fn();
  render(
    <PersonInviteModal
      personId="elena"
      onClose={onClose}
      fetchTargets={fetchTargets}
      submitInvite={submitInvite}
    />,
  );
  await screen.findByText("The Riccis");
  expect(screen.getByTestId("invite-name-locked").textContent).toBe("Elena Ricci");
  fireEvent.change(screen.getByPlaceholderText(hub.invite.emailPlaceholder), {
    target: { value: "elena@example.com" },
  });
  fireEvent.change(screen.getByTestId("invite-relationship"), { target: { value: "other" } });

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: hub.invite.sendToEmail }));
  });

  expect(submitInvite).toHaveBeenCalledTimes(1);
  const sent = await screen.findByTestId("person-invite-sent");
  expect(sent.textContent).toContain(hub.invite.sendingTo("elena@example.com"));
  expect(screen.getByTestId("person-invite-link").textContent).toBe("https://tellmeagain.app/join/tok123");

  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("person-invite-done"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("submit error shows an inline error and keeps the form mounted", async () => {
  const fetchTargets = vi.fn(async (): Promise<PersonInviteTargetsResult> => ({ ok: true, data: targets() }));
  const submitInvite = vi.fn(
    async (): Promise<PersonInviteFormState> => ({ status: "error", message: hub.invite.alreadyMember }),
  );
  render(
    <PersonInviteModal
      personId="elena"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={submitInvite}
    />,
  );
  await screen.findByText("The Riccis");
  fireEvent.change(screen.getByPlaceholderText(hub.invite.emailPlaceholder), {
    target: { value: "elena@example.com" },
  });
  fireEvent.change(screen.getByTestId("invite-relationship"), { target: { value: "other" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: hub.invite.sendToEmail }));
  });

  const err = await screen.findByTestId("person-invite-error");
  expect(err.textContent).toBe(hub.invite.alreadyMember);
  // The form is still there — the user can retry rather than hitting a dead end.
  expect(screen.getByPlaceholderText(hub.invite.emailPlaceholder)).toBeTruthy();
});

/* ── 6. Close affordances ─────────────────────────────────────────────────────── */

it("the × button calls onClose", async () => {
  const onClose = vi.fn();
  render(
    <PersonInviteModal
      personId="elena"
      onClose={onClose}
      fetchTargets={async () => ({ ok: true, data: targets() })}
      submitInvite={neverSubmits as never}
    />,
  );
  fireEvent.click(screen.getByTestId("person-invite-close"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Escape calls onClose", () => {
  const onClose = vi.fn();
  render(
    <PersonInviteModal
      personId="elena"
      onClose={onClose}
      fetchTargets={async () => ({ ok: true, data: targets() })}
      submitInvite={neverSubmits as never}
    />,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

/* ── 7. Heading copy ──────────────────────────────────────────────────────────── */

it("the heading falls back to fallbackName while loading, then to the resolved displayName", async () => {
  const fetchTargets = vi.fn(
    async (): Promise<PersonInviteTargetsResult> => ({ ok: true, data: targets({ displayName: "Elena R." }) }),
  );
  render(
    <PersonInviteModal
      personId="elena"
      fallbackName="Elena (loading)"
      onClose={() => {}}
      fetchTargets={fetchTargets}
      submitInvite={neverSubmits as never}
    />,
  );
  expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(hub.personInvite.heading("Elena (loading)"));
  await screen.findByText("The Riccis");
  expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(hub.personInvite.heading("Elena R."));
});
