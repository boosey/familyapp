import React from 'react';

/** A tappable provenance tag — a person (with avatar), a place, or a year. */
export function KindredChip({ kind = 'person', label, initial, avatar = 'sage', style, ...rest }) {
  const text = label || (kind === 'time' ? '1962' : kind === 'place' ? 'Amalfi' : 'Maria');

  if (kind === 'person') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, background: 'var(--kin-chip-bg)', border: '1px solid var(--kin-chip-border)', borderRadius: 'var(--kin-radius-pill)', padding: '9px 16px 9px 9px', fontFamily: 'var(--kin-font-sans)', fontSize: 'var(--kin-text-sm)', fontWeight: 500, color: 'var(--kin-ink)', ...style }} {...rest}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: avatar === 'accent' ? 'var(--kin-accent)' : 'var(--kin-sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
          {(initial || text.charAt(0)).toUpperCase()}
        </span>
        {text}
      </span>
    );
  }
  const isTime = kind === 'time';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1.5px solid var(--kin-field)', borderRadius: 'var(--kin-radius-pill)', padding: '9px 16px', fontSize: 'var(--kin-text-sm)', fontWeight: isTime ? 600 : 500, color: 'var(--kin-ink-2)', fontFamily: isTime ? 'var(--kin-font-mono)' : 'var(--kin-font-sans)', ...style }} {...rest}>
      {isTime ? text : '\uD83D\uDCCD ' + text}
    </span>
  );
}
