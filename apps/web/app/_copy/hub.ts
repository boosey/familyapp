// apps/web/app/_copy/hub.ts
// Copy for the signed-in hub: shell, tabs, story browser, answer flow, server-action errors.

// Shared meta-label formatters — the Questions tab and the Answer screen render these identically.
const askedBy = (name: string) => `${name.toUpperCase()} ASKED`;
const recordedAt = (label: string) => `RECORDED ${label.toUpperCase()}`;

export const hub = {
  shell: {
    // Signed-out visitors are redirected to the root landing (the sign-in/sign-up front door),
    // so the hub shell itself has no anonymous copy.
    chronicle: "Your Chronicle",
    tabStories: "Stories",
    // Sits between Stories and "To answer" — the hub's home for the Family album (#19).
    tabAlbum: "Album",
    // Tab label follows the "Story Browse (Hub)" design ("To answer"); the section heading inside
    // the tab stays "Questions for you" (hub.questions.title).
    tabQuestions: "To answer",
    tabAsk: "Ask a question",
    tabAsks: "Your asks",
    tabInvite: "Invite",
    tabRequests: "Requests",
    menuProfile: "Your profile",
    menuSettings: "Settings",
    menuManageFamily: "Manage family",
    menuSwitchUser: "Switch user",
    menuLogOut: "Log out",
    sectionsAria: "Hub sections",
    unreadAria: (badge: number) => `${badge} unread`,
  },
  stories: {
    untitled: "Untitled",
    empty:
      "No stories yet. When someone shares a chronicle with you, their stories will appear here.",
    // Self-initiated telling (ADR-0007): the Stories-tab entry into /hub/tell, plus the resume list
    // for ask-less drafts still in review.
    tellTitle: "Tell a story",
    tellBlurb: "Something you want to remember — start it whenever it comes to you.",
    resumeHeading: "Finish what you started",
    resume: "Finish",
  },
  intake: {
    // Banner shown at the top of the hub until the narrator's biographical profile is complete.
    // Its CTA links to /hub/about-you (the intake surface).
    aria: "Your introduction",
    body: "There's still a little more of your introduction to fill in — a few details about where you're from and the life you've lived.",
    cta: "Continue your introduction",
  },
  aboutYou: {
    // The /hub/about-you intake surface — a short structured walk through the biographical profile.
    eyebrow: "Your introduction",
    progress: "A few quick questions",
    typeInstead: "Type instead",
    voiceLabel: "Tap to answer",
    voiceStop: "Tap when you're done",
    transcribing: "Transcribing…",
    micError: "We couldn't reach your microphone. You can type your answer instead.",
    next: "Next",
    saving: "Saving…",
    takeMeToHub: "Take me to the hub →",
    saveError: "We couldn't save that one. You can keep going.",
    doneEyebrow: "Thank you",
    doneTitle: "That's a lovely start.",
    doneBody: "Your family now has a little more to ask you about. There's always more to tell whenever you're ready.",
  },
  questions: {
    title: "Questions for you",
    intro: "Your family asked these. Answer whenever you're ready — there's no rush.",
    caughtUp: "You're all caught up. Nothing waiting.",
    askedBy,
    recordedAt,
    reviewApprove: "Review & approve",
    answer: "Answer",
  },
  ask: {
    signedOut: "Sign in to ask a question.",
    heading: "Ask a question",
    intro:
      "Your question goes into the queue. It will be asked next time they sit down to talk — never as an interruption.",
    promptEyebrow: "What would you love to hear?",
    promptQuestion: "A good ask is small and human — a name, a smell, a feeling, a Sunday.",
    forLabel: "For",
    questionLabel: "Your question",
    questionPlaceholder: "e.g. What was your mother singing on Sunday mornings?",
    submit: "Send to the queue",
    // ADR-0009 Phase 3 — an optional photo picker so an ask can be ABOUT one or more album photos
    // ("tell the story of THIS photo"). Only photos the asker can already see are offered.
    photosLabel: "Add a photo (optional)",
    photosHelp: "Ask about a specific photo — they'll see it when they answer.",
    photoPickerLoadError: "Couldn't load your album photos. You can still send the question.",
    noAlbumPhotos: "No album photos yet.",
    selectedHeading: "About these photos",
    attachPhotoAria: (caption: string | null) =>
      caption ? `Ask about “${caption}”` : "Ask about this photo",
    removePhotoAria: (caption: string | null) =>
      caption ? `Remove “${caption}” from this question` : "Remove this photo from the question",
  },
  asks: {
    signedOut: "Sign in to see your asks.",
    title: "Your asks",
    intro: "The questions you’ve sent, and where they are.",
    empty: "You haven’t asked anything yet.",
    forTarget: (name: string) => `For ${name}:`,
    listen: "Listen",
    answeredPrivate: "ANSWERED · PRIVATE",
    inQueue: "IN THE QUEUE",
  },
  invite: {
    personalLinkOnce: "Personal link — shown once",
    narratorReadyTitle: "Link is ready",
    narratorReadyBlurb:
      "Send this to your narrator however you usually talk — text or email. Tapping it opens their recording page directly. There is no password.",
    fingerprintNote:
      "For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it.",
    memberReadyTitle: "Invitation link is ready",
    memberReadyBlurb:
      "Send this to your relative. Opening it lets them create a login and join your family — you don't have to set anything up for them.",
    signedOut: "Sign in to invite someone.",
    memberHeading: "Invite a family member",
    memberBody:
      "Send a relative a link to create their own login and join the family. They'll confirm who they are, then go through a short welcome.",
    nameLabel: "Their name",
    namePlaceholder: "e.g. Rosa Esposito",
    // "Their email" and "(optional)" are split so the span styling is preserved in JSX.
    emailLabel: "Their email",
    emailLabelOptional: "(optional)",
    emailPlaceholder: "rosa@example.com",
    // "Relationship" and "(optional)" are split so the span styling is preserved in JSX.
    relationshipLabel: "Relationship",
    relationshipLabelOptional: "(optional)",
    relationshipPlaceholder: "e.g. your cousin",
    familyLabel: "Family",
    createInviteLink: "Create invite link",
    narratorHeading: "Invite a narrator to record",
    narratorBody:
      "Creates a personal link that opens the narrator's recording page. No login, no account — the link is the identity.",
    narratorLabel: "Narrator",
    createLink: "Create link",
  },
  requests: {
    signedOut: "Sign in to review join requests.",
    title: "Requests to join",
    intro:
      "As steward, you approve everyone who joins. Nothing is shared with a requester until you say yes.",
    empty: "No requests waiting right now.",
    approve: "Approve",
    decline: "Decline",
    // Mono status shown in place once a request is decided (uppercased in the view).
    statusApproved: "Approved",
    statusDeclined: "Declined",
  },
  // "Story Browse (Hub)" surface — Feed / Timeline / Search modes + family-scope filter + the
  // restyled Read view.
  browse: {
    // Mode segmented control
    modeFeed: "Feed",
    modeTimeline: "Timeline",
    modeSearch: "Search",
    // Family-scope filter
    scopeAll: "All families",
    // Feed empty state (scope-aware). scopeName: "your families" or "the {family} family".
    scopeNameAll: "your families",
    scopeNameFamily: (family: string) => `the ${family} family`,
    feedEmpty: (scopeName: string) => `Nothing shared with you yet in ${scopeName}.`,
    feedEmptySub:
      "Once someone in the family answers a question or tells a story, it will appear here for you to listen to or read.",
    // Timeline
    timelineHeadingWhole: "The whole family, by era",
    timelineHeadingNarrator: (name: string) => `${name}’s life, by era`,
    widenWhole: "Whole family",
    widenNarrator: (name: string) => `Just ${name}`,
    undated: "Undated",
    // Chronicle Search
    searchPlaceholder: "Search titles, places, moments…",
    searchIdle:
      "Search across everything shared with you — titles, summaries, places, and tags.",
    searchCount: (n: number) => `${n} ${n === 1 ? "story matches" : "stories match"}`,
    searchNoResults: (query: string) => `No stories match “${query}”`,
    searchNoResultsHint:
      "Try a name, a place, or a moment like “wedding” or “the storm”.",
    // Read + Listen view
    back: "Back",
    toldBy: (name: string) => `Told by ${name}`,
    readListenTitle: (name: string) => `${name}’s voice — the original recording`,
    readStory: "Story",
    readTranscript: "Transcript",
    readNoProse: "No prose yet — the original recording above is the whole story for now.",
    readNoTranscript: "No transcript yet.",
  },
  copyButton: {
    copied: "Copied ✓",
    copy: "Copy",
  },
  answer: {
    backToQuestions: "← Back to questions",
    askedBy,
    assembling: "Putting your story together…",
    assemblingSub: "This takes just a moment.",
    recordedAt,
    whoShouldHear: "Who should hear this?",
    reviewYourWords: "Read it over — edit anything that isn't quite right",
    genericError: "Something went wrong. Please try again.",
    shareWithFamily: "Share with family",
    reRecord: "Re-record",
    discard: "Discard",
    micError:
      "Something went wrong with the microphone. Make sure you've allowed microphone access, then refresh the page to try again.",
    listeningTapStop: "Listening… tap to stop",
    // "One moment…" / "Tap to speak" live in common.voiceButton (shared with other capture surfaces).
    takeYourTime: "Take your time. Long silences are fine.",
    // Optimistic review: shown over the editor slot while transcribe+render runs.
    polishing: "Polishing your words…",
    polishingSub: "Your recording is saved — this just takes a moment.",
    recordAgain: "Record again",
    // Soft cap: the processing poll ran past its window without the story becoming ready. The
    // recording is safe (it's slow or stuck out-of-band); never spin forever — say so warmly.
    takingLonger:
      "This is taking longer than usual. Your recording is safe — check back in a little while.",
    // Follow-up thread (Task 7): the interviewer proposes a deepening question; declining is a
    // first-class, peer-level path — never a dead end.
    followUpIntro: "One more, if you'd like:",
    thatsAllForNow: "That's all for now",
    // Shown on the follow-up screen while finishThreadAction stitches + polishes (a multi-second
    // inline render) so the decline tap visibly registers — declining is never a dead end.
    finishing: "One moment…",
    followUpTakeLabel: "Follow-up",
    dropTake: "Remove this part",
    initialAnswerLabel: "Your answer",
    // ADR-0009 Phase 3 — the photo(s) this ask is ABOUT, shown to the narrator on the answer surface.
    aboutThisPhoto: "About this photo",
  },
  // Generalized story composer (ADR-0007): the capture voice⇄text toggle + the review title field.
  // Shared by the answer flow (an ask) and the self-initiated telling (/hub/tell, no ask).
  compose: {
    backToStories: "← Back to stories",
    titleLabel: "Title",
    typeIt: "Type it",
    textareaLabel: "Your story",
    speak: "Speak",
    tellPrompt: "What do you want to remember?",
    textPlaceholder: "Write it however it comes to you.",
    continueLabel: "Continue",
    inputModeAria: "How would you like to tell this?",
    // ADR-0009 Phase 3 — "tell the story of this photo" starts a telling ABOUT an album photo. The
    // caption seeds a warm prompt; the photo rides through as the story's subject/cover.
    photoStoryPrompt: (caption: string | null) =>
      caption ? `Tell the story of this photo — ${caption}` : "Tell the story of this photo",
  },
  actions: {
    notSignedIn: "Not signed in.",
    invalidInput: "Invalid input.",
    notForYou: "This question is not for you.",
    alreadyAnswered: "That question has already been answered.",
    recordingEmpty: "Recording was empty. Please try again.",
    saveFailed: "Could not save your recording. Please try again.",
    pickAudience: "Please pick an audience before sharing.",
    storyNotFound: "Story not found.",
    shareFailed: "Something went wrong sharing your story. Please try again.",
    removeFailed: "Could not remove the recording. Please try again.",
    noFamily: "Join or start a family before adding photos.",
    noAlbumChosen: "Choose at least one album for this photo.",
    photoEmpty: "No photo was selected. Please choose an image.",
    photoUploadFailed: "Could not add your photo. Please try again.",
    tooManyPhotos: "That's too many photos at once. Please add up to 30 at a time.",
    captionTooLong: "That caption is too long. Please shorten it.",
    notAllowedToManagePhoto: "You can't change this photo.",
    // ADR-0009 Phase 2 — story accompaniment photo attach/detach/cover/reorder errors.
    photoAttachFailed: "Couldn't add that photo. Please try again.",
    photoUpdateFailed: "Couldn't update the photos. Please try again.",
  },
  album: {
    // Back-link on the standalone /hub/album deep-link route; returns to the album's tab home
    // (/hub?tab=album). Names its destination tab, matching backToStories / backToQuestions.
    backToAlbum: "← Back to album",
    title: "Family album",
    empty: "No photos yet. Add the first one below.",
    // "Add a photo" reads singular but the input accepts many at once (#16 multi-select) — the OS
    // picker copy already signals multi-select, so the label stays warm and simple.
    addLabel: "Add a photo",
    addButton: "Add to album",
    // Multi-upload batch summary: some files landed, some didn't. Shown as a gentle inline note (not
    // an error) after a partial-success batch, so the contributor knows exactly what got through.
    photosPartial: (added: number, failed: number) =>
      `Added ${added} ${added === 1 ? "photo" : "photos"}. ${failed} ${
        failed === 1 ? "photo" : "photos"
      } couldn't be added — you can try those again.`,
    // Shown when the upload never completes (the request threw — most often the photos were too large
    // for one request, or the connection dropped). Distinct from a per-file failure inside a batch.
    uploadError:
      "Couldn't add those photos. They may be too large — try adding fewer, or smaller, photos.",
    chooseAlbums: "Which albums?",
    switcherAria: "Choose which family album to view",
    photoAlt: (caption: string | null) => caption ?? "Family photo",
    // #18 — per-photo management controls (contributor or steward).
    addCaption: "Add a caption",
    captionLabel: "Caption",
    captionPlaceholder: "e.g. Wedding day, 1961",
    save: "Save",
    cancel: "Cancel",
    deletePhoto: "Delete",
    confirmDelete: "Tap again to remove",
    managePhotoAria: (caption: string | null) =>
      caption ? `Manage “${caption}”` : "Manage photo",
    captionSaveError: "Couldn't save that caption. Please try again.",
    photoDeleteError: "Couldn't remove that photo. Please try again.",
    // Photo viewer (#18): tapping a tile opens a larger view that HOSTS the per-photo options
    // (edit caption, delete). The tile itself is the trigger; its label names what opens.
    viewPhoto: (caption: string | null) =>
      caption ? `View “${caption}”` : "View photo",
    // Dialog accessible name + its close control.
    viewerAria: (caption: string | null) =>
      caption ? `Photo: ${caption}` : "Photo",
    closeViewer: "Close",
    // ADR-0009 Phase 3 — start a telling ABOUT this photo (carries it forward as the story's subject).
    tellStoryOfPhoto: "Tell the story of this photo",
  },
  storyDetail: {
    // The "‹" chevron is a sized decorative glyph kept in JSX; this is just the word.
    back: "Stories",
    byline: (narrator: string, recordedAt: string) =>
      `Told by ${narrator} · Recorded ${recordedAt}`,
    noProse: "No prose yet — the original recording above is the whole story for now.",
  },

  // ADR-0009 Phase 2 — story accompaniment photos: the read-only gallery on the opened story and the
  // draft-editor attach/cover/remove/reorder controls in the composer's review phase.
  storyImages: {
    // Read-only gallery on the opened story (only rendered when the story has images).
    galleryHeading: "Photos",
    galleryAlt: (caption: string | null) => caption ?? "Story photo",
    // Editor (composer review phase).
    editorHeading: "Photos",
    editorHelp: "Add photos from your album to illustrate this story.",
    attachedHeading: "On this story",
    pickerHeading: "Add from your album",
    noAlbumPhotos: "No album photos yet. Add some in the Album tab first.",
    allAttached: "Every album photo is already on this story.",
    loadError: "Couldn't load your photos. Please try again.",
    // Per-image controls.
    setCover: "Make cover",
    coverBadge: "Cover",
    remove: "Remove",
    moveUp: "Move earlier",
    moveDown: "Move later",
    // Accessible labels naming the specific photo.
    attachAria: (caption: string | null) =>
      caption ? `Add “${caption}” to this story` : "Add this photo to the story",
    imageAlt: (caption: string | null) => caption ?? "Attached photo",
  },
} as const;

