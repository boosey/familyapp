import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_UP_POLICY,
  resolveFollowUpPolicy,
} from "../src/follow-up-policy";

describe("resolveFollowUpPolicy", () => {
  it("returns the disabled-by-default policy with no overrides", () => {
    expect(resolveFollowUpPolicy()).toEqual(DEFAULT_FOLLOW_UP_POLICY);
    expect(resolveFollowUpPolicy().enabled).toBe(false);
  });

  it("applies partial overrides over the defaults", () => {
    const p = resolveFollowUpPolicy({ enabled: true, maxFollowUpsPerThread: 3 });
    expect(p.enabled).toBe(true);
    expect(p.maxFollowUpsPerThread).toBe(3);
    expect(p.confidenceThreshold).toBe(DEFAULT_FOLLOW_UP_POLICY.confidenceThreshold);
    expect(p.maxFollowUpsPerSession).toBe(DEFAULT_FOLLOW_UP_POLICY.maxFollowUpsPerSession);
  });

  it("does not mutate the shared default object", () => {
    resolveFollowUpPolicy({ enabled: true });
    expect(DEFAULT_FOLLOW_UP_POLICY.enabled).toBe(false);
  });
});
