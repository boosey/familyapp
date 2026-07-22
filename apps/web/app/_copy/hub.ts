// apps/web/app/_copy/hub.ts
// Copy for the signed-in hub: shell, tabs, story browser, answer flow, server-action errors.

// Shared meta-label formatters — the Questions tab and the Answer screen render these identically.
const askedBy = (name: string) => `${name.toUpperCase()} ASKED`;
const recordedAt = (label: string) => `RECORDED ${label.toUpperCase()}`;

export const hub = {
  shell: {
    // Signed-out visitors are redirected to the root landing (the sign-in/sign-up front door),
    // so the hub shell itself has no anonymous copy.
    chronicle: "Your Stories",
    tabStories: "Stories",
    // Sits between Stories and Questions — the hub's home for the Family album (#19).
    tabAlbum: "Album",
    // Task 3 (Scrapbook de-clutter): "Questions" is now the PRIMARY tab label, grouping the three
    // ask-related surfaces (To answer / Ask a question / Your asks) under one primary tab with a
    // secondary sub-nav. It used to read "To answer" (that wording moved to questionsSubToAnswer).
    // The section heading inside the To-answer surface stays "Questions for you" (hub.questions.title).
    tabQuestions: "Questions",
    tabAsk: "Ask a question",
    tabAsks: "Your asks",
    // The family surface (tree + relatives list) — a real in-hub tab now, not a standalone route.
    tabFamily: "Family",
    tabInvite: "Invite",
    // ADR-0025 Increment 3 Step B — on the compact Family strip the Invite action is iconified
    // (UserRoundPlus glyph); this is its accessible name (menu/target unchanged, only the trigger icon).
    inviteAria: "Invite",
    tabRequests: "Requests",
    // Secondary sub-nav inside the Questions primary tab — the three consolidated ask surfaces.
    // "Ask" (not "Ask a question") so the three equal-width pills fit ONE line at 360px — the long label
    // wrapped the middle segment to two lines. The primary-tab `tabAsk` keeps the full "Ask a question".
    questionsSubToAnswer: "To answer",
    questionsSubAsk: "Ask",
    questionsSubYourAsks: "Your asks",
    questionsSubNavAria: "Question sections",
    // Issue #124 (Scrapbook de-clutter): secondary sub-nav inside the Family primary tab — the tree/
    // relatives view and the steward's Requests queue (which used to be a "More ▾" overflow entry).
    // The Requests sub-label reuses `tabRequests`.
    familySubTree: "Family tree",
    // ADR-0025 device round: the compact Family strip uses the SHORT "Tree" for the tree pill so the
    // three equal-width pills (Tree/List/Requests) fit ONE line beside the Family icon + Invite at 360px
    // (the long "Family tree" wrapped the pill to two lines). Desktop keeps "Family tree" (roomy toolbar).
    familySubTreeShort: "Tree",
    familySubNavAria: "Family sections",
    menuProfile: "Your profile",
    menuSettings: "Settings",
    menuSwitchUser: "Switch user",
    menuLogOut: "Log out",
    // Account-menu family actions (ADR-0021): moved off the retired scope pill. Universal — they work
    // for no-family and single-family viewers, who never see a family-filter chip bar.
    menuCreateFamily: "Create a family",
    menuFindFamily: "Find a family to join",
    // Steward-only Edit-a-Family entry point (#54). Shown once per family the viewer stewards.
    menuFamilySettings: "Family settings",
    menuFamilySettingsNamed: (name: string) => `${name} settings`,
    sectionsAria: "Hub sections",
    // ADR-0025 mobile Phase B: accessible name for the fixed bottom tab bar (the mobile counterpart to
    // the top `sectionsAria` nav). Distinct wording so the two navs never read as the same landmark.
    bottomNavAria: "Primary sections",
    // ADR-0025 device round (#233): the bottom bar's 5th item — the account/profile entry (a menu
    // trigger, NOT a hub tab). `tabAccount` is its tiny label; `accountSheetTitle` titles the sheet it
    // opens (the same profile/settings/switch-user/log-out menu the desktop avatar dropdown shows).
    tabAccount: "Account",
    accountSheetTitle: "Your account",
    unreadAria: (badge: number) => `${badge} unread`,
    // Family filter (ADR-0021) — the shared chip bar's accessible group name. The bar renders only for
    // a viewer with ≥2 families; each chip toggles whether that family is included in the browse view.
    familyFilterAria: "Filter by family",
    // Family designator (ADR-0021) — the same chip bar in single-select action mode (Asks, Requests):
    // it picks which family you act on / view, SEEDED from the filter but never written back to the URL.
    familyDesignatorAria: "Choose a family",
    // Pending-only empty state (Task 4.6): a viewer who has reached the hub with no active family
    // yet (one pending join request). Shown by the read tabs in place of their generic empties.
    pendingEmpty: "Nothing here yet — you'll see stories once you're part of a family.",
  },
  // ADR-0025 collapsed browse panels — per-concern IconSheet triggers (View/Family/Filter/Search).
  // Compact (< 40rem) opens a BottomSheet; wide opens an AnchoredPopover (#300). Panel body is shared.
  // Hub progressive row (#296/#297) collapses these by precedence on Stories/Album/Family/Questions.
  mobileControls: {
    // Accessible name for an IconSheet's active-filter count badge (n = active filters for that icon).
    activeCountAria: (n: number) => `${n} ${n === 1 ? "filter" : "filters"} active`,
    // Shared ✕ close control for BottomSheet and AnchoredPopover.
    close: "Close",
    // Per-concern labeled icon-sheets: View (layout / tree zoom), Family (selector), Filter (Album
    // facets), Search (Stories text search — never labeled "Filter"). Each string is BOTH the tiny
    // icon label and its panel title (sheet or popover).
    viewLabel: "View",
    familyLabel: "Family",
    filterLabel: "Filter",
    // Stories (#301) + Album (#302) collapsed search — Search glyph/label/panel, not Filter.
    searchLabel: "Search",
    // Sub tabs progressive stages (#301/#297): iconized pills keep mode names as accessible names;
    // menu-icon opens a lightweight menu (not a sheet) of the same modes. `subTabsLabel` is the tiny
    // caption under the menu-icon glyph (clarity bet — labeled collapsed icons).
    subTabsLabel: "Modes",
    subTabsMenuAria: "Browse modes",
    modeFeedAria: "Feed",
    modeTimelineAria: "Timeline",
    /** Family Sub tabs icon-pills (#297). */
    modeTreeAria: "Tree",
    modeListAria: "List",
    modeRequestsAria: "Requests",
    // The primary action (Tell a story) may iconify under width pressure (outside collapse precedence).
    tellAria: "Tell a story",
  },
  stories: {
    untitled: "Untitled",
    empty:
      "No stories yet. When someone shares their stories with you, they'll appear here.",
    // Self-initiated telling (ADR-0007): the Stories-tab entry into /hub/tell, plus the resume list
    // for ask-less drafts still in review. `tellTitle` labels the right-justified control-row button
    // (#125 — the single Tell-a-story affordance); `resume` is the per-draft link in the expanded list.
    tellTitle: "Tell a story",
    resume: "Finish",
    // Compact draft-reminder button in the single control row (#125): a small top line naming the
    // count, and a "finish them" action line beneath it. Tapping it expands the per-draft resume list.
    draftReminder: (n: number) => `You have ${n} draft ${n === 1 ? "story" : "stories"}`,
    draftReminderAction: "finish them",
    // Family filter (ADR-0021, #47): every chip toggled OFF (an explicit empty selection) — an honest
    // empty state rather than a silent "show all". Mirrors album.noFamiliesSelected for the stories pool.
    noFamiliesSelected: "No families selected — turn one on above to see their stories.",
    // Highlight-to-treasure (Task 8): drag across the prose to treasure the story (fires the existing
    // Like path as a SET). The tap heart stays the primary affordance; this is the warm shortcut.
    treasureAria: "Highlight any words to treasure this story",
    treasureHint: "Tip: highlight a line that moved you to treasure it.",
  },
  intake: {
    // Compact intake reminder on the Stories control row (#138) — a two-line button (matching the
    // draft-reminder button) shown until the narrator's biographical profile is complete. Links to
    // /hub/about-you (the intake surface). Replaces the former full-width banner.
    reminderTop: "Finish your introduction",
    reminderAction: "add details",
    // Accessible name for the compact reminder link (the two visible lines are decorative spans).
    aria: "Finish your introduction — add a few details about your life",
  },
  pendingInvites: {
    // #120 — confirm cards surfaced when the viewer's VERIFIED email/phone matches a live pending
    // invitation. Explicit confirm only; "Not me" never revokes the invite. The card names the
    // inviter and the family — never the inviter-typed invitee name.
    aria: "Invitations waiting for you",
    cardLine: (inviterName: string, familyName: string) =>
      `${inviterName} invited you to join the ${familyName} family`,
    blurb:
      "We matched this invitation to your email or phone number. Only join if it's really meant for you.",
    join: "Join",
    notMe: "Not me",
    noLongerAvailable:
      "That invitation is no longer available — it may have been accepted or expired.",
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
    // #204: the panel leads straight with the form — no heading/intro/prompt card, no family
    // designator (asks submit FAMILYLESS now). The person selector is a type-ahead combobox.
    forLabel: "For",
    forPlaceholder: "Type a name…",
    // Custom-validity message on the person combobox: blocks submit until a real option is chosen.
    forInvalid: "Choose someone from the list.",
    // ADR-0006 marker suffixing pending invitees in the person selector.
    invitedNote: "(invited)",
    noPersonMatches: "No one by that name.",
    questionLabel: "Your question",
    questionPlaceholder: "e.g. What was your mother singing on Sunday mornings?",
    submit: "Send Question",
    // ADR-0009 Phase 3 + #204 — an optional MODAL photo picker so an ask can be ABOUT one or more
    // album photos ("tell the story of THIS photo"). Only photos the asker can already see are
    // offered; the closed form shows a lightweight count + thumbnails of the current selection.
    photosAdd: "Add photos",
    photosSelected: (count: number) =>
      count === 1 ? "1 photo selected" : `${count} photos selected`,
    photosModalTitle: "Choose photos",
    photosHelp: "Ask about a specific photo — they'll see it when they answer.",
    photosDone: "Done",
    photoPickerLoadError: "Couldn't load your album photos. You can still send the question.",
    attachPhotoAria: (caption: string | null) =>
      caption ? `Ask about “${caption}”` : "Ask about this photo",
    removePhotoAria: (caption: string | null) =>
      caption ? `Remove “${caption}” from this question` : "Remove this photo from the question",
  },
  // Follow-up question on an already-published story (#77). The affordance lives on the story detail;
  // submitting routes into the existing ask queue linked to the story, surfacing in the narrator's
  // next session.
  followUp: {
    open: "Ask a follow-up",
    heading: (narratorName: string) => `Ask ${narratorName} a follow-up`,
    intro:
      "Your question goes into the queue, tied to this story. It'll be asked next time they sit down to talk.",
    label: "Your follow-up question",
    placeholder: "e.g. What happened to the house after that summer?",
    submit: "Send to the queue",
    cancel: "Cancel",
    sending: "Sending…",
    sent: "Sent. It's in the queue for their next session.",
    empty: "Write a question first.",
    failed: "Couldn't send that question. Try again.",
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
    narratorReadyTitle: "Their link is ready",
    narratorReadyBlurb:
      "Send this to them however you usually talk — a text or an email. Tapping it opens a gentle voice session where they can simply start telling their stories. No password, no sign-up, nothing to install.",
    fingerprintNote:
      "For safety we keep only a fingerprint — you won't see this link again. Save it now if you need to send it later; switching tabs or refreshing will clear it.",
    memberReadyTitle: "Invitation link is ready",
    memberReadyBlurb:
      "Send this to your relative. Opening it lets them create a login and join your family — you don't have to set anything up for them.",
    // Task 9 — delivery-status readout. Delivery is async (off the request path), so this is the only
    // signal the inviter gets that anything was sent; the copy-link below is always the honest fallback.
    sendingTo: (targets: string) =>
      `Sending your invitation to ${targets}. If it doesn't arrive, you can still share the link below.`,
    signedOut: "Sign in to invite someone.",
    memberHeading: "Invite a family member",
    memberBody:
      "Send a relative a link to create their own login and join the family. They'll confirm who they are, then go through a short welcome.",
    nameLabel: "Their name",
    namePlaceholder: "e.g. Rosa Esposito",
    // #118: email and phone are individually optional but AT LEAST ONE is required — see
    // identifierHint/identifierRequired.
    emailLabel: "Their email",
    emailPlaceholder: "rosa@example.com",
    phoneLabel: "Their phone",
    phonePlaceholder: "+1 555 123 0000",
    phoneInvalid: "That phone number doesn't look right — check the format and try again.",
    identifierHint:
      "Give at least one — an email or a phone number. It's how we recognize them if they join without the link, and how we avoid inviting the same person twice.",
    identifierRequired:
      "Add an email or a phone number — at least one — so we can recognize them when they join.",
    emailRequired: "Add their email to send it by email — or choose another way below.",
    phoneRequired: "Add their phone number to text it — or choose another way below.",
    // #119 — the duplicate-member guard refusing an invite to someone already in the family.
    alreadyMember:
      "They're already a member of this family — no invitation needed.",
    // #105 — shown when the generous invite-send throttle refuses an invite (bulk-paste accident
    // guard). Plain-language: no numbers, no "rate limit" jargon.
    throttled:
      "That's a lot of invitations in a short time. Take a breather and try again a little later — if you're inviting a big group, spread it out over the day.",
    // #164 (ADR-0023): a STRUCTURED relationship picker (fixed vocabulary) — the placement signal
    // that positions the member on the family tree the moment they accept. The value names the
    // invitee's role relative to the inviter ("My son" ⇒ they are the inviter's son).
    relationshipQuestion: "How are they related to you?",
    relationshipHelp:
      "This places them correctly in your family tree when they join. Choose “Someone else” if none of these fit — you can position them later.",
    // Option labels, keyed by the machine value sent to core.createInvitation.
    relationshipOptions: {
      wife: "My wife",
      husband: "My husband",
      mother: "My mother",
      father: "My father",
      son: "My son",
      daughter: "My daughter",
      other: "Someone else",
    },
    // The free-text label stored for the welcome screen, DERIVED from the pick (display only). Absent
    // for "other" — the invitee can type their own on the welcome screen.
    relationshipDisplayLabels: {
      wife: "Wife",
      husband: "Husband",
      mother: "Mother",
      father: "Father",
      son: "Son",
      daughter: "Daughter",
    },
    familyLabel: "Family",
    // Custom validity message when the family designator (ADR-0021, #49) blocks an empty submit — the
    // ambiguous >1-family case with no deliberate pick.
    familyRequired: "Choose a family for this invitation.",
    // #118 — the three send actions. The phone button doubles as the SMS consent: pressing it IS
    // the explicit ask to text them.
    sendToEmail: "Send to their email",
    sendToPhone: "Text it to their phone",
    getLink: "Get a link to share",
    narratorHeading: "Set up someone to record",
    narratorBody:
      "Choose a family member and we'll create their own private link. Opening it starts a gentle voice session — they just tap and talk, with no login, account, or app to set up. You hand them the link; they do the rest whenever they're ready.",
    narratorLabel: "Who's telling the stories?",
    createLink: "Create their link",
  },
  requests: {
    signedOut: "Sign in to review join requests.",
    title: "Requests to join",
    // #160: this sentence is no longer an inline paragraph — it's revealed by the circled-i info icon
    // beside the Requests heading (see `infoAria` for that icon's accessible name).
    intro:
      "As steward, you approve everyone who joins. Nothing is shared with a requester until you say yes.",
    // Accessible name for the circled-i info icon that reveals `intro` as a tooltip (#160).
    infoAria: "Why you approve requests",
    empty: "No requests waiting right now.",
    // Accessible name for a family chip's pending-request count badge (#140).
    pendingCountAria: (count: number) => `${count} pending`,
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
    // Feed layout toggle (Feed mode only) — single-column cards vs a masonry of cards.
    viewSelectorAria: "Choose feed layout",
    viewColumn: "Column",
    viewMasonry: "Masonry",
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
    // Story Search
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
    // Hold-to-record captions ("Hold to speak" / "Release to finish") live in common.voiceButton
    // (shared with other capture surfaces), alongside "One moment…" and "Tap to speak".
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
    photoUploadFailed: "Could not add your photo. Please try again.",
    photoUploadFailedDetail: (detail: string) =>
      `Could not add your photo (${detail}). Please try again.`,
    // issue #20 — the client declared a non-image (or unsupported image) content type when requesting a
    // direct-upload target. The server validates the type BEFORE presigning, so this is rejected up front.
    photoTypeUnsupported:
      "That file type can't be added to the album. Please choose a JPEG, PNG, GIF, or WebP image.",
    // issue #20 — the upload ticket that binds a storage key to the person who minted it was missing,
    // expired, tampered, or for a different person/key. A non-committal error; the client just retries.
    uploadTicketInvalid: "That upload expired. Please try adding the photo again.",
    // issue #20 — record was called for a key with no stored object (the browser PUT never landed, or
    // it was already recorded). Never record a phantom key; the client re-uploads.
    uploadObjectMissing: "That photo didn't finish uploading. Please try again.",
    tooManyPhotos: (max: number) =>
      `That's too many photos at once. Please add up to ${max} at a time.`,
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
    // Family filter (ADR-0021): every chip is toggled OFF (an explicit empty selection) — an honest
    // empty state rather than a silent "show all". No grid, no uploader until a family is turned on.
    noFamiliesSelected: "No families selected — turn one on above to see its photos.",
    // "Add a photo" reads singular but the input accepts many at once (#16 multi-select) — the OS
    // picker copy already signals multi-select, so the label stays warm and simple.
    addLabel: "Add a photo",
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
    // Bulk delete (Phase C): the request carried no photo ids to act on (a client bug / empty
    // selection). A non-committal, warm nudge — distinct from a per-item authz denial, which is
    // reported as a `failed` count rather than an error.
    noPhotosSelected: "No photos selected to remove.",
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
    // Trigger for the right-justified "Add Photos ▾" dropdown that consolidates every album entry
    // point (#93): the device picker, Google connect/import, and — below a divider — Manage connections.
    // Progressive row (#302): may iconify under width pressure (ImagePlus); `addPhotosMenu` still supplies
    // its aria-label (accessible name unchanged across the icon/label swap), so no separate key is needed.
    addPhotosMenu: "Add Photos",
    // First menu item: opens the OS file picker (the hidden file input). Shown only when file upload
    // is available (#93 — replaced the old standalone "Add to album" button).
    addFromDevice: "Add from your device",
    // #94 — files-first destination modal. After files are chosen (device) or the Google picker
    // returns, a >1-family viewer picks WHICH family album(s) receive the batch here (moved off the
    // standing toolbar fieldset). A solo-family viewer never sees this — the sole family auto-resolves.
    // Count-aware title for the device path (the chosen-file count is known up front); the Google
    // import path uses the count-agnostic fallback below (the returned count isn't known until the
    // picker completes, after this modal).
    destinationTitle: (count: number) =>
      `Add ${count === 1 ? "this photo" : `these ${count} photos`} to…`,
    destinationTitleGeneric: "Add these photos to…",
    // #94 — Google import only: the destination modal opens the moment the picker returns, but the
    // photos may still be settling on Google's side. This status (with a spinner) shows while we
    // confirm the selection is ready; Add is held disabled until then. The device path is instant
    // (no async prep) and never shows this.
    destinationPreparing: "Preparing your photos…",
    // The confirm control; disabled until ≥1 family is chosen (the sole home of the no-fan-out rule).
    destinationAdd: "Add",
    // The dismiss control — discards the pending selection; nothing has been uploaded yet.
    destinationCancel: "Cancel",
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
    // Phase C — search / filter bar above the album. A row of controls that narrow the photos on
    // screen (client-side, over the photos already loaded): who's in them, where, when, and caption text.
    filterBarAria: "Filter photos",
    filterPeopleLabel: "People",
    filterPlacesLabel: "Places",
    filterPeoplePlaceholder: "Anyone",
    filterPlacesPlaceholder: "Anywhere",
    filterPeriodLabel: "When",
    filterPeriodAll: "Any time",
    filterPeriodThisYear: "This year",
    filterPeriodFiveYears: "Last 5 years",
    filterPeriodOlder: "Older",
    filterTextLabel: "Search captions and tags",
    filterTextPlaceholder: "Search…",
    filterClear: "Clear filters",
    // Shown when the active filters exclude every photo (a real album that isn't empty).
    filterNoMatches: "No photos match those filters.",
    // Phase C — multi-select + bulk actions. Selection mode is entered by LONG-PRESSING a photo (#191
    // removed the standing "Select" toggle): checkboxes appear on every tile / row and a sticky action
    // bar appears once anything is picked. Esc — or the bulk bar's Clear — leaves selection mode.
    selectPhotoAria: (caption: string | null) =>
      caption ? `Select “${caption}”` : "Select photo",
    bulkBarAria: "Actions for the selected photos",
    // Live count of how many photos are picked (drives the bulk bar heading).
    bulkSelectedCount: (n: number) => `${n} ${n === 1 ? "photo" : "photos"} selected`,
    bulkAsk: "Ask one question about these",
    bulkTell: "Tell one story about these",
    bulkDelete: "Delete selected",
    bulkDeleteConfirm: "Tap again to remove",
    bulkClear: "Clear",
    bulkDeleting: "Removing…",
    // Non-committal note after a bulk delete: some removed, maybe some couldn't be (not the
    // contributor / not a steward, or a transient error) — mirrors photosPartial's warmth.
    bulkDeleteResult: (deleted: number, failed: number) =>
      failed > 0
        ? `Removed ${deleted} ${deleted === 1 ? "photo" : "photos"}. ${failed} ${
            failed === 1 ? "photo" : "photos"
          } couldn't be removed.`
        : `Removed ${deleted} ${deleted === 1 ? "photo" : "photos"}.`,
    bulkDeleteError: "Couldn't remove those photos. Please try again.",
  },
  storyDetail: {
    // The "‹" chevron is a sized decorative glyph kept in JSX; this is just the word.
    back: "Stories",
    byline: (narrator: string, recordedAt: string) =>
      `Told by ${narrator} · Recorded ${recordedAt}`,
    noProse: "No prose yet — the original recording above is the whole story for now.",
    // Title/tags editor (StoryEditor) save/cancel controls.
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    // Owner action (⋮) menu on the opened story.
    optionsLabel: "Story options",
    optionsMenuLabel: "Story options menu",
    // Fallback error for the title/tags editor save path.
    genericError: "Something went wrong. Please try again.",
  },
  // ADR-0026 Story date edit control (#241) — the modal next to the date on the opened story.
  // Save/saving/cancel and the generic error reuse `storyDetail`'s copy.
  storyDate: {
    edit: "Edit date",
    heading: "When did this happen?",
    kindDate: "On a date",
    kindPeriod: "Over a period",
    kindCirca: "Around a year",
    kindUndated: "No date — undated",
    dateLabel: "Date",
    startLabel: "Start",
    endLabel: "End",
    yearLabel: "Year",
    yearPlaceholder: "e.g. 1949",
    preview: (label: string) => `Will show as “${label}”.`,
    invalidDate: "Choose a date.",
    invalidPeriod: "A period needs a start and an end, with the end after the start.",
    invalidYear: "Enter a year, e.g. 1949.",
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
    // Compact toolstrip icon glyphs (item 5) + their accessible labels.
    coverIcon: "☆",
    moveUpIcon: "↑",
    moveDownIcon: "↓",
    removeIcon: "✕",
    // Add-photo entry points (item 3): two buttons replace the always-on inline album grid.
    addFromAlbumButton: "Add from album",
    addFromGoogleButton: "Add from Google",
    // "Add from album" modal (existing-photo picker + device upload).
    pickModalTitle: "Add photos",
    pickModalClose: "Done",
    uploadFromDevice: "Upload from device",
    choosePlacementAlbums: "Add these photos to",
    uploading: "Uploading…",
    importing: "Importing…",
    // Google connect/import (reuses album copy verbs).
    googleConnect: "Connect Google Photos",
    googlePopupBlocked: "Please allow pop-ups to pick from Google Photos, then try again.",
    googlePickerTimedOut: "The Google Photos picker timed out. Please try again.",
    addFailed: "Couldn't add those photos. Please try again.",
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
    subtitle: "Notifications sync to your account. Display preferences stay on this device.",
    notificationsHeading: "Notifications",
    notificationsIntro:
      "Choose how often you hear from Tell Me Again. These choices sync across your devices.",
    notificationsSaving: "Saving…",
    notificationsSaved: "Saved",
    notificationsSaveError: "Could not save — try again.",
    streamLabels: {
      questions_for_me: "Questions for me",
      answers_to_my_asks: "Answers to my asks",
      family_activity: "Family activity",
    },
    frequencyEveryItem: "Every item",
    frequencyOff: "Off",
    streamFrequencyAria: (streamLabel: string) => `${streamLabel} frequency`,
    textSizeHeading: "Text size",
    textSizeIntro: "Makes everything on the screen a little larger or smaller.",
    paletteHeading: "Color palette",
    paletteIntro: "Choose the mood of Tell Me Again on this device.",
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
    skinHeading: "Look and feel",
    skinIntro: "Choose how the app looks and feels on this device.",
    skinAria: "Look and feel",
    skinShort: {
      scrapbook: "Scrapbook",
      heirloom: "Heirloom",
    },
    skinLabels: {
      scrapbook: "Scrapbook look — warm and rounded, coral accents",
      heirloom: "Heirloom look — classic serif, quieter chrome",
    },
    motionHeading: "Reduce motion",
    motionIntro: "Turn off gentle animations and movement across the app.",
    motionAria: "Reduce motion",
    motionOnLabel: "On",
    motionOffLabel: "Off",
    recordingGestureHeading: "Recording gesture",
    recordingGestureIntro:
      "Choose how the microphone button starts and stops recording — separately for phone and desktop on this device.",
    recordingGesturePhoneHeading: "Phone",
    recordingGestureDesktopHeading: "Desktop",
    recordingGesturePhoneAria: "Phone recording gesture",
    recordingGestureDesktopAria: "Desktop recording gesture",
    recordingGestureTapLabel: "Tap",
    recordingGestureHoldLabel: "Hold",
  },
  // Issue #32 — the kin surface (/hub/kin): view your relatives + add one.
  // #283 — Family → List is a browse-only people index (Member vs tree-only), not a kin-only roster.
  kin: {
    signedOut: "Sign in to see your family tree.",
    heading: "Your relatives",
    intro:
      "The people you record as kin in this family. Adding a relative is enough — no one has to confirm it.",
    // Empty state when the family people index has no one yet. Placement / add lives on Tree.
    empty: "No one is in this family's people list yet. Switch to Tree to place or add someone.",
    // List-view search (Family tab → List). Filters by name, relation, or membership badge.
    searchPlaceholder: "Search people…",
    searchAria: "Search people by name, relation, or membership",
    searchNoResults: (q: string) => `No people match “${q}”.`,
    // #283 — membership-first badge (not Origin / Account / mention jargon).
    membershipBadge: {
      member: "Member",
      treeOnly: "Tree-only",
    },
    // Shown when the viewer belongs to no family at all.
    noFamily: "Join or start a family before adding relatives.",
    deceased: "In memory",
    // Human display label per KinRelation (derived by core's deriveKin).
    relationLabel: {
      parent: "Parent",
      child: "Child",
      partner: "Partner",
      sibling: "Sibling",
      half_sibling: "Half-sibling",
      step_sibling: "Step-sibling",
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
    // Add-child co-parent checkboxes (#285 / ADR-0027): attach the child to zero or more additional
    // parents (the anchor's partners). Unchecked = this-parent-only (half-sibling by derivation).
    otherParentLabel: "Also a child of (optional)",
    otherParentNone: "This parent only",
    otherParentHint: "Leave unchecked to place with this parent only (half-siblings).",
    // Ordinary parent/child nature (#285); default biological.
    natureFieldLabelAdd: "Relationship nature",
    natureHintBiological: "Usually biological; change for adoptive, step, or foster.",
    // Partner→kids offer (#285 / ADR-0027): never silent.
    stepParentOfferHeading: "Also a step parent of?",
    stepParentOfferIntro:
      "This person already has children. Add the new partner as a step parent of the ones you check, or skip to add the partnership only.",
    stepParentOfferSkip: "Partner only — skip step parenting",
    stepParentOfferConfirm: "Continue",
    submit: "Add relative",
    submitting: "Adding…",
    // #251 — typed name matches an unplaced member; offer connect-existing before minting a duplicate.
    existingMatchAria: "Existing family member with this name",
    existingMatchPrompt: (name: string) =>
      `${name} is already in this family but not yet connected to the tree. Connect them instead of creating a duplicate?`,
    existingMatchPickLabel: "Which person?",
    existingMatchUse: "Connect existing",
    existingMatchConnecting: "Connecting…",
    existingMatchCreateNew: "Add as someone new",
    existingMatchFailed: "Couldn't connect them. Please try again.",
    // Issues #33/#34/#256 — the governance list (steward affirm/deny/correct + subject hide/unhide +
    // asserter retract).
    govHeading: "Relationships in this family",
    govIntro:
      "Every relationship anyone records shows up here as soon as it's added. If you added one by mistake, you can remove it yourself; as steward you can endorse, remove, or correct any of them; if a relationship is about you, you can hide it.",
    govEmpty: "No relationships recorded in this family yet.",
    // The two ungendered primitives, rendered for a row.
    edgeParentOf: (parent: string, child: string) => `${parent} is a parent of ${child}`,
    // #255 — parent_of with a known nature (skip for unknown so the base sentence stays clean).
    edgeParentOfNature: (parent: string, nature: string, child: string) => {
      const article = /^[aeiou]/i.test(nature) ? "an" : "a";
      return `${parent} is ${article} ${nature} parent of ${child}`;
    },
    edgePartneredWith: (a: string, b: string) => `${a} and ${b} are partners`,
    edgeUnknownPerson: "someone unnamed",
    natureLabel: {
      biological: "biological",
      adoptive: "adoptive",
      step: "step",
      foster: "foster",
      unknown: "",
    },
    // #255 — steward nature picker on parent_of edges (partnered_with has no nature).
    natureFieldLabel: "Nature",
    natureOptions: {
      biological: "Biological",
      adoptive: "Adoptive",
      step: "Step",
      foster: "Foster",
      unknown: "Unknown",
    },
    stateAffirmed: "Endorsed by steward",
    // Steward controls.
    affirm: "Endorse",
    affirming: "Endorsing…",
    deny: "Remove",
    denying: "Removing…",
    // #255 — correct parent_of nature (append-only supersede; does not remove the edge).
    correct: "Update nature",
    correcting: "Updating…",
    // Subject controls.
    hide: "Hide this from the tree",
    hiding: "Hiding…",
    // Generic failure for a governance/hide action.
    govActionFailed: "Couldn't do that. Please try again.",
  },
  // Tree Slice B — the per-person contributions page (/hub/person/[personId]) with three tabs:
  // Stories contributed · Photos contributed · Mentions. Deep-linked via ?section=.
  personPage: {
    back: "← Back",
    // Heading uses the person's name; falls back to a neutral label for a nameless person.
    headingFor: (name: string) => name,
    headingFallback: "This person",
    sectionsAria: "Contributions",
    // Tab labels (reuse the details-sheet link wording so the whole product speaks one language).
    tabStories: "Stories contributed",
    tabPhotos: "Photos contributed",
    tabMentions: "Mentions",
    // Per-tab empty states.
    storiesEmpty: "No stories contributed yet.",
    photosEmpty: "No photos contributed yet.",
    mentionsEmpty: "Not mentioned in any stories yet.",
    // Alt text for a contributed photo thumbnail.
    photoAlt: (caption: string | null) => caption ?? "Contributed photo",
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
    // Family-tab view selector (Tree | List) — the tree is a hub tab now, not a standalone route.
    viewSelectorAria: "Choose family view",
    viewTree: "Tree",
    viewList: "List",
    // Canvas controls. (#159 removed the "Drag to pan" hint — drag still works, the label was noise.)
    fit: "Fit",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    // Add-a-relative modal (opened from the tree's + and kebab).
    addRelativeHeading: "Add a relative",
    addRelativeClose: "Close",
    // Read-only person details sheet (double-click a card, Slice A). Relation-to-focus chip + "You".
    youLabel: "You",
    detailsClose: "Close",
    // Navigation links in the details sheet + the kebab items (Slice B): all three are live
    // destinations on the per-person page (/hub/person/[id]?section=stories|photos|mentions).
    detailsStories: "Stories contributed",
    detailsPhotos: "Photos contributed",
    detailsMentions: "Mentions",
    // Details-sheet EDIT mode (tree Slice C, ADR-0021). Shown only when the server projects `editable`.
    editButton: "Edit",
    editHeading: "Edit details",
    editName: "Name",
    editNamePlaceholder: "Full name",
    editBirthYear: "Birth year",
    editSex: "Sex",
    editSexUnknown: "Unknown",
    editSexFemale: "Female",
    editSexMale: "Male",
    editLifeStatus: "Life status",
    editLifeStatusLiving: "Living",
    editLifeStatusDeceased: "Deceased",
    editDeathYear: "Year of death",
    editSave: "Save",
    editCancel: "Cancel",
    editSaving: "Saving…",
    // Errors surfaced inline in the edit form.
    editErrorGeneric: "Could not save changes. Please try again.",
    editErrorNotAllowed: "You do not have permission to edit this person.",
    editErrorName: "Please enter a name.",
    editErrorBirthDate: "That birth date is not valid.",
    editErrorDeathDate: "That year of death is not valid.",
    // Per-card KebabMenu labels.
    // The ⋮ menu's Focus action — re-roots the tree on this card (relation chips + ring recompute).
    kebabFocus: "Focus here",
    // Neutral label for the ⋮ trigger itself (the menu holds several add actions, so it must not be
    // labeled as any single one).
    moreActions: "Add a relative",
    kebabAddChild: "Add child",
    kebabAddSibling: "Add sibling",
    kebabAddParent: "Add parent",
    kebabAddPartner: "Add partner",
    // Slice D (#6) — invite affordance (details sheet + kebab). Shown only for an `invitable` person
    // (identified, living, no account, no live invitation); `pending` shows the muted note; accepted /
    // not-applicable show nothing.
    inviteButton: "Invite to join",
    kebabInvite: "Invite…",
    invitePendingNote: "Invitation pending",
    // Per-direction caret aria labels (collapse/expand an already-drawn branch; add via "+").
    collapseParents: "Collapse ancestors",
    expandParents: "Expand ancestors",
    collapseChildren: "Collapse descendants",
    expandChildren: "Expand descendants",
    // Sibling caret aria labels (ego-centric redesign, spec §3/§4).
    collapseSiblings: "Collapse siblings",
    expandSiblings: "Show siblings",
    // #289 — line-click governance on stored parent_of / partnered_with strokes.
    lineGovernMenu: "Relationship actions",
    lineGovernHeading: "This relationship",
    lineGovernHit: "Open relationship actions",
    // Card drop zones for desktop tray → tree DnD (#287 / ADR-0027). Side = partner only.
    zoneParent: "Parent",
    zoneChild: "Child",
    zonePartner: "Partner",
    // #288 — mobile Place → tap person → tap zone (ADR-0027). Same zone map as #287 (relationFromZone).
    placeZonesAria: "Choose how they're related",
    placeZoneParent: "Place as parent",
    placeZoneChild: "Place as child",
    placeZonePartner: "Place as partner",
    placeTapHintLink: (name: string) =>
      `Tap someone on the tree, then a zone, to place ${name}.`,
    placeTapHintMint: "Tap someone on the tree, then a zone, to place the new person.",
    placeTapCancel: "Cancel placing",
  },
  // Tree place-confirm modal (#286 / ADR-0027) — shared by tray New person + unplaced Place.
  // Desktop DnD (#287) and mobile Place→tap (#288) reopen this same surface.
  placeConfirm: {
    newPersonLabel: "New person",
    mintHeading: "Place a new person",
    mintIntro:
      "Name them (optional), choose who they're related to, and confirm. Partner and child placement ask before writing step or co-parent edges.",
    mintSubmit: "Add to tree",
    subjectFieldLabel: "Placing",
  },
  // Unplaced members (#161, ADR-0023) — active members who touch NO visible kinship edge, so they're
  // invisible in the graph-only tree. Surfaced on the Tree tray (#283: List is browse-only) with Place,
  // leave as non-family, and steward remove. The tray also hosts New person (#286).
  unplaced: {
    // Section / tray heading + the short explanation of why these people show up here.
    heading: "Not yet connected",
    intro:
      "These family members haven't been placed in the tree yet. Connect them to a relative, or set them aside.",
    // Tray chrome when only New person is shown (no unplaced rows).
    trayHeading: "Tree tray",
    trayIntro: "Place someone who isn't on the tree yet, or add a new person.",
    newPerson: "New person",
    newPersonAria: "Add a new person to the tree",
    // Desktop tray drag handles (#287) — Place/New still work via click; drag is the zone shortcut.
    dragMemberAria: (name: string) => `Drag ${name} onto a person on the tree`,
    dragNewPersonAria: "Drag a new person onto a person on the tree",
    // Accessible group name wrapping the per-member action buttons.
    memberActionsAria: (name: string) => `Actions for ${name}`,
    // Fallback name for a member with no display name recorded.
    unnamedMember: "Unnamed member",
    // The three per-member actions.
    place: "Place in tree",
    leaveNonFamily: "Not family",
    remove: "Remove",
    // In-page confirm for the destructive steward-only remove (never a native confirm() dialog).
    removeConfirm: (name: string) => `Remove ${name} from this family?`,
    removeConfirmYes: "Remove",
    removeConfirmNo: "Cancel",
    // Undo affordance for a member set aside as non-family (shown in the non-family list).
    nonFamilyHeading: "Set aside as not family",
    restore: "Move back",
    // Busy labels while an action's server call is in flight.
    placing: "Placing…",
    removing: "Removing…",
    working: "Working…",
    // Generic non-committal failure (leaks nothing about why a link/remove was refused).
    actionFailed: "Couldn't do that. Please try again.",
    // The place-in-tree modal (link an existing member to an anchor + relation).
    placeHeading: (name: string) => `Place ${name} in the tree`,
    placeClose: "Close",
    placeIntro:
      "Choose who they're related to and how. This connects the person you already have — it never creates a duplicate.",
    anchorFieldLabel: "Related to",
    relationFieldLabel: "How are they related?",
    // The relation options are phrased from the MEMBER's perspective (member is the {relation} of anchor).
    relationOptions: {
      parent: "Parent",
      child: "Child",
      partner: "Partner",
      sibling: "Sibling",
      grandparent: "Grandparent",
    },
    placeSubmit: "Place in tree",
    // Loading state while the modal fetches the family-wide placed-person list (#169).
    loadingAnchors: "Loading relatives…",
    // No anchors available to link to (the tree is empty besides this member) — a rare edge case.
    noAnchors: "There's no one to connect them to yet. Add someone to the tree first.",
  },
} as const;

