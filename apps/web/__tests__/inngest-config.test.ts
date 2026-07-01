/**
 * Tests for the Inngest config gates (lib/inngest-config.ts).
 *
 * `assertInngestServeable()` is the fail-fast guard against the half-configured signing-key trap:
 * an event key WITHOUT a signing key would enqueue + register but never execute, leaving stories in
 * `draft` forever. We assert it CRASHES in that case (matching the partial-R2 precedent) and stays
 * silent otherwise. This is the config-path equivalent of the `build()` throw — runtime.ts calls
 * this same function inside its `if (inngestConfigured)` branch before constructing any client.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertInngestServeable, isInngestConfigured } from "../lib/inngest-config";

const EVENT = "INNGEST_EVENT_KEY";
const SIGNING = "INNGEST_SIGNING_KEY";

describe("inngest-config gates", () => {
  let savedEvent: string | undefined;
  let savedSigning: string | undefined;

  beforeEach(() => {
    savedEvent = process.env[EVENT];
    savedSigning = process.env[SIGNING];
    delete process.env[EVENT];
    delete process.env[SIGNING];
  });

  afterEach(() => {
    if (savedEvent === undefined) delete process.env[EVENT];
    else process.env[EVENT] = savedEvent;
    if (savedSigning === undefined) delete process.env[SIGNING];
    else process.env[SIGNING] = savedSigning;
  });

  it("isInngestConfigured: false when the event key is absent, true when present", () => {
    expect(isInngestConfigured()).toBe(false);
    process.env[EVENT] = "evt_abc";
    expect(isInngestConfigured()).toBe(true);
  });

  it("assertInngestServeable: no-op when Inngest is unconfigured (dev/CI)", () => {
    expect(() => assertInngestServeable()).not.toThrow();
  });

  it("assertInngestServeable: THROWS when event key is set but signing key is missing", () => {
    process.env[EVENT] = "evt_abc";
    expect(() => assertInngestServeable()).toThrow(/INNGEST_SIGNING_KEY is missing/);
    // The message must be actionable — name the env vars and the failure mode.
    expect(() => assertInngestServeable()).toThrow(/stay in draft forever/);
  });

  it("assertInngestServeable: THROWS when signing key is set to empty string", () => {
    process.env[EVENT] = "evt_abc";
    process.env[SIGNING] = "";
    expect(() => assertInngestServeable()).toThrow(/INNGEST_SIGNING_KEY is missing/);
  });

  it("assertInngestServeable: no-op when BOTH keys are present (prod-durable, valid)", () => {
    process.env[EVENT] = "evt_abc";
    process.env[SIGNING] = "signkey_xyz";
    expect(() => assertInngestServeable()).not.toThrow();
  });
});
