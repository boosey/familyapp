import React from 'react';

const NODES = [
  { year: '1938', title: 'Born in Naples', sub: 'The second of five · Via dei Tribunali', dot: 'sage' },
  { year: '1956', title: 'Sailed to New York', sub: 'Eleven days aboard the SS Cristoforo Colombo', dot: 'sage' },
  { year: '1962', title: 'The summer we drove to the coast', sub: '▶ 3:48 · 2 photos', dot: 'accent', story: true },
  { year: '1968', title: 'Married Maria', sub: "St. Anthony's, Brooklyn · a borrowed suit", dot: 'sage' },
  { year: '1974', title: 'Opened the bakery on Court Street', sub: 'Up at four every morning for thirty years', dot: 'sage' },
];

/** Every conversation deposits a memory onto one spine — a life you can scroll. */
export function Timeline() {
  return (
    <div style={{ background: 'var(--kin-paper)', borderRadius: 24, overflow: 'hidden', height: '100%', fontFamily: 'var(--kin-font-sans)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '30px 36px 22px', borderBottom: '1px solid var(--kin-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 38, letterSpacing: '-.01em', color: 'var(--kin-ink)' }}>A life in years</div>
          <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 18px', border: '1.5px solid var(--kin-field)', borderRadius: 999, fontSize: 15, fontWeight: 600, color: 'var(--kin-ink-2)' }}>Salvatore ▾</div>
        </div>
        <div style={{ fontSize: 16, color: 'var(--kin-muted)', marginTop: 8 }}>1938 – present · 47 memories gathered</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', padding: '30px 36px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 96, top: 30, bottom: 36, width: 2, background: 'var(--kin-line-2)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {NODES.map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              <div style={{ width: 52, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--kin-font-mono)', fontSize: 16, fontWeight: 600, color: n.story ? 'var(--kin-accent)' : 'var(--kin-ink-2)', paddingTop: 18 }}>{n.year}</div>
              <div style={{ width: 16, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 22 }}>
                <span style={{ width: n.story ? 18 : 14, height: n.story ? 18 : 14, borderRadius: '50%', background: n.dot === 'accent' ? 'var(--kin-accent)' : 'var(--kin-sage)', border: '3px solid var(--kin-paper)', boxShadow: '0 0 0 1px var(--kin-line-2)' }} />
              </div>
              <div style={{ flex: 1, background: n.story ? 'var(--kin-tint)' : 'var(--kin-surface)', border: '1px solid ' + (n.story ? 'var(--kin-tint-border)' : 'var(--kin-line)'), borderRadius: 16, padding: '18px 20px' }}>
                <div style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 24, lineHeight: 1.15, color: 'var(--kin-ink)' }}>{n.title}</div>
                <div style={{ fontSize: 15, color: n.story ? 'var(--kin-accent)' : 'var(--kin-muted)', fontWeight: n.story ? 600 : 400, marginTop: 4 }}>{n.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
