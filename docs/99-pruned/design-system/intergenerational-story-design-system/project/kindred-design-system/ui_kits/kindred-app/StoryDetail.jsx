import React from 'react';
import { KindredListenBar } from '../../components/core/KindredListenBar.jsx';
import { KindredChip } from '../../components/core/KindredChip.jsx';

/** The finished memoir page — photographs lead, original audio one tap away. */
export function StoryDetail() {
  return (
    <div style={{ background: 'var(--kin-paper)', borderRadius: 24, overflow: 'hidden', height: '100%', fontFamily: 'var(--kin-font-sans)', padding: '0 44px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 600, color: 'var(--kin-ink-2)' }}><span style={{ fontSize: 22 }}>&lsaquo;</span> Stories</div>
        <div style={{ display: 'flex', gap: 18, fontSize: 22, color: 'var(--kin-ink-2)' }}><span>&#128278;</span><span>&#10548;</span></div>
      </div>
      <div style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 13, color: 'var(--kin-accent)', letterSpacing: '.06em' }}>1962 · THE COAST</div>
      <div style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 46, lineHeight: 1.08, letterSpacing: '-.01em', margin: '14px 0 18px', color: 'var(--kin-ink)' }}>The summer we drove to the coast</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--kin-ink-2)', fontSize: 15 }}>
        <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--kin-sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>S</span>
        Told by Salvatore Greco · Recorded May 3, 2026
      </div>
      <div style={{ margin: '22px 0' }}><KindredListenBar duration="3:48" /></div>
      <div style={{ height: 240, borderRadius: 16, backgroundColor: 'var(--kin-ph-b)', backgroundImage: 'repeating-linear-gradient(45deg, var(--kin-ph-a) 0 12px, var(--kin-ph-b) 12px 24px)', display: 'flex', alignItems: 'flex-end', padding: 14 }}>
        <span style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 11, color: 'var(--kin-ph-text)', background: 'rgba(245,240,230,.6)', padding: '4px 8px', borderRadius: 6 }}>family photo · the coast road, 1962</span>
      </div>
      <p style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 23, lineHeight: 1.62, color: 'var(--kin-body)', margin: '26px 0 0' }}>
        <span style={{ float: 'left', fontFamily: 'var(--kin-font-serif)', fontSize: 78, lineHeight: .74, fontWeight: 500, color: 'var(--kin-accent)', padding: '8px 14px 0 0' }}>W</span>
        e left before the sun was up, the four of us packed into the old Fiat with sandwiches your grandmother had wrapped in wax paper. She sang the whole way down the mountain, and Tony pretended to be asleep so he wouldn&rsquo;t have to.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 28 }}>
        <KindredChip kind="person" label="Maria" avatar="sage" />
        <KindredChip kind="person" label="Tony" avatar="accent" />
        <KindredChip kind="place" label="Amalfi" />
        <KindredChip kind="time" label="1962" />
      </div>
    </div>
  );
}
