import * as React from 'react';

export interface KindredPromptCardProps {
  /** Small tracked label above the question. */
  eyebrow?: string;
  /** The question, set in Newsreader serif. */
  question?: string;
  style?: React.CSSProperties;
}

/** A suggested question card — the seed of a conversation. */
export declare function KindredPromptCard(props: KindredPromptCardProps): React.JSX.Element;
