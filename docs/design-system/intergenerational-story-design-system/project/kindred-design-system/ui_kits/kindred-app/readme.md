# Kindred App — UI kit

Tablet-first recreations of the three surfaces that carry the product. All compose the \`components/core\` primitives and read the global tokens from \`styles.css\`, so they re-skin with \`data-theme\`.

- **Conversation.jsx** — the core loop. A family member's question (KindredPromptCard) sits at the top; the elder answers via the 96px KindredVoiceButton; speech becomes serif body text in place.
- **StoryDetail.jsx** — the finished memoir page. KindredListenBar for the original audio, a drop-capped serif body, KindredChip provenance tags.
- **Timeline.jsx** — every memory on one spine; the accent-tinted node is a finished story.

\`index.html\` previews the Conversation screen inside a tablet frame.
