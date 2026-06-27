import React from 'react';

const DEFAULT_BARS = [6,12,20,28,18,10,24,32,22,14,8,18,26,16,10,20,30,14,22,12];

/** A warm audio player — the original voice is always one tap away. */
export function KindredListenBar({ duration = '3:48', bars = DEFAULT_BARS, onPlay, style, ...rest }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, background: 'var(--kin-paper)', border: '1px solid var(--kin-line)', borderRadius: 'var(--kin-radius-md)', padding: '16px 20px', ...style }} {...rest}>
      <button type="button" onClick={onPlay} aria-label="Play" style={{ width: 52, height: 52, flexShrink: 0, borderRadius: '50%', background: 'var(--kin-accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 0, height: 0, borderLeft: '16px solid var(--kin-on-accent)', borderTop: '11px solid transparent', borderBottom: '11px solid transparent', marginLeft: 4 }} />
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 3, height: 36 }}>
        {bars.map((h, i) => (
          <span key={i} style={{ flex: 1, height: h, borderRadius: 2, background: 'var(--kin-gold)' }} />
        ))}
      </div>
      <span style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 14, color: 'var(--kin-ink-2)', flexShrink: 0 }}>{duration}</span>
    </div>
  );
}
