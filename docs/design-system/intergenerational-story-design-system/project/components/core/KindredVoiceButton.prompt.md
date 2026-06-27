The primary voice action — the one loud control on a screen. Use once per view, as the main way an elder responds.

\`\`\`jsx
<KindredVoiceButton state="idle" onClick={startRecording} />
<KindredVoiceButton state="recording" onClick={stopRecording} />
\`\`\`

`idle` pulses to invite speech; `recording` swaps to a calm stop square. Override the caption with `label`.
