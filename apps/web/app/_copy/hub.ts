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
    menuSwitchUser: "Switch user",
    menuLogOut: "Log out",
    sectionsAria: "Hub sections",
    unreadAria: (badge: number) => `${badge} unread`,
    // Hub scope selector — the `[ All ▾ ]` pill that scopes the hub to All or one family.
    scopeAria: "Choose which family to view",
    scopeAll: "All",
    scopeNoFamily: "No family yet",
    scopePending: (familyName: string) => `${familyName} — Pending ⏳`,
    scopeCreateFamily: "+ Create a family",
    scopeFindFamily: "🔍 Find a family to join",
    // Pending-only empty state (Task 4.6): a viewer who has reached the hub with no active family
    // yet (one pending join request). Shown by the read tabs in place of their generic empties.
    pendingEmpty: "Nothing here yet — you'll see stories once you're part of a family.",
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
    // Family multi-select (Increment 4B, Task 4.4): which family/families this question belongs to.
    // Shown only when the asker is in >1 family AND the hub scope is "all" (otherwise auto-resolved).
    familiesLabel: "Which family?",
    familiesHelp: "Choose at least one family this question belongs to.",
    familiesRequired: "Choose at least one family before sending.",
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
    // Disabled placeholder for the family <select> when the inviter is in >1 family and the hub scope
    // gives no default — forces an explicit pick so an invite never lands in an arbitrary first family.
    familyChoosePlaceholder: "Choose a family…",
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
    whichFamilies: "Which families should see this?",
    whichFamiliesHelp: "Choose one or more of your families.",
    whichFamiliesRequired: "Choose at least one family for this story.",
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
    // Follow-up thread (Task 7): the interviewer proposes a deepening question; declining is a
    // first-class, peer-level path — never a dead end.
    followUpIntro: "One more, if you'd like:",
    thatsAllForNow: "That's all for now",
    followUpTakeLabel: "Follow-up",
    dropTake: "Remove this part",
    initialAnswerLabel: "Your answer",
    // Shown after a follow-up take's audio is removed (ADR-0014 Inc 3 slice 7, decision d). The take's
    // words stay in the working prose on purpose — the recording is gone but the text is kept, so the
    // narrator edits it out themselves rather than losing it silently.
    takeDropped: "Recording removed — edit the text above to remove those words too.",
    // Finish + Finish-check (ADR-0014 Inc 3 slice 8). Finish seals the draft; the Finish-check offers a
    // gently polished version as an inline, dismissible card — taking it or dismissing both finish.
    finish: "Finish",
    finishCheckTitle: "A gentler version of your words",
    finishCheckBody: "We tidied it a little. Use this, or keep yours exactly as it is.",
    usePolishedVersion: "Use polished version",
    dismissFinishCheck: "Keep mine as is",
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
    // ADR-0009 Phase 4 · Slice B — the caption-driven "add this photo?" nudge above the album picker.
    // Only ever shown on a REAL caption match, so the mentioned wording can be quoted honestly.
    photoNudge: (caption: string | null) =>
      caption ? `You mentioned "${caption}" — add this photo?` : "Add a related photo?",
    photoNudgeAria: "Suggested photo",
    photoNudgeAdd: "Add this photo",
    photoNudgeDismiss: "Not now",
    photoNudgeDismissAria: "Dismiss this photo suggestion",
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
    photoUploadFailedDetail: (detail: string) =>
      `Could not add your photo (${detail}). Please try again.`,
    tooManyPhotos: "That's too many photos at once. Please add up to 30 at a time.",
    photoTooLarge:
      "That photo is too large to upload here. Try a smaller image, or import it from Google Photos.",
    photoHeicUnsupported:
      "This device format (HEIC) can't be uploaded directly. Export as JPEG, or import it from Google Photos.",
    photoEncodeFailed:
      "Couldn't prepare that photo for upload. Try another image, or import it from Google Photos.",
    captionTooLong: "That caption is too long. Please shorten it.",
    notAllowedToManagePhoto: "You can't change this photo.",
    // ADR-0009 Phase 2 — story accompaniment photo attach/detach/cover/reorder errors.
    photoAttachFailed: "Couldn't add that photo. Please try again.",
    photoUpdateFailed: "Couldn't update the photos. Please try again.",
    // Issue #32 — add-a-relative failures.
    noFamilyForKin: "Join or start a family before adding relatives.",
    addRelativeFailed: "Couldn't add that relative. Please try again.",
  },
  album: {
    // Back-link on the standalone /hub/album deep-link route; returns to the album's tab home
    // (/hub?tab=album). Names its destination tab, matching backToStories / backToQuestions.
    backToAlbum: "← Back to album",
    title: "Family album",
    empty: "No photos yet. Add the first one above.",
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
    // Always-visible caption entry field in the photo viewer (album enhancements item 3): the short
    // placeholder shown in the standing <input>, distinct from the longer example placeholder above.
    captionField: "Caption",
    save: "Save",
    cancel: "Cancel",
    deletePhoto: "Delete",
    confirmDelete: "Tap again to remove",
    managePhotoAria: (caption: string | null) =>
      caption ? `Manage “${caption}”` : "Manage photo",
    captionSaveError: "Couldn't save that caption. Please try again.",
    photoDeleteError: "Couldn't remove that photo. Please try again.",
    // Photo tag management (Phase B2): a non-committal error when a tag write fails — either the
    // viewer wasn't allowed (SEE/MANAGE denied) or the write threw (e.g. an ambiguous place). Mirrors
    // the captionSaveError style: warm, brief, and leaks nothing about why.
    tagSaveError: "Couldn't save that tag. Please try again.",
    tagRemoveError: "Couldn't remove that tag. Please try again.",
    retargetError: "Couldn't update the albums for that photo. Please try again.",
    tagPanelLoadError: "Couldn't load the details for that photo.",
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
    // Album enhancements (2026-07-13) — the shared per-photo action bar, used BOTH as a compact hover
    // toolbar overlaid on a grid thumbnail and as the labeled action row in the photo viewer.
    // Group accessible name wrapping the action buttons.
    photoActionsAria: (caption: string | null) =>
      caption ? `Actions for “${caption}”` : "Photo actions",
    // Compact-toolbar action labels (icon buttons carry these as their accessible names / tooltips).
    editPhoto: "Edit",
    askAboutPhoto: "Ask a question about this photo",
    askAboutPhotoShort: "Ask",
    tellStoryOfPhotoShort: "Tell a story",
    tagPeople: "Tag people",
    tagFaces: "Tag faces",
    // Faces is a deliberate no-op until face-region ML lands — the title explains why it does nothing.
    tagFacesComingSoon: "Tagging faces is coming soon",
    // Photo tag panel (Phase B3) — the four labeled sections in the viewer's manage area. Subjects =
    // who the photo is ABOUT; People = who APPEARS in it; Places = where; Family = which album(s) it
    // is PLACED in (a placement, not a tag).
    tagPanelAria: "Photo details",
    tagPanelLoading: "Loading photo details…",
    subjectsLabel: "Who this is about",
    subjectsHelp: "The people this photo is really about.",
    peopleLabel: "Who appears",
    peopleHelp: "Everyone who shows up in the photo.",
    placesLabel: "Where",
    placesHelp: "Places pictured in this photo.",
    familyPlacementLabel: "Which family albums",
    familyPlacementHelp: "Which family albums this photo lives in.",
    // Person/place typeahead affordances (mirrors TagInput's create rows).
    personFieldPlaceholder: "Add a person…",
    placeFieldPlaceholder: "Add a place…",
    addPersonNamed: (name: string) => `Add “${name}” as a new person`,
    addPlaceNamed: (name: string) => `Add “${name}” as a new place`,
    removeTag: (name: string) => `Remove ${name}`,
    // The last family album can't be removed — a photo must live in at least one album.
    lastFamilyLocked: "A photo must stay in at least one family album.",
    unnamedPerson: "Unnamed",
    // View selector (Grid / Masonry / List) — a segmented control above the album.
    viewSelectorAria: "Choose album layout",
    viewGrid: "Grid",
    viewMasonry: "Masonry",
    viewList: "List",
    // Thumbnail-size slider — one affordance that resizes tiles in every view.
    thumbnailSizeLabel: "Thumbnail size",
    thumbnailSmaller: "Smaller",
    thumbnailLarger: "Larger",
    // List-view column headers.
    listColPhoto: "Photo",
    listColCaption: "Caption",
    listColUploader: "Added by",
    listColFamilies: "Families",
    listColTags: "Tags",
    // ADR-0009 Phase 5 — Google Photos Picker (connect-once). Shown only when configured.
    googlePhotosConnect: "Connect Google Photos",
    googlePhotosImport: "Import from Google Photos",
    googlePhotosDisconnect: "Disconnect Google Photos",
    // Trigger for the right-aligned "Manage connections ▾" dropdown that holds the Disconnect
    // action(s) once a source is connected. Structured for future sources (Google is the only one now).
    manageConnections: "Manage connections",
    // Brief pending state on the Disconnect menu item while the connection is being torn down.
    googlePhotosDisconnecting: "Disconnecting…",
    // Generic menu header shown above the Disconnect item when the account email is unknown.
    googlePhotosSourceName: "Google Photos",
    // Shown when the disconnect action REJECTS at the transport level (network/Server Action failure)
    // rather than returning a handled { error } — so the menu never hangs silently on "Disconnecting…".
    googlePhotosDisconnectError:
      "Couldn't disconnect Google Photos. Please try again.",
    googlePhotosImporting: "Opening Google Photos…",
    googlePhotosWaiting: "Pick your photos in the Google Photos window…",
    googlePhotosImportFailed: "Couldn't import from Google Photos. Please try again.",
    googlePhotosPickerTimedOut:
      "Google Photos didn't confirm your selection in time. Finish picking in the Google Photos window, then try again.",
    googlePhotosPopupBlocked:
      "Your browser blocked the Google Photos window. Allow pop-ups for this site (not just redirects), then try Import again.",
    googlePhotosReconnect:
      "Your Google Photos connection needs to be refreshed. Disconnect, then connect again.",
    googlePhotosNothingImported:
      "Google Photos finished, but no photos came through. Try again with still photos (not videos), or pick fewer at a time.",
    googlePhotosNotConnected: "Connect Google Photos first, then try importing.",
    googlePhotosUnavailable: "Google Photos isn't available right now.",
    googlePhotosConnectedSuccess:
      "Google Photos connected. You can import photos any time.",
    googlePhotosOAuthDenied: "Google Photos connection was cancelled.",
    googlePhotosOAuthInvalidState:
      "That connection link expired. Please try connecting again.",
    googlePhotosOAuthExchangeFailed:
      "Couldn't finish connecting Google Photos. Please try again.",
    // ADR-0015 · F2 — in-grid per-item import progress (flag-gated). A placeholder tile sits at the
    // top of the grid while its photo imports; on failure it becomes a tap-to-retry button. The live
    // "X of N" line reassures the contributor that the batch is landing one photo at a time.
    // Accessible label on an in-flight placeholder tile (screen-reader announces the pending import).
    importingTile: "Importing…",
    // Label on a failed placeholder tile — the whole tile is a button that retries just that photo.
    retryImportTile: "Tap to retry",
    // Live progress line shown while any placeholder is still importing (done = successes so far).
    importProgress: (done: number, total: number) => `Adding ${done} of ${total}…`,
    googlePhotosPartial: (added: number, failed: number, skipped: number) => {
      const parts: string[] = [];
      parts.push(
        `Added ${added} ${added === 1 ? "photo" : "photos"} from Google Photos.`,
      );
      if (failed > 0) {
        parts.push(
          `${failed} ${failed === 1 ? "photo" : "photos"} couldn't be added.`,
        );
      }
      if (skipped > 0) {
        parts.push(
          `${skipped} ${skipped === 1 ? "video was" : "videos were"} skipped.`,
        );
      }
      return parts.join(" ");
    },
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

  profile: {
    backToHub: "← Back to hub",
    title: "Your profile",
    subtitle: "Changes save automatically when you leave each field.",
    identityHeading: "Who you are",
    identityIntro: "The name your family sees, what we say when we talk with you, and your birthday.",
    spokenNameLabel: "What we call you aloud",
    spokenNameHelp: "The interviewer uses this name — it can differ from your full name.",
    emailLabel: "Email",
    emailHelp: "Managed by your sign-in provider; not editable here.",
    birthdayLabel: "Birthday",
    introHeading: "Your introduction",
    introIntro:
      "These details help your family ask better questions. First-time answers are collected in the guided introduction; edit them here anytime.",
    anchorLabels: {
      hometown: "Where you grew up",
      siblingContext: "Brothers and sisters",
      currentLocation: "Where you call home now",
      occupationSummary: "Work over the years",
      hasChildren: "Children",
      hasGrandchildren: "Grandchildren",
    },
    notAnswered: "Not answered",
    yes: "Yes",
    no: "No",
    saving: "Saving…",
    saved: "Saved",
    saveError: "Could not save — try again.",
    // 2026-07-12 pedigree-nav redesign (W agent): profile Sex control (card color only). No
    // profile-specific copy block existed pre-redesign — reuse `kin.sexFieldLabel` / `kin.sexMale`
    // / `kin.sexFemale` / `kin.sexUnknown` here rather than duplicating the strings.
  },

  settings: {
    backToHub: "← Back to hub",
    title: "Settings",
    subtitle: "Display preferences for this device.",
    textSizeHeading: "Text size",
    textSizeIntro: "Makes everything on the screen a little larger or smaller.",
    paletteHeading: "Color palette",
    paletteIntro: "Choose the mood of the chronicle on this device.",
    paletteAria: "Color palette",
    paletteShort: {
      heirloom: "Heirloom",
      archive: "Archive",
      hearth: "Hearth",
    },
    paletteLabels: {
      heirloom: "Heirloom palette — warm terracotta and sage",
      archive: "Archive palette — cool gray and teal",
      hearth: "Hearth palette — warm rose and coral",
    },
  },
  // Issue #32 — the kin surface (/hub/kin): view your relatives + add one.
  kin: {
    signedOut: "Sign in to see your family tree.",
    heading: "Your relatives",
    intro:
      "The people you record as kin in this family. Adding a relative is enough — no one has to confirm it.",
    // Empty state when the viewer has recorded no kin yet.
    empty: "You haven't added any relatives yet. Add the first one below.",
    // Shown when the viewer belongs to no family at all.
    noFamily: "Join or start a family before adding relatives.",
    deceased: "In memory",
    // Human display label per KinRelation (derived by core's deriveKin).
    relationLabel: {
      parent: "Parent",
      child: "Child",
      partner: "Partner",
      sibling: "Sibling",
      grandparent: "Grandparent",
      grandchild: "Grandchild",
      aunt_uncle: "Aunt/Uncle",
      niece_nephew: "Niece/Nephew",
      cousin: "Cousin",
    },
    // Fallback name for an unidentified placeholder person (anonymous bridge node) — rendered from
    // its relation rather than a name. "Unknown parent" for a directly-named relation, else generic.
    unknownRelative: "Unknown relative",
    unknownOf: (relationLabel: string) => `Unknown ${relationLabel.toLowerCase()}`,
    // The add-relative form.
    addHeading: "Add a relative",
    addIntro:
      "Pick how they're related to you and, if you like, their name. Add a grandparent in one tap — we'll fill in the missing generation for you.",
    relationFieldLabel: "How are they related to you?",
    relationOptions: {
      parent: "Parent",
      child: "Child",
      partner: "Partner",
      sibling: "Sibling",
      // Made explicit that one tap adds them + the implicit unknown parent bridge.
      grandparent: "Grandparent (adds an unknown parent automatically)",
    },
    nameFieldLabel: "Their name (optional)",
    namePlaceholder: "e.g. Eleanor",
    nameHint: "Leave blank to add them without a name for now.",
    dobFieldLabel: "Date of birth (optional)",
    lifeStatusFieldLabel: "Are they living?",
    lifeStatusLiving: "Living",
    lifeStatusDeceased: "No longer living",
    // Shown only when life status = "No longer living" (ADR-0016 tree renderer death-year capture).
    deathYearFieldLabel: "Year they died (optional)",
    deathYearPlaceholder: "e.g. 1998",
    // 2026-07-12 pedigree-nav redesign: optional Sex select (card color only, never a relation label).
    sexFieldLabel: "Sex (optional)",
    sexMale: "Male",
    sexFemale: "Female",
    sexUnknown: "Prefer not to say",
    // Add-child co-parent picker: attach the child to a second parent (the anchor's partner).
    otherParentLabel: "Other parent (optional)",
    otherParentNone: "No other parent",
    submit: "Add relative",
    submitting: "Adding…",
    // Issues #33/#34 — the governance list (steward affirm/deny/correct + subject hide/unhide).
    govHeading: "Relationships in this family",
    govIntro:
      "Every relationship anyone records shows up here as soon as it's added. As steward you can endorse, remove, or correct one; if a relationship is about you, you can hide it.",
    govEmpty: "No relationships recorded in this family yet.",
    // The two ungendered primitives, rendered for a row.
    edgeParentOf: (parent: string, child: string) => `${parent} is a parent of ${child}`,
    edgePartneredWith: (a: string, b: string) => `${a} and ${b} are partners`,
    edgeUnknownPerson: "someone unnamed",
    natureLabel: {
      biological: "biological",
      adoptive: "adoptive",
      step: "step",
      foster: "foster",
      unknown: "",
    } as Record<string, string>,
    stateAffirmed: "Endorsed by steward",
    // Steward controls.
    affirm: "Endorse",
    affirming: "Endorsing…",
    deny: "Remove",
    denying: "Removing…",
    // Subject controls.
    hide: "Hide this from the tree",
    hiding: "Hiding…",
    // Generic failure for a governance/hide action.
    govActionFailed: "Couldn't do that. Please try again.",
  },
  // Story-subject tagging (issue #35) — who a story is about.
  subjects: {
    heading: "Who this is about",
    empty: "No one is tagged in this story yet.",
    addLabel: "Add someone this story is about",
    namePlaceholder: "Their name",
    add: "Tag them",
    adding: "Tagging…",
    remove: "Remove",
    storiesAboutHeading: (name: string) => `Stories about ${name}`,
    storiesAboutEmpty: "No stories yet.",
    back: "← Back",
  },
  // Unified tag field (spec 2026-07-13-unified-tags-photos §1) — freeform tags + people + families.
  tagInput: {
    label: "Tags & people",
    help: "Add a tag, or type a name to tag a person or share with a family.",
    placeholder: "Add a tag or name…",
    addAsPerson: (name: string) => `Add “${name}” as a person`,
    addAsTag: (name: string) => `Add “${name}” as a tag`,
    groupPeople: "People",
    groupFamilies: "Families (shares this story)",
    groupTags: "Tags",
    familyChipTitle: "Shared with this family",
    confirmRevoke: (name: string) => `Stop sharing this story with ${name}?`,
    remove: "Remove",
    unnamedPerson: "Unnamed person",
  },
  // Visual family tree (ADR-0016 tree renderer) — read-first, /hub/tree.
  tree: {
    heading: "Family tree",
    // Link from the /hub/kin list surface across to the visual tree, and back.
    openTree: "View family tree",
    // Link from a story-detail byline into the tree, rooted on that story's narrator (Task 9).
    openInTree: "View in family tree",
    backToKin: "← Relatives",
    // Empty state (no-family only — an isolated focus is the tree itself, spec §8).
    noFamily: "Join or start a family to see your family tree.",
    // Fallback for an unidentified bridge node, rendered from its relation.
    unknownOf: (relationLabel: string) => `Unknown ${relationLabel.toLowerCase()}`,
    unknownRelative: "Unknown relative",
    // Canvas controls.
    fit: "Fit",
    pan: "Drag to pan",
    // Tap detail panel — read-only actions.
    panelStories: "Stories about them",
    panelAddParent: "Add parent",
    panelAddChild: "Add child",
    panelAddSibling: "Add sibling",
    panelManageKin: "Manage kin",
    // Panel add-partner link (relation=partner).
    addPartner: "Add partner",
    // Per-card KebabMenu labels.
    // Neutral label for the ⋮ trigger itself (the menu holds several add actions, so it must not be
    // labeled as any single one).
    moreActions: "Add a relative",
    kebabAddChild: "Add child",
    kebabAddSibling: "Add sibling",
    kebabAddParent: "Add parent",
    kebabAddPartner: "Add partner",
    // Per-direction caret aria labels (collapse/expand an already-drawn branch; add via "+").
    collapseParents: "Collapse ancestors",
    expandParents: "Expand ancestors",
    collapseChildren: "Collapse descendants",
    expandChildren: "Expand descendants",
    // Sibling caret aria labels (ego-centric redesign, spec §3/§4).
    collapseSiblings: "Collapse siblings",
    expandSiblings: "Show siblings",
  },
} as const;

