import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoryForViewer,
  persistRecordingAndCreateDraft,
  updateDerivedFields,
} from "../src/index";
import { makePerson } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

describe("persistRecordingAndCreateDraft (capture write path)", () => {
  it("writes the recording first, then a draft story pointing at it", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { recording, story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/rec-1.webm",
      contentType: "audio/webm",
      durationSeconds: 142,
      checksum: "sha256:deadbeef",
    });

    expect(recording.kind).toBe("story_audio");
    expect(recording.ownerPersonId).toBe(narrator.id);
    expect(story.recordingMediaId).toBe(recording.id);
    expect(story.ownerPersonId).toBe(narrator.id);
    // born private + draft (stays there until voice approval)
    expect(story.state).toBe("draft");
    expect(story.audienceTier).toBe("private");
  });

  it("the narrator can immediately read their own fresh draft; a stranger cannot", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const stranger = await makePerson(db, "Stranger");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/rec-2.webm",
      contentType: "audio/webm",
      checksum: "sha256:cafe",
    });

    const asNarrator = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      story.id,
    );
    expect(asNarrator?.id).toBe(story.id);

    const asStranger = await getStoryForViewer(
      db,
      { kind: "account", personId: stranger.id },
      story.id,
    );
    expect(asStranger).toBeNull();
  });

  it("carries provenance (promptQuestion / askId) onto the draft", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(
      db,
      {
        ownerPersonId: narrator.id,
        storageKey: "r2://chronicle/eleanor/rec-3.webm",
        contentType: "audio/webm",
        checksum: "sha256:f00d",
      },
      { promptQuestion: "What was your mother like?" },
    );
    expect(story.promptQuestion).toBe("What was your mother like?");
  });
});

describe("updateDerivedFields — era label (eraLabel)", () => {
  it("persists eraLabel and a subsequent read returns it", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/era.webm",
      contentType: "audio/webm",
      checksum: "sha256:era",
    });
    // Born without an era label.
    expect(story.eraLabel).toBeNull();

    const updated = await updateDerivedFields(db, story.id, {
      eraLabel: "Cherry Street",
    });
    expect(updated.eraLabel).toBe("Cherry Street");

    // Read back through the authorized front door as the owner.
    const readBack = await getStoryForViewer(
      db,
      { kind: "link_session", personId: narrator.id },
      story.id,
    );
    expect(readBack?.eraLabel).toBe("Cherry Street");
  });

  it("leaves eraLabel untouched when omitted, and allows clearing it via null", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/era2.webm",
      contentType: "audio/webm",
      checksum: "sha256:era2",
    });
    await updateDerivedFields(db, story.id, { eraLabel: "the Blue Room" });

    // A later derived-field write that omits the era label must not wipe it (undefined = skip).
    const afterTitle = await updateDerivedFields(db, story.id, { title: "The dance" });
    expect(afterTitle.eraLabel).toBe("the Blue Room");

    // Explicit null clears the label (distinct from undefined).
    const cleared = await updateDerivedFields(db, story.id, { eraLabel: null });
    expect(cleared.eraLabel).toBeNull();
  });
});

