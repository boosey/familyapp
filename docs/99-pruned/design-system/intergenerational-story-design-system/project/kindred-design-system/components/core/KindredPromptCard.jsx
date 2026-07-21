import React from 'react';

/** A family member's question, set in serif — the seed of every conversation. */
export function KindredPromptCard({ eyebrow = 'A question for Sal', question = 'What was your mother like when you were small?', style, ...rest }) {
  return (
    <div
      style={{
        background: 'var(--kin-tint)', border: '1px solid var(--kin-tint-border)',
        borderRadius: 'var(--kin-radius-md)', padding: '24px 26px',
        fontFamily: 'var(--kin-font-sans)', ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: 'var(--kin-tracking-label)', textTransform: 'uppercase', color: 'var(--kin-accent)', marginBottom: 14 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--kin-accent)' }} />
        {eyebrow}
      </div>
      <div style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 'var(--kin-text-headline)', lineHeight: 1.25, color: 'var(--kin-ink)' }}>
        {question}
      </div>
    </div>
  );
}
