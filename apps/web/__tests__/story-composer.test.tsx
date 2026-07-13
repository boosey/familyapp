// @vitest-environment jsdom
/**
 * StoryComposer — the generalized capture/review surface (ADR-0007, Task 9).
 *  1. Tell mode (no ask): no question header, and the capture screen offers a voice⇄text toggle.
 *  2. The text path submits the typed telling via composeStoryAction (FormData carries `text`).
 *  3. Review shows an editable title field prepopulated with the derived title.
 * Mocks the server actions module (a "use server" file that pulls getRuntime()/db at import time).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryComposer, type DraftInfo } from "@/app/hub/StoryComposer";

const refresh = vi.fn();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, replace }),
}));

const STORY_ID = "57357613-bbb7-4eda-bb4f-5e645cbf2b3a";

// ADR-0014 Inc 3: the compose front door now resolves to the per-take `appended` step (typed take
// concatenated onto the draft's working prose). The client seeds the prose + refreshes; it never polls.
const composeStoryAction = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{ kind: "appended"; storyId: string; prose: string; appendedSegment: string }> => ({
    kind: "appended",
    storyId: STORY_ID,
    prose: "The summer we drove to the coast.",
    appendedSegment: "The summer we drove to the coast.",
  }),
);
// Captured so the family-picker guard tests can assert Share is (or isn't) attempted.
const shareAnswerAction = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/app/hub/answer/[askId]/actions", () => ({
  composeStoryAction: (...args: unknown[]) => composeStoryAction(...args),
  shareAnswerAction: (...args: unknown[]) => shareAnswerAction(...args),
  discardAnswerAction: vi.fn(),
  polishAnswerProseAction: vi.fn(),
}));

// The review phase mounts StoryPhotosEditor, which loads via this "use server" module (pulls
// getRuntime()/db at import). Mock it so the review-phase tests don't boot the real dev runtime; the
// empty-editor result is enough (these tests assert title/discard behavior, not photos).
vi.mock("@/app/hub/answer/[askId]/photo-actions", () => ({
  loadStoryPhotoEditorAction: vi.fn(
    async (): Promise<{ ok: true; attached: never[]; album: never[] }> => ({
      ok: true,
      attached: [],
      album: [],
    }),
  ),
  attachStoryPhotoAction: vi.fn(),
  detachStoryPhotoAction: vi.fn(),
  setStoryCoverAction: vi.fn(),
  reorderStoryPhotosAction: vi.fn(),
}));

// The review phase also mounts the unified TagInput, which loads suggestions via this "use server"
// module and autosaves text/person tags via ./stories/[id]/actions. Mock both so the compose-review
// tests don't boot the real dev runtime.
const loadTagSuggestionsAction = vi.fn(
  async (
    ..._args: unknown[]
  ): Promise<{
    people: { personId: string; displayName: string }[];
    families: { id: string; name: string }[];
    tags: string[];
  }> => ({
    people: [],
    families: [],
    tags: [],
  }),
);
vi.mock("@/app/hub/tag-suggestions-actions", () => ({
  loadTagSuggestionsAction: (...args: unknown[]) => loadTagSuggestionsAction(...args),
}));
const editStoryDetailsAction = vi.fn(async (..._args: unknown[]) => undefined);
const tagStorySubjectAction = vi.fn(async (..._args: unknown[]) => undefined);
const untagStorySubjectAction = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/app/hub/stories/[id]/actions", () => ({
  editStoryDetailsAction: (...args: unknown[]) => editStoryDetailsAction(...args),
  tagStorySubjectAction: (...args: unknown[]) => tagStorySubjectAction(...args),
  untagStorySubjectAction: (...args: unknown[]) => untagStorySubjectAction(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoryComposer capture (tell mode)", () => {
  it("in tell mode with no ask, shows no question header and offers a type toggle", () => {
    render(<StoryComposer mode="tell" ask={null} draft={null} />);
    // No answer-mode question header ("<NAME> ASKED") in a self-initiated telling.
    expect(screen.queryByText(/asked/i)).toBeNull();
    expect(screen.getByRole("button", { name: /type it/i })).toBeTruthy();
  });

  it("type mode submits text via composeStoryAction", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={null} />);

    // Switch to the typed path.
    fireEvent.click(screen.getByRole("button", { name: /type it/i }));

    // Type into the textarea and submit.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "The summer we drove to the coast." } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(composeStoryAction).toHaveBeenCalledOnce());
    const form = composeStoryAction.mock.calls[0]![0] as FormData;
    expect(form.get("text")).toBe("The summer we drove to the coast.");
    // Self-initiated telling → no askId is attached.
    expect(form.get("askId")).toBeNull();
  });

  it("an appended text submit hands off to the story's resume URL and never polls the status", async () => {
    // ADR-0014 Inc 3 slice 10: `/hub/tell` (fresh telling) can't re-query a just-created draft by URL,
    // so the first take navigates to `/hub/tell/[storyId]` (which server-drives the composing surface).
    render(<StoryComposer mode="tell" ask={null} draft={null} />);

    fireEvent.click(screen.getByRole("button", { name: /type it/i }));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "The summer we drove to the coast." } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/hub/tell/${STORY_ID}`));
    // An appended draft stays `draft` — the composing surface never polls or shows "taking longer".
    expect(screen.queryByText(/taking longer/i)).toBeNull();
  });
});

describe("StoryComposer review title field", () => {
  const draft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "", // a text story has no audio
    prose: "The body of the story.",
    title: "Auto Title",
    state: "pending_approval",
    takes: [],
  };

  it("review shows a title field prepopulated with the derived title, editable", () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    const title = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(title.value).toBe("Auto Title");

    // Editable.
    fireEvent.change(title, { target: { value: "A drive to the coast" } });
    expect(title.value).toBe("A drive to the coast");
  });

  it("a text draft (no audio) renders no relisten audio in review", () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    expect(document.querySelector("audio")).toBeNull();
  });
});

describe("StoryComposer discard destination is mode-aware", () => {
  const draft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "",
    prose: "The body of the story.",
    title: "Auto Title",
    state: "pending_approval",
    takes: [],
  };

  // discardAnswerAction (mocked above) resolves undefined → no `.error` → handleDiscard proceeds to
  // router.push(backTab). backTab is derived from `mode`: tell → Stories tab, answer → Questions tab.
  it("tell-mode discard returns to the Stories tab", async () => {
    render(<StoryComposer mode="tell" ask={null} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub?tab=stories"));
  });

  it("answer-mode discard returns to the Questions tab (no regression)", async () => {
    render(
      <StoryComposer
        mode="answer"
        ask={{ id: "ask1", questionText: "What was Sunday like?", askerName: "Mom" }}
        draft={draft}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub?tab=questions"));
  });
});

describe("StoryComposer share-step multi-family picker (Task 4)", () => {
  const pendingDraft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "",
    prose: "The body of the story.",
    title: "Auto Title",
    state: "pending_approval",
    takes: [],
  };
  const twoFamilies = [
    { familyId: "fam-a", familyName: "Boudreaux" },
    { familyId: "fam-b", familyName: "Carney" },
  ];

  // The picker legend, used to assert presence/absence of the multi-family picker.
  const pickerText = /which families should see this/i;

  it("HIDES the picker for a single-family author (nothing to choose)", () => {
    render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={[twoFamilies[0]!]}
        seededFamilyIds={["fam-a"]}
      />,
    );
    expect(screen.queryByText(pickerText)).toBeNull();
    // No family checkboxes either (the tier radios are type=radio, not checkbox).
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
  });

  it("SHOWS the picker for a multi-family author on the default family tier", () => {
    render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={twoFamilies}
        seededFamilyIds={["fam-a"]}
      />,
    );
    expect(screen.getByText(pickerText)).toBeTruthy();
    // One checkbox per family; the seeded family is pre-checked.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(2);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
  });

  it("HIDES the picker on the public tier (no per-family target)", () => {
    const { container } = render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={twoFamilies}
        seededFamilyIds={["fam-a"]}
      />,
    );
    // Visible on the default family tier…
    expect(screen.getByText(pickerText)).toBeTruthy();
    // …then switching to public removes it.
    const publicRadio = container.querySelector(
      'input[name="audienceTier"][value="public"]',
    ) as HTMLInputElement;
    fireEvent.click(publicRadio);
    expect(screen.queryByText(pickerText)).toBeNull();
  });

  it("BLOCKS Share with an empty required selection — shows the guard, never calls the action", async () => {
    render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={twoFamilies}
        seededFamilyIds={[]}
        familyChoiceRequired
      />,
    );
    // Nothing pre-checked (ambiguous "all"-with-several); Share must not proceed.
    fireEvent.click(screen.getByRole("button", { name: /share with family/i }));
    await waitFor(() =>
      expect(screen.getByText(/choose at least one family for this story/i)).toBeTruthy(),
    );
    expect(shareAnswerAction).not.toHaveBeenCalled();
  });

  it("ALLOWS Share once a required family is picked", async () => {
    render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={twoFamilies}
        seededFamilyIds={[]}
        familyChoiceRequired
      />,
    );
    // Pick a family, then Share proceeds to the action (which carries the chosen id).
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /share with family/i }));
    await waitFor(() => expect(shareAnswerAction).toHaveBeenCalledOnce());
    const form = shareAnswerAction.mock.calls[0]![0] as FormData;
    expect(form.getAll("familyIds")).toEqual(["fam-a"]);
  });
});

describe("StoryComposer unified TagInput in compose review (Task 7)", () => {
  const pendingDraft: DraftInfo = {
    storyId: STORY_ID,
    recordedAt: new Date(0).toISOString(),
    mediaUrl: "",
    prose: "The body of the story.",
    title: "Auto Title",
    state: "pending_approval",
    takes: [],
  };
  const twoFamilies = [
    { familyId: "fam-a", familyName: "Boudreaux" },
    { familyId: "fam-b", familyName: "Carney" },
  ];

  it("adding a family via TagInput toggles it into the finish picker's selected set, with NO confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    // TagInput's family suggestions come from loadTagSuggestionsAction; give it fam-b so it appears
    // in the typeahead dropdown once the effect resolves.
    loadTagSuggestionsAction.mockResolvedValueOnce({
      people: [],
      families: [{ id: "fam-b", name: "Carney" }],
      tags: [],
    });
    render(
      <StoryComposer
        mode="tell"
        ask={null}
        draft={pendingDraft}
        families={twoFamilies}
        seededFamilyIds={["fam-a"]}
      />,
    );

    // fam-a starts checked (seeded); fam-b starts unchecked.
    const boxesBefore = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxesBefore[0]!.checked).toBe(true);
    expect(boxesBefore[1]!.checked).toBe(false);

    // Open the TagInput and add fam-b as a family token.
    const tagField = screen.getByLabelText(/tags & people/i);
    fireEvent.change(tagField, { target: { value: "Carney" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Carney" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Carney" }));

    // fam-b is now pre-selected in the SAME FamilyPicker the Share step reads from.
    const boxesAfter = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxesAfter[1]!.checked).toBe(true);
    // A remove chip for it now exists in the TagInput too (proves it round-tripped into composeTokens).
    expect(screen.getByRole("button", { name: /remove carney/i })).toBeTruthy();
    // Nothing is shared by adding the tag — no retarget/share action fired, no confirm prompt.
    expect(shareAnswerAction).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    // Removing it toggles fam-b back off, again with no confirm (nothing was ever shared).
    const removeButtons = screen.getAllByRole("button", { name: /remove carney/i });
    fireEvent.click(removeButtons[0]!);
    const boxesRemoved = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxesRemoved[1]!.checked).toBe(false);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
