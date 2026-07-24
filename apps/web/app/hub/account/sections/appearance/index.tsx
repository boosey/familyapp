/**
 * Account › Appearance (ADR-0029) — the DEVICE-LOCAL app preferences (ADR-0020): Look & feel skin,
 * reduce motion, recording gesture, text size, color palette. Relocated from /hub/settings. All the
 * controls read/write localStorage and apply to this browser only, so the actual UI lives in the
 * `AppearanceControls` client component; this async server component is just the section entry point.
 */
import type { AccountSectionProps } from "../../section-props";
import { AppearanceControls } from "./AppearanceControls";

export default async function AppearanceSection(_props: AccountSectionProps) {
  return <AppearanceControls />;
}
