// @vitest-environment jsdom
/**
 * MemberInviteForm — SMS consent disclosure (Twilio TFV / TCPA).
 *
 * Pins the opt-in chrome reviewers screenshot: when a phone is present, an unchecked checkbox +
 * explicit SMS language + Privacy Policy link appear, and "Send text" stays disabled until checked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hub } from "@/app/_copy";
import { MemberInviteForm } from "@/app/hub/tabs/MemberInviteForm";

afterEach(cleanup);

function renderForm(over: { defaultPhone?: string } = {}) {
  return render(
    <MemberInviteForm
      action={async () => {}}
      families={[{ id: "fam-1", name: "Esposito" }]}
      seededFamily="fam-1"
      defaultName="Rosa"
      defaultPhone={over.defaultPhone}
    />,
  );
}

describe("MemberInviteForm — SMS consent (Twilio TFV)", () => {
  it("hides the SMS consent block when no phone is entered", () => {
    renderForm();
    expect(screen.queryByTestId("invite-sms-consent")).toBeNull();
    expect(
      (screen.getByRole("button", { name: hub.invite.sendToPhone }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows unchecked consent language + Privacy Policy link when a phone is present", () => {
    renderForm({ defaultPhone: "+15551230000" });

    const block = screen.getByTestId("invite-sms-consent");
    expect(block.textContent).toContain("SMS text messages");
    expect(block.textContent).toContain("Tell Me Again");
    expect(block.textContent).toContain("STOP");
    expect(block.textContent).toContain("HELP");

    const checkbox = screen.getByTestId("invite-sms-consent-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    const privacy = screen.getByRole("link", { name: hub.invite.smsConsentPrivacyAria });
    expect(privacy.getAttribute("href")).toBe("/privacy");

    expect(
      (screen.getByRole("button", { name: hub.invite.sendToPhone }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables Send text only after the SMS consent checkbox is checked", () => {
    renderForm({ defaultPhone: "+15551230000" });
    const sendText = screen.getByRole("button", { name: hub.invite.sendToPhone }) as HTMLButtonElement;
    expect(sendText.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("invite-sms-consent-checkbox"));
    expect(sendText.disabled).toBe(false);
  });
});
