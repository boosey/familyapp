import React from 'react';

/**
 * KindredListenBar — an audio playback row for a recorded story.
 *
 * A draggable scrubber line with a position thumb between mono timecodes,
 * over a transport row: start over · back 10s · play/pause · forward 10s ·
 * next story. Warm, calm, elders-first touch targets. No waveform.
 *
 * Self-managing by default (tracks its own position + playback). Pass
 * `playing` to drive it from a parent — then it becomes controlled and
 * calls `onToggle` instead of flipping its own play state.
 */

function parseDuration(str) {
  const parts = String(str ?? '3:24').split(':').map((n) => parseInt(n, 10) || 0);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] || 0;
}

function formatTime(sec, total) {
  sec = Math.max(0, Math.min(total, Math.round(sec)));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function KindredListenBar({
  playing,
  duration = '3:24',
  title,
  onToggle,
  showNext = true,
  onNext,
  style,
  ...rest
}) {
  const total = parseDuration(duration);
  const [sec, setSec] = React.useState(0);
  const [internalPlaying, setInternalPlaying] = React.useState(false);
  const intRef = React.useRef(null);
  const trackRef = React.useRef(null);

  const isControlled = playing !== undefined;
  const isPlaying = isControlled ? playing : internalPlaying;

  const clamp = (n) => Math.max(0, Math.min(total, n));
  const stop = () => {
    if (intRef.current) {
      clearInterval(intRef.current);
      intRef.current = null;
    }
  };

  React.useEffect(() => {
    if (isPlaying) {
      if (!intRef.current) {
        intRef.current = setInterval(() => {
          setSec((prev) => {
            const next = prev + 0.5;
            if (next >= total) {
              stop();
              if (!isControlled) setInternalPlaying(false);
              return total;
            }
            return next;
          });
        }, 500);
      }
    } else {
      stop();
    }
    return stop;
  }, [isPlaying, total, isControlled]);

  const toggle = () => {
    if (isControlled) {
      onToggle?.();
      return;
    }
    setInternalPlaying((p) => {
      const np = !p;
      if (np && sec >= total) setSec(0);
      return np;
    });
    onToggle?.();
  };
  const restart = () => setSec(0);
  const back10 = () => setSec((s) => clamp(s - 10));
  const fwd10 = () => setSec((s) => clamp(s + 10));
  const next = () => {
    stop();
    setSec(0);
    if (!isControlled) setInternalPlaying(false);
    onNext?.();
  };

  const seekFrom = (clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setSec(ratio * total);
  };
  const scrubDown = (e) => {
    e.preventDefault();
    seekFrom(e.clientX);
    const move = (ev) => seekFrom(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pct = `${(total ? sec / total : 0) * 100}%`;

  const timecode = {
    flex: '0 0 auto',
    minWidth: 38,
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-label)',
    letterSpacing: 'var(--tracking-mono)',
    color: 'var(--text-meta)',
  };
  const seekBtn = {
    position: 'relative',
    width: 46,
    height: 46,
    borderRadius: 'var(--radius-pill)',
    border: '1.5px solid var(--border-strong)',
    background: 'var(--surface-card)',
    color: 'var(--accent-strong)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const SeekGlyph = ({ glyph }) => (
    <>
      <span aria-hidden="true" style={{ fontSize: '1.7rem', lineHeight: 1 }}>{glyph}</span>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-40%)',
        }}
      >10</span>
    </>
  );

  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-4) var(--space-5)',
        ...style,
      }}
      {...rest}
    >
      {title ? (
        <p
          style={{
            margin: '0 0 var(--space-3)',
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-ui-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-body)',
          }}
        >{title}</p>
      ) : null}

      {/* scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span style={timecode}>{formatTime(sec, total)}</span>
        <div
          ref={trackRef}
          onPointerDown={scrubDown}
          style={{
            position: 'relative',
            flex: '1 1 auto',
            height: 22,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            touchAction: 'none',
          }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--border-strong)' }} />
          <div style={{ position: 'absolute', left: 0, width: pct, height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--accent)' }} />
          <div style={{ position: 'absolute', left: pct, transform: 'translateX(-50%)', width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', boxShadow: 'var(--shadow-sm)', border: '2px solid var(--surface-card)' }} />
        </div>
        <span style={{ ...timecode, textAlign: 'right' }}>{duration}</span>
      </div>

      {/* transport */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
        <button type="button" onClick={restart} title="Start over" aria-label="Start over" style={{ ...seekBtn, fontSize: '1.15rem' }}>
          <span aria-hidden="true">⏮</span>
        </button>
        <button type="button" onClick={back10} title="Back 10 seconds" aria-label="Back 10 seconds" style={seekBtn}>
          <SeekGlyph glyph="↺" />
        </button>
        <button
          type="button"
          onClick={toggle}
          title="Play or pause"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          style={{
            width: 62,
            height: 62,
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-on)',
            cursor: 'pointer',
            fontSize: '1.4rem',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span aria-hidden="true" style={{ marginLeft: isPlaying ? 0 : 2 }}>{isPlaying ? '❚❚' : '▶'}</span>
        </button>
        <button type="button" onClick={fwd10} title="Forward 10 seconds" aria-label="Forward 10 seconds" style={seekBtn}>
          <SeekGlyph glyph="↻" />
        </button>
        {showNext ? (
          <button type="button" onClick={next} title="Next story" aria-label="Next story" style={{ ...seekBtn, fontSize: '1.15rem' }}>
            <span aria-hidden="true">⏭</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
