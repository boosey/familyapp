// @vitest-environment jsdom
/**
 * Phase C bulk "tell one story about these N photos": /hub/tell must accept the repeated
 * `subjectPhotoIds` param (Next.js `string | string[] | undefined`) and thread it to StoryComposer as
 *   - `subjectPhotoId`        = the FIRST id (the subject/cover — EXACTLY today's single-photo path)
 *   - `extraSubjectPhotoIds`  = the REST (attached as accompaniment once the draft exists)
 *
 * Back-compat: the legacy single `subjectPhotoId` param still collapses to a one-element list with no
 * extras. The id list is de-duped so a repeated id never becomes a double cover/attach.
 *
 * Like tell-resume-page.test.tsx, the page is an async server component: invoke it, render the element
 * it returns, and read the props off a stubbed StoryComposer. The data seams are mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getCurrentAuthContext = vi.fn();
const resolvePostAuthRoute = vi.fn();

class RedirectError extends Error {
  constructor(public to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));
vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: {}, auth: { getCurrentAuthContext } }),
}));
vi.mock("@/lib/post-auth-route", () => ({
  resolvePostAuthRoute: (...a: unknown[]) => resolvePostAuthRoute(...a),
}));
vi.mock("@chronicle/core", () => ({
  listActiveFamiliesForPerson: async () => [],
}));
vi.mock("../app/hub/StoryComposer", () => ({
  StoryComposer: ({
    subjectPhotoId,
    extraSubjectPhotoIds,
    promptQuestion,
  }: {
    subjectPhotoId: string | null;
    extraSubjectPhotoIds: string[];
    promptQuestion: string | null;
  }) => (
    <div
      data-testid="composer"
      data-subject={subjectPhotoId ?? "null"}
      data-extras={JSON.stringify(extraSubjectPhotoIds ?? [])}
      data-prompt={promptQuestion ?? "null"}
    />
  ),
}));

import TellPage from "@/app/hub/tell/page";

const PERSON = "p-eleanor";

async function run(params: Record<string, string | string[] | undefined>): Promise<string> {
  getCurrentAuthContext.mockResolvedValue({ kind: "account", personId: PERSON });
  resolvePostAuthRoute.mockResolvedValue("/hub");
  try {
    const el = await TellPage({ searchParams: Promise.resolve(params) });
    render(el);
    return "RENDERED";
  } catch (err) {
    if (err instanceof RedirectError) return err.to;
    throw err;
  }
}

function props() {
  const el = screen.getByTestId("composer");
  return {
    subject: el.getAttribute("data-subject"),
    extras: JSON.parse(el.getAttribute("data-extras") ?? "[]") as string[],
    prompt: el.getAttribute("data-prompt"),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TellPage subjectPhotoIds parsing", () => {
  it("legacy single subjectPhotoId → that id is the cover, no extras", async () => {
    expect(await run({ subjectPhotoId: "photo-1" })).toBe("RENDERED");
    expect(props()).toMatchObject({ subject: "photo-1", extras: [] });
  });

  it("multiple subjectPhotoIds → FIRST is the cover, REST are extras (order preserved)", async () => {
    expect(await run({ subjectPhotoIds: ["photo-1", "photo-2", "photo-3"] })).toBe("RENDERED");
    expect(props()).toMatchObject({
      subject: "photo-1",
      extras: ["photo-2", "photo-3"],
    });
  });

  it("a single-value subjectPhotoIds (Next collapses one repeat to a string) is the cover, no extras", async () => {
    expect(await run({ subjectPhotoIds: "photo-1" })).toBe("RENDERED");
    expect(props()).toMatchObject({ subject: "photo-1", extras: [] });
  });

  it("de-dups repeated ids: a cover duplicated among the rest is not re-listed as an extra", async () => {
    expect(await run({ subjectPhotoIds: ["photo-1", "photo-2", "photo-1", "photo-2"] })).toBe(
      "RENDERED",
    );
    expect(props()).toMatchObject({ subject: "photo-1", extras: ["photo-2"] });
  });

  it("subjectPhotoIds takes precedence over a stray legacy subjectPhotoId", async () => {
    expect(
      await run({ subjectPhotoIds: ["photo-a", "photo-b"], subjectPhotoId: "legacy" }),
    ).toBe("RENDERED");
    expect(props()).toMatchObject({ subject: "photo-a", extras: ["photo-b"] });
  });

  it("no photo params → no cover, no extras (a plain telling)", async () => {
    expect(await run({})).toBe("RENDERED");
    expect(props()).toMatchObject({ subject: "null", extras: [] });
  });

  it("still threads promptQuestion alongside the bulk ids", async () => {
    expect(
      await run({ subjectPhotoIds: ["photo-1", "photo-2"], promptQuestion: "The lake house" }),
    ).toBe("RENDERED");
    expect(props()).toMatchObject({
      subject: "photo-1",
      extras: ["photo-2"],
      prompt: "The lake house",
    });
  });
});
