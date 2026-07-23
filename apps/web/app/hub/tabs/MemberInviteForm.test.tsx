// @vitest-environment jsdom
/**
 * MemberInviteForm — send actions stay disabled until a family is designated (multi-family, no seed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemberInviteForm } from "@/app/hub/tabs/MemberInviteForm";
import { hub } from "@/app/_copy";

afterEach(() => cleanup());

const FAMILIES = [
  { id: "fam-a", name: "Esposito" },
  { id: "fam-b", name: "Marino" },
];

describe("MemberInviteForm — family required for send actions", () => {
  it("keeps Send email / Send text / Get link disabled until a family chip is picked", () => {
    render(
      <MemberInviteForm
        action={vi.fn()}
        families={FAMILIES}
        seededFamily={null}
        defaultName="Rosa"
      />,
    );

    fireEvent.change(screen.getByTestId("invite-email"), { target: { value: "rosa@example.com" } });
    fireEvent.change(screen.getByTestId("invite-phone"), { target: { value: "+15551230000" } });

    const emailBtn = screen.getByRole("button", { name: hub.invite.sendToEmail }) as HTMLButtonElement;
    const phoneBtn = screen.getByRole("button", { name: hub.invite.sendToPhone }) as HTMLButtonElement;
    const linkBtn = screen.getByRole("button", { name: hub.invite.getLink }) as HTMLButtonElement;

    expect(emailBtn.disabled).toBe(true);
    expect(phoneBtn.disabled).toBe(true);
    expect(linkBtn.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Esposito" }));

    expect(emailBtn.disabled).toBe(false);
    expect(phoneBtn.disabled).toBe(false);
    expect(linkBtn.disabled).toBe(false);
  });

  it("enables send actions when a family is already seeded", () => {
    render(
      <MemberInviteForm
        action={vi.fn()}
        families={FAMILIES}
        seededFamily="fam-b"
        defaultName="Rosa"
      />,
    );

    fireEvent.change(screen.getByTestId("invite-email"), { target: { value: "rosa@example.com" } });

    expect(
      (screen.getByRole("button", { name: hub.invite.sendToEmail }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
