An audio playback row for a recorded story — a draggable scrubber line over a transport row: start over, back 10s, play/pause, forward 10s, next story.

```jsx
// Self-managing — tracks its own position + playback:
<KindredListenBar title="The summer we moved to Naples" duration="3:24" />

// Controlled by a parent:
const [playing, setPlaying] = React.useState(false);
<KindredListenBar
  title="The summer we moved to Naples"
  duration="3:24"
  playing={playing}
  onToggle={() => setPlaying((p) => !p)}
  showNext={false}
/>
```

- Drag the thumb or click the scrubber track to seek; current time and total length are shown in mono either side.
- Transport: ⏮ start over · ↺10 back ten seconds · ▶/❚❚ play-pause · ↻10 forward ten seconds · ⏭ next story.
- Uses Unicode glyphs — no custom icon assets.
- `showNext={false}` hides the next-story button (e.g. single-story approval contexts). `onNext` handles advancing.
- Omit `playing` to let the bar run itself; pass it to control playback from a parent.