describe("updateDerivedFields — Story date (occurred_*, ADR-0026)", () => {
  it("persists all three forms plus provenance and reads them back through the authorized front door", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const mk = (key: string) =>
      persistRecordingAndCreateDraft(db, {
        ownerPersonId: narrator.id,
        storageKey: `r2://chronicle/eleanor/${key}.webm`,
        contentType: "audio/webm",
        checksum: `sha256:${key}`,
      });

    // Born Undated — NULL occurred_kind is a first-class state.
    const { story: undated } = await mk("occ-undated");
    expect(undated.occurredKind).toBeNull();
    expect(undated.occurredDate).toBeNull();
    expect(undated.occurredEndDate).toBeNull();
    expect(undated.occurredProvenance).toBeNull();

    // date — a stated or derived point.
    const { story: dated } = await mk("occ-date");
    await updateDerivedFields(db, dated.id, {
      occurredKind: "date",
      occurredDate: "1943-12-25",
      occurredProvenance: "age 8 at Christmas, from birthdate",
    });
    // period — a true span with start and end.
    const { story: period } = await mk("occ-period");
    await updateDerivedFields(db, period.id, {
      occurredKind: "period",
      occurredDate: "1951-09-01",
      occurredEndDate: "1955-06-30",
      occurredProvenance: "high school years, from birthdate",
    });
    // circa — an approximate point.
    const { story: circa } = await mk("occ-circa");
    await updateDerivedFields(db, circa.id, {
      occurredKind: "circa",
      occurredDate: "1965-01-01",
      occurredProvenance: "about ten years after we married",
    });

    const asNarrator = (id: string) =>
      getStoryForViewer(db, { kind: "link_session", personId: narrator.id }, id);

    const readDated = await asNarrator(dated.id);
    expect(readDated?.occurredKind).toBe("date");
    expect(readDated?.occurredDate).toBe("1943-12-25");
    expect(readDated?.occurredEndDate).toBeNull();
    expect(readDated?.occurredProvenance).toBe("age 8 at Christmas, from birthdate");

    const readPeriod = await asNarrator(period.id);
    expect(readPeriod?.occurredKind).toBe("period");
    expect(readPeriod?.occurredDate).toBe("1951-09-01");
    expect(readPeriod?.occurredEndDate).toBe("1955-06-30");
    expect(readPeriod?.occurredProvenance).toBe("high school years, from birthdate");

    const readCirca = await asNarrator(circa.id);
    expect(readCirca?.occurredKind).toBe("circa");
    expect(readCirca?.occurredDate).toBe("1965-01-01");
    expect(readCirca?.occurredEndDate).toBeNull();
  });

  it("leaves occurred fields untouched when omitted, and clears them via explicit null", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/occ-clear.webm",
      contentType: "audio/webm",
      checksum: "sha256:occ-clear",
    });
    await updateDerivedFields(db, story.id, {
      occurredKind: "date",
      occurredDate: "1943-12-25",
      occurredProvenance: "age 8 at Christmas, from birthdate",
    });

    // A later derived-field write that omits occurred fields must not wipe them (undefined = skip).
    const afterTitle = await updateDerivedFields(db, story.id, { title: "The dance" });
    expect(afterTitle.occurredKind).toBe("date");
    expect(afterTitle.occurredDate).toBe("1943-12-25");
    expect(afterTitle.occurredProvenance).toBe("age 8 at Christmas, from birthdate");

    // Explicit null clears (distinct from undefined) — marking the story Undated again.
    const cleared = await updateDerivedFields(db, story.id, {
      occurredKind: null,
      occurredDate: null,
      occurredEndDate: null,
      occurredProvenance: null,
    });
    expect(cleared.occurredKind).toBeNull();
    expect(cleared.occurredDate).toBeNull();
    expect(cleared.occurredEndDate).toBeNull();
    expect(cleared.occurredProvenance).toBeNull();
  });

  it("does not disturb eraLabel (legacy era behavior fully intact)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const { story } = await persistRecordingAndCreateDraft(db, {
      ownerPersonId: narrator.id,
      storageKey: "r2://chronicle/eleanor/occ-era.webm",
      contentType: "audio/webm",
      checksum: "sha256:occ-era",
    });
    await updateDerivedFields(db, story.id, { eraLabel: "Cherry Street" });

    const after = await updateDerivedFields(db, story.id, {
      occurredKind: "period",
      occurredDate: "1958-01-01",
      occurredEndDate: "1958-12-31",
    });
    expect(after.eraLabel).toBe("Cherry Street");
    expect(after.occurredKind).toBe("period");
  });
});

// #362: `listNarratorMemoryForInterviewer` MOVED to narrator-memory-repository.ts (the read is now a
// strict repoint onto the `narrator_memory` store, no longer story metadata). Its tests live in
// narrator-memory-repository.test.ts.
