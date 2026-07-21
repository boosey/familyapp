import React from 'react';
import { KindredPromptCard } from '../../components/core/KindredPromptCard.jsx';
import { KindredVoiceButton } from '../../components/core/KindredVoiceButton.jsx';

/** The core loop: a family question, the elder speaks, speech becomes serif body text. */
export function Conversation({ recording = false }) {
  return (
    <div style={{ background: 'var(--kin-paper)', borderRadius: 24, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--kin-font-sans)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px', borderBottom: '1px solid var(--kin-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--kin-sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700 }}>S</span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--kin-ink)' }}>Salvatore Greco</div>
            <div style={{ fontSize: 14, color: 'var(--kin-muted)' }}>Conversation · Today, 2:14pm</div>
          </div>
        </div>
        <div style={{ height: 48, display: 'flex', alignItems: 'center', padding: '0 18px', border: '1.5px solid var(--kin-field)', borderRadius: 999, fontSize: 15, fontWeight: 600, color: 'var(--kin-ink-2)' }}>Pause</div>
      </header>

      <div style={{ flex: 1, padding: 28, display: 'flex', flexDirection: 'column', gap: 22, overflow: 'hidden' }}>
        <KindredPromptCard eyebrow="Mara asked" question="What was your mother like when you were small?" />
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', background: 'var(--kin-sage)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700 }}>S</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--kin-ink-2)' }}>Salvatore</span>
              <span style={{ fontFamily: 'var(--kin-font-mono)', fontSize: 13, color: 'var(--kin-accent)' }}>● 0:42</span>
            </div>
            <p style={{ fontFamily: 'var(--kin-font-serif)', fontSize: 22, lineHeight: 1.6, color: 'var(--kin-body)', margin: 0 }}>
              My mother was always up before any of us. You&rsquo;d come downstairs and the bread was already in the oven &mdash; and she&rsquo;d be singing. Always singing, even when there wasn&rsquo;t much to go around.
            </p>
          </div>
        </div>
      </div>

      <footer style={{ padding: '22px 28px 28px', borderTop: '1px solid var(--kin-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <DockButton glyph="&#128247;" label="Add photo" />
        <KindredVoiceButton state={recording ? 'recording' : 'idle'} />
        <DockButton glyph="&#9000;" label="Type instead" />
      </footer>
    </div>
  );
}

function DockButton({ glyph, label }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 120 }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, border: '1.5px solid var(--kin-field)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }} dangerouslySetInnerHTML={{ __html: glyph }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--kin-ink-2)' }}>{label}</span>
    </div>
  );
}
