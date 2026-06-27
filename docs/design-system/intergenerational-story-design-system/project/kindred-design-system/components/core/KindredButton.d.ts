import * as React from 'react';

export interface KindredButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button text. */
  label?: string;
  /** Visual weight. primary = filled accent; secondary = outline; ghost = text-only. */
  variant?: 'primary' | 'secondary' | 'ghost';
}

/**
 * Kindred's button. 64px tall (elder-first), 14px radius, 19px label.
 * @startingPoint section="Kindred Core" subtitle="Primary / secondary / ghost button" viewport="360x88"
 */
export declare function KindredButton(props: KindredButtonProps): React.JSX.Element;
