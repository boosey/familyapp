import React from 'react';

const BASE = {
  width: '100%',
  height: 'var(--kin-touch-default)',
  borderRadius: 'var(--kin-radius-sm)',
  fontFamily: 'var(--kin-font-sans)',
  fontSize: 'var(--kin-text-body)',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background .15s, border-color .15s',
};

const VARIANTS = {
  primary: {
    base: { border: 'none', background: 'var(--kin-accent)', color: 'var(--kin-on-accent)' },
    hover: { background: 'var(--kin-accent-press)' },
  },
  secondary: {
    base: { border: '1.5px solid var(--kin-field)', background: 'transparent', color: 'var(--kin-body)' },
    hover: { background: 'var(--kin-tint)', borderColor: 'var(--kin-accent)' },
  },
  ghost: {
    base: { border: 'none', background: 'transparent', color: 'var(--kin-accent)' },
    hover: { background: 'var(--kin-tint)' },
  },
};

/** Kindred primary / secondary / ghost button. Elder-first 64px target. */
export function KindredButton({ label = 'Save this story', variant = 'primary', onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...BASE, ...v.base, ...(hover ? v.hover : null), ...style }}
      {...rest}
    >
      {label}
    </button>
  );
}
