import React from 'react';

/** The single loud control in Kindred — a 96px mic that pulses while idle,
 *  and becomes a calm stop square while recording. */
export function KindredVoiceButton({ state = 'idle', label, onClick, style, ...rest }) {
  const recording = state === 'recording';

  const ring = recording
    ? { background: 'var(--kin-tint)', border: '2px solid var(--kin-accent)' }
    : { background: 'var(--kin-accent)', animation: 'kin-pulse 2.6s ease-in-out infinite' };

  const glyph = recording
    ? { width: 26, height: 26, borderRadius: 6, background: 'var(--kin-accent)' }
    : { width: 30, height: 46, borderRadius: 16, background: 'var(--kin-on-accent)' };

  const text = label || (recording ? 'Recording…' : 'Tap to speak');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, fontFamily: 'var(--kin-font-sans)', ...style }} {...rest}>
      <button
        type="button"
        onClick={onClick}
        aria-label={text}
        style={{
          width: 'var(--kin-touch-primary)', height: 'var(--kin-touch-primary)', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          ...ring,
        }}
      >
        <span style={glyph} />
      </button>
      <span style={{ fontSize: 'var(--kin-text-sm)', fontWeight: 700, color: recording ? 'var(--kin-accent)' : 'var(--kin-ink-2)' }}>{text}</span>
    </div>
  );
}
