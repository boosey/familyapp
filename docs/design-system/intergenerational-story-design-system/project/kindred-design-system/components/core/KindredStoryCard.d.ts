import * as React from 'react';

export interface KindredStoryCardProps {
  /** Mono eyebrow, e.g. "1962 · THE COAST". */
  era?: string;
  /** Story title (Newsreader serif). */
  title?: string;
  /** Attribution line. */
  byline?: string;
  /** Extra metadata, dot-separated (e.g. ["4 min listen", "2 photos"]). */
  meta?: string[];
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * A memory in a list — striped photo placeholder + editorial title.
 * @startingPoint section="Kindred Core" subtitle="Story list item" viewport="620x160"
 */
export declare function KindredStoryCard(props: KindredStoryCardProps): React.JSX.Element;
