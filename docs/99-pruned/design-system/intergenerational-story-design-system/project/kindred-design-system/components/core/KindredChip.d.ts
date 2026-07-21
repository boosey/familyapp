import * as React from 'react';

export interface KindredChipProps {
  /** person renders an avatar; place prefixes a pin; time uses mono. */
  kind?: 'person' | 'place' | 'time';
  /** Chip text (name, place or year). */
  label?: string;
  /** Avatar initial for person chips (defaults to first letter of label). */
  initial?: string;
  /** Avatar fill for person chips. */
  avatar?: 'sage' | 'accent';
  style?: React.CSSProperties;
}

/** Provenance tag: a person, a place, or a year. */
export declare function KindredChip(props: KindredChipProps): React.JSX.Element;
