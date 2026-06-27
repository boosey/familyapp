/* @ds-bundle: {"format":3,"namespace":"KindredDesignSystem_495fbf","components":[{"name":"KindredButton","sourcePath":"components/core/KindredButton.jsx"},{"name":"KindredChip","sourcePath":"components/core/KindredChip.jsx"},{"name":"KindredListenBar","sourcePath":"components/core/KindredListenBar.jsx"},{"name":"KindredPromptCard","sourcePath":"components/core/KindredPromptCard.jsx"},{"name":"KindredStoryCard","sourcePath":"components/core/KindredStoryCard.jsx"},{"name":"KindredVoiceButton","sourcePath":"components/core/KindredVoiceButton.jsx"}],"sourceHashes":{"components/core/KindredButton.jsx":"967a6e0872c4","components/core/KindredChip.jsx":"a68c42cc1cd0","components/core/KindredListenBar.jsx":"6cf08af78e90","components/core/KindredPromptCard.jsx":"7e49fd4dd783","components/core/KindredStoryCard.jsx":"6c42c216d429","components/core/KindredVoiceButton.jsx":"6fab71d7e181","ui_kits/kindred-app/Conversation.jsx":"bf0a1df254a4","ui_kits/kindred-app/StoryDetail.jsx":"98f3051920cd","ui_kits/kindred-app/Timeline.jsx":"c8162102e124"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.KindredDesignSystem_495fbf = window.KindredDesignSystem_495fbf || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/KindredButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredButton — the standard text action.
 * Elders-first: large hit area (64px default), high contrast, calm transitions.
 */
