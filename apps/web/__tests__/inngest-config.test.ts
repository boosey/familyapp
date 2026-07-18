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
const BASE = "APP_BASE_URL";

describe("inngest-config gates", () => {
  let savedEvent: string | undefined;
  let savedSigning: string | undefined;
  let savedBase: string | undefined;

  beforeEach(() => {
    savedEvent = process.env[EVENT];
    savedSigning = process.env[SIGNING];
    savedBase = process.env[BASE];
    delete process.env[EVENT];
    delete process.env[SIGNING];
    delete process.env[BASE];
  });

  afterEach(() => {
    if (savedEvent === undefined) delete process.env[EVENT];
    else process.env[EVENT] = savedEvent;
    if (savedSigning === undefined) delete process.env[SIGNING];
    else process.env[SIGNING] = savedSigning;
    if (savedBase === undefined) delete process.env[BASE];
    else process.env[BASE] = savedBase;
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

  it("assertInngestServeable: THROWS when signing key is present but APP_BASE_URL is missing", () => {
    // Regression: prod scoped APP_BASE_URL to Production only, so a preview deployment that had
    // hijacked the shared Inngest app registration executed the durable invite.send worker with no
    // APP_BASE_URL and no request Host — resolvePublicOrigin threw per-invite, silently, so member
    // invites were enqueued but never delivered (delivery_attempts stayed 0, nothing in Resend).
    // Boot must now crash loudly instead.
    process.env[EVENT] = "evt_abc";
    process.env[SIGNING] = "signkey_xyz";
    // APP_BASE_URL intentionally absent (deleted in beforeEach).
    expect(() => assertInngestServeable()).toThrow(/APP_BASE_URL is missing or invalid/);
    expect(() => assertInngestServeable()).toThrow(/never delivered/);
  });

  it("assertInngestServeable: THROWS when APP_BASE_URL is set but schemeless (dead relative link)", () => {
    process.env[EVENT] = "evt_abc";
    process.env[SIGNING] = "signkey_xyz";
    process.env[BASE] = "tellmeagain.app"; // no https:// → resolvePublicOrigin rejects it
    expect(() => assertInngestServeable()).toThrow(/APP_BASE_URL is missing or invalid/);
  });

  it("assertInngestServeable: no-op when event+signing keys AND a valid APP_BASE_URL are present", () => {
    process.env[EVENT] = "evt_abc";
    process.env[SIGNING] = "signkey_xyz";
    process.env[BASE] = "https://tellmeagain.app";
    expect(() => assertInngestServeable()).not.toThrow();
  });

  it("assertInngestServeable: APP_BASE_URL is NOT required when Inngest is unconfigured (dev/CI)", () => {
    // No event key → in-process synchronous path → the durable worker never runs → APP_BASE_URL is
    // irrelevant at boot. Must stay a no-op even with no APP_BASE_URL set.
    expect(() => assertInngestServeable()).not.toThrow();
  });
});
