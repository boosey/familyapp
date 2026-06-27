import React from 'react';

/** A single memory in a list — striped photo placeholder, era, title and byline. */
export function KindredStoryCard({ era = '1962 · THE COAST', title = 'The summer we drove to the coast', byline = 'Told by Salvatore', meta = ['4 min listen', '2 photos'], onClick, style, ...rest }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', gap: 20, alignItems: 'center', background: 'var(--kin-paper)', border: '1px solid var(--kin-line)', borderRadius: 'var(--kin-radius-md)', padding: 18, fontFamily: 'var(--kin-font-sans)', cursor: onClick ? 'pointer' : 'default', ...style }}
      {...rest}
    >
      <div style={{ width: 120, height: 120, flexShrink: 0, borderRadius: 'var(--kin-radius-sm)', backgroundColor: 'var(--kin-ph-b)', backgroundImage: 'repeating-linear-gradient(45deg, var(--kin-ph-a) 0 10px, var(--kin-ph-b) 10px 20px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 8 }}>
        <span style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 10, color: 'var(--kin-ph-text)' }}>photo</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 12, color: 'var(--kin-accent)', letterSpacing: '.04em' }}>{era}</div>
        <div style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 'var(--kin-text-h2)', lineHeight: 1.2, margin: '8px 0', color: 'var(--kin-ink)' }}>{title}</div>
        <div style={{ fontSize: 'var(--kin-text-sm)', color: 'var(--kin-ink-2)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span>{byline}</span>
          {meta.map((m, i) => (
            <React.Fragment key={i}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--kin-field)' }} />
              <span>{m}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <span style={{ width: 48, height: 48, borderRadius: '50%', border: '1.5px solid var(--kin-field)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--kin-accent)', fontSize: 22, flexShrink: 0 }}>{'\u203A'}</span>
    </div>
  );
}