function KindredButton({
  children,
  variant = 'primary',
  size = 'default',
  fullWidth = false,
  disabled = false,
  leadingIcon,
  style,
  ...rest
}) {
  const sizes = {
    small: {
      minHeight: 'var(--touch-min)',
      padding: '0 var(--space-5)',
      fontSize: 'var(--text-ui-sm)'
    },
    default: {
      minHeight: 'var(--touch-default)',
      padding: '0 var(--space-6)',
      fontSize: 'var(--text-ui-lg)'
    },
    large: {
      minHeight: '76px',
      padding: '0 var(--space-7)',
      fontSize: '1.625rem'
    }
  };
  const variants = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--accent-on)',
      border: 'var(--border-width) solid transparent'
    },
    secondary: {
      background: 'var(--surface-card)',
      color: 'var(--accent-strong)',
      border: 'var(--border-width) solid var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--accent-strong)',
      border: 'var(--border-width) solid transparent'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-3)',
      width: fullWidth ? '100%' : 'auto',
      fontFamily: 'var(--font-ui)',
      fontWeight: 'var(--weight-semibold)',
      lineHeight: 1,
      borderRadius: 'var(--radius-pill)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--dur-fade) var(--ease-quiet), opacity var(--dur-fade) var(--ease-quiet)',
      boxShadow: variant === 'primary' ? 'var(--shadow-sm)' : 'none',
      ...sizes[size],
      ...variants[variant],
      ...style
    }
  }, rest), leadingIcon ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      fontSize: '1.1em',
      lineHeight: 1
    }
  }, leadingIcon) : null, children);
}
Object.assign(__ds_scope, { KindredButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredButton.jsx", error: String((e && e.message) || e) }); }

// components/core/KindredChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredChip — a small selectable token for categories / people / topics.
 * Pill shaped, paper or sage-soft. Used for filtering the timeline or tagging.
 */
function KindredChip({
  children,
  selected = false,
  leadingIcon,
  onClick,
  style,
  ...rest
}) {
  const interactive = typeof onClick === 'function';
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    "aria-pressed": interactive ? selected : undefined,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      minHeight: 'var(--touch-min)',
      padding: '0 var(--space-4)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      fontWeight: 'var(--weight-medium)',
      lineHeight: 1,
      borderRadius: 'var(--radius-pill)',
      cursor: interactive ? 'pointer' : 'default',
      color: selected ? 'var(--accent-on)' : 'var(--text-meta)',
      background: selected ? 'var(--support)' : 'var(--support-soft)',
      border: 'var(--border-width) solid transparent',
      transition: 'background var(--dur-fade) var(--ease-quiet)',
      ...style
    }
  }, rest), leadingIcon ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, leadingIcon) : null, children);
}
Object.assign(__ds_scope, { KindredChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredChip.jsx", error: String((e && e.message) || e) }); }

// components/core/KindredListenBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredListenBar — an audio playback row for a recorded story.
 * Unicode ▶ / ❚❚ affordance, static waveform, mono timecode. Warm, calm.
 */
function KindredListenBar({
  playing = false,
  duration = '3:24',
  title,
  onToggle,
  style,
  ...rest
}) {
  /* a static, decorative waveform built from CSS bars (no custom SVG) */
  const bars = [0.3, 0.6, 0.45, 0.9, 0.7, 1, 0.5, 0.8, 0.4, 0.65, 0.55, 0.85, 0.35, 0.7, 0.5, 0.95, 0.6, 0.4];
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-card)',
      border: 'var(--border-width) solid var(--border)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--shadow-sm)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onToggle,
    "aria-label": playing ? 'Pause' : 'Play',
    style: {
      flex: '0 0 auto',
      width: 'var(--touch-min)',
      height: 'var(--touch-min)',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      cursor: 'pointer',
      background: 'var(--accent)',
      color: 'var(--accent-on)',
      fontSize: '1.1rem',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      marginLeft: playing ? 0 : 2
    }
  }, playing ? '❚❚' : '▶')), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '1 1 auto',
      minWidth: 0
    }
  }, title ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 var(--space-2)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-body)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      height: 26
    }
  }, bars.map((h, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      flex: 1,
      height: `${h * 100}%`,
      borderRadius: 'var(--radius-pill)',
      background: playing && i < bars.length * 0.45 ? 'var(--accent)' : 'var(--border-strong)'
    }
  })))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: '0 0 auto',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      letterSpacing: 'var(--tracking-mono)',
      color: 'var(--text-meta)'
    }
  }, duration));
}
Object.assign(__ds_scope, { KindredListenBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredListenBar.jsx", error: String((e && e.message) || e) }); }

// components/core/KindredPromptCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredPromptCard — a single conversation prompt offered to the elder.
 * Big serif question, optional category eyebrow, gentle paper card.
 * This is the hero of the conversation screen.
 */
function KindredPromptCard({
  prompt,
  eyebrow,
  forName,
  onAnswer,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: 'var(--surface-card)',
      border: 'var(--border-width) solid var(--border)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-card)',
      padding: 'var(--space-7)',
      maxWidth: 640,
      ...style
    }
  }, rest), eyebrow ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      letterSpacing: 'var(--tracking-mono)',
      textTransform: 'uppercase',
      color: 'var(--support)'
    }
  }, eyebrow) : null, forName ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 'var(--space-3) 0 0',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      color: 'var(--text-muted)'
    }
  }, "A question for ", forName) : null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 'var(--space-4) 0 0',
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-prompt)',
      fontWeight: 'var(--weight-regular)',
      lineHeight: 'var(--leading-snug)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-body)',
      textWrap: 'pretty'
    }
  }, prompt), onAnswer ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-6)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAnswer,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      minHeight: 'var(--touch-min)',
      padding: '0 var(--space-5)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--accent-strong)',
      background: 'var(--accent-soft)',
      border: 'none',
      borderRadius: 'var(--radius-pill)',
      cursor: 'pointer'
    }
  }, "Answer this")) : null);
}
Object.assign(__ds_scope, { KindredPromptCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredPromptCard.jsx", error: String((e && e.message) || e) }); }

// components/core/KindredStoryCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredStoryCard — a saved memory in the timeline.
 * Striped photo placeholder (replaced by <img> in production), serif title,
 * mono year/place metadata, and an optional listen affordance.
 */
function KindredStoryCard({
  title,
  year,
  place,
  excerpt,
  imageSrc,
  duration,
  pinned = false,
  onClick,
  style,
  ...rest
}) {
  /* warm striped placeholder when no photo is supplied */
  const placeholder = {
    backgroundImage: 'repeating-linear-gradient(135deg, var(--support-soft) 0 14px, var(--accent-soft) 14px 28px)'
  };
  return /*#__PURE__*/React.createElement("article", _extends({
    onClick: onClick,
    style: {
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-card)',
      border: 'var(--border-width) solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default',
      maxWidth: 360,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: 168,
      ...(imageSrc ? {} : placeholder)
    }
  }, imageSrc ? /*#__PURE__*/React.createElement("img", {
    src: imageSrc,
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    }
  }) : null, pinned ? /*#__PURE__*/React.createElement("span", {
    "aria-label": "Pinned",
    style: {
      position: 'absolute',
      top: 'var(--space-3)',
      right: 'var(--space-3)',
      width: 34,
      height: 34,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-card)',
      boxShadow: 'var(--shadow-sm)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '1rem'
    }
  }, "\uD83D\uDCCD") : null), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      letterSpacing: 'var(--tracking-mono)',
      color: 'var(--text-meta)'
    }
  }, [year, place].filter(Boolean).join('  ·  ')), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 'var(--space-2) 0 0',
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-story-lg)',
      fontWeight: 'var(--weight-medium)',
      lineHeight: 'var(--leading-snug)',
      color: 'var(--text-body)',
      textWrap: 'pretty'
    }
  }, title), excerpt ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 'var(--space-3) 0 0',
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-story)',
      lineHeight: 'var(--leading-body)',
      color: 'var(--text-muted)',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden'
    }
  }, excerpt) : null, duration ? /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 'var(--space-4) 0 0',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--accent-strong)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, "\u25B6"), " Listen \xB7 ", duration) : null));
}
Object.assign(__ds_scope, { KindredStoryCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredStoryCard.jsx", error: String((e && e.message) || e) }); }

// components/core/KindredVoiceButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KindredVoiceButton — the one loud control per screen.
 * A large circular mic. When `listening`, an ambient pulse breathes around it.
 * 96px voice target. Typing is always offered elsewhere, never forced here.
 */
function KindredVoiceButton({
  listening = false,
  label = 'Tap to speak',
  onClick,
  size = 96,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-3)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-pressed": listening,
    "aria-label": label,
    onClick: onClick,
    style: {
      width: size,
      height: size,
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      cursor: 'pointer',
      background: listening ? 'var(--accent-strong)' : 'var(--accent)',
      color: 'var(--accent-on)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-card)',
      transition: 'background var(--dur-fade) var(--ease-quiet)',
      animation: listening ? 'kindred-listening var(--dur-pulse) var(--ease-quiet) infinite' : 'none'
    }
  }, rest), listening ?
  /*#__PURE__*/
  /* waveform bars while listening */
  React.createElement("span", {
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: size * 0.34
    }
  }, [0.5, 0.85, 0.4, 1, 0.6].map((h, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: Math.max(3, size * 0.045),
      height: `${h * 100}%`,
      background: 'currentColor',
      borderRadius: 'var(--radius-pill)'
    }
  }))) :
  /*#__PURE__*/
  /* simple CSS mic glyph: rounded capsule + stand */
  React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'relative',
      width: size * 0.22,
      height: size * 0.42
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      inset: 0,
      bottom: '32%',
      background: 'currentColor',
      borderRadius: 'var(--radius-pill)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      bottom: 0,
      transform: 'translateX(-50%)',
      width: 2.5,
      height: '24%',
      background: 'currentColor'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      bottom: 0,
      transform: 'translateX(-50%)',
      width: size * 0.16,
      height: 2.5,
      background: 'currentColor',
      borderRadius: 2
    }
  }))), label ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-ui-sm)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-muted)'
    }
  }, listening ? 'Listening…' : label) : null);
}
Object.assign(__ds_scope, { KindredVoiceButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/KindredVoiceButton.jsx", error: String((e && e.message) || e) }); }

// ui_kits/kindred-app/Conversation.jsx
try { (() => {
/* Kindred app — Conversation screen.
   A single prompt + the one loud voice action. Voice over typing. */
function Conversation({
  prompt,
  onSaved,
  onTypeInstead
}) {
  const {
    KindredVoiceButton,
    KindredButton,
    KindredPromptCard
  } = window.KindredDesignSystem_495fbf;
  const [listening, setListening] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [listening]);
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  function toggle() {
    if (listening) {
      setListening(false);
      onSaved && onSaved(elapsed);
    } else {
      setElapsed(0);
      setListening(true);
    }
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'var(--space-7)',
      padding: 'var(--space-8) var(--space-6)',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(KindredPromptCard, {
    eyebrow: prompt.eyebrow,
    forName: "Sal",
    prompt: prompt.text,
    style: {
      textAlign: 'left'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement(KindredVoiceButton, {
    listening: listening,
    onClick: toggle,
    label: listening ? 'Tap when finished' : 'Tap to speak'
  }), listening ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-ui)',
      letterSpacing: 'var(--tracking-mono)',
      color: 'var(--accent-strong)'
    }
  }, mm, ":", ss) : /*#__PURE__*/React.createElement(KindredButton, {
    variant: "ghost",
    size: "small",
    leadingIcon: "\u2328",
    onClick: onTypeInstead
  }, "Type instead")));
}
Object.assign(window, {
  Conversation
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/kindred-app/Conversation.jsx", error: String((e && e.message) || e) }); }

// ui_kits/kindred-app/StoryDetail.jsx
try { (() => {
/* Kindred app — Story detail screen.
   One memory, full bleed: photo, listen bar, serif transcript. Stories are the hero. */
function StoryDetail({
  story,
  onBack
}) {
  const {
    KindredListenBar,
    KindredButton,
    KindredChip
  } = window.KindredDesignSystem_495fbf;
  const [playing, setPlaying] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: 'var(--space-9)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 280,
      position: 'relative',
      backgroundImage: 'repeating-linear-gradient(135deg, var(--support-soft) 0 18px, var(--accent-soft) 18px 36px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 'var(--space-5)',
      left: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement(KindredButton, {
    variant: "secondary",
    size: "small",
    leadingIcon: "\u2190",
    onClick: onBack
  }, "Back"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 660,
      margin: '0 auto',
      padding: '0 var(--space-6)',
      transform: 'translateY(-44px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: 'var(--border-width) solid var(--border)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-lift)',
      padding: 'var(--space-7)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      letterSpacing: 'var(--tracking-mono)',
      color: 'var(--text-meta)'
    }
  }, story.year, " \xB7 ", story.place, " \xB7 Recorded ", story.recorded), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 'var(--space-3) 0 var(--space-5)',
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-display)',
      fontWeight: 'var(--weight-medium)',
      lineHeight: 'var(--leading-tight)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-body)',
      textWrap: 'pretty'
    }
  }, story.title), /*#__PURE__*/React.createElement(KindredListenBar, {
    title: "Sal's voice",
    duration: story.duration,
    playing: playing,
    onToggle: () => setPlaying(p => !p)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-6)'
    }
  }, story.transcript.map((p, i) => /*#__PURE__*/React.createElement("p", {
    key: i,
    style: {
      margin: i ? 'var(--space-5) 0 0' : 0,
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-story)',
      lineHeight: 'var(--leading-loose)',
      color: 'var(--text-body)'
    }
  }, p))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      flexWrap: 'wrap',
      marginTop: 'var(--space-7)'
    }
  }, story.tags.map(t => /*#__PURE__*/React.createElement(KindredChip, {
    key: t
  }, t))))));
}
Object.assign(window, {
  StoryDetail
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/kindred-app/StoryDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/kindred-app/Timeline.jsx
try { (() => {
/* Kindred app — Timeline screen.
   The warm gathering of saved memories. Filter chips + story cards. */
function Timeline({
  stories,
  onOpen,
  onAsk
}) {
  const {
    KindredChip,
    KindredStoryCard,
    KindredButton
  } = window.KindredDesignSystem_495fbf;
  const [filter, setFilter] = React.useState('All');
  const filters = ['All', 'Childhood', 'Family', 'Work', 'Naples'];
  const shown = filter === 'All' ? stories : stories.filter(s => s.tags.includes(filter));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--space-7) var(--space-7) var(--space-9)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 'var(--space-4)',
      marginBottom: 'var(--space-6)',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      letterSpacing: 'var(--tracking-mono)',
      textTransform: 'uppercase',
      color: 'var(--support)'
    }
  }, "Sal's stories \xB7 ", stories.length, " saved"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 'var(--space-2) 0 0',
      fontFamily: 'var(--font-story)',
      fontSize: 'var(--text-display)',
      fontWeight: 'var(--weight-medium)',
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-body)'
    }
  }, "A life, in his own voice")), /*#__PURE__*/React.createElement(KindredButton, {
    variant: "primary",
    leadingIcon: "\u270E",
    onClick: onAsk
  }, "Ask a question")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      flexWrap: 'wrap',
      marginBottom: 'var(--space-6)'
    }
  }, filters.map(f => /*#__PURE__*/React.createElement(KindredChip, {
    key: f,
    selected: filter === f,
    leadingIcon: f === 'Naples' ? '📍' : null,
    onClick: () => setFilter(f)
  }, f))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: 'var(--space-5)',
      alignItems: 'start'
    }
  }, shown.map(s => /*#__PURE__*/React.createElement(KindredStoryCard, {
    key: s.id,
    title: s.title,
    year: s.year,
    place: s.place,
    excerpt: s.excerpt,
    duration: s.duration,
    pinned: s.pinned,
    style: {
      maxWidth: 'none'
    },
    onClick: () => onOpen(s)
  }))));
}
Object.assign(window, {
  Timeline
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/kindred-app/Timeline.jsx", error: String((e && e.message) || e) }); }

__ds_ns.KindredButton = __ds_scope.KindredButton;

__ds_ns.KindredChip = __ds_scope.KindredChip;

__ds_ns.KindredListenBar = __ds_scope.KindredListenBar;

__ds_ns.KindredPromptCard = __ds_scope.KindredPromptCard;

__ds_ns.KindredStoryCard = __ds_scope.KindredStoryCard;

__ds_ns.KindredVoiceButton = __ds_scope.KindredVoiceButton;

})();
