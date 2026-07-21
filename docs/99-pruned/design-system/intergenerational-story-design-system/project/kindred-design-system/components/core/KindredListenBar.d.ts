import * as React from 'react';

export interface KindredListenBarProps {
  /**
   * Playback state. Omit to let the bar manage its own play/pause; pass a
   * boolean to drive it from a parent (controlled — `onToggle` fires on tap).
   */
  playing?: boolean;
  /** Mono timecode for the full length, also parsed as total seconds. @default "3:24" */
  duration?: string;
  /** Optional story title above the scrubber. */
  title?: string;
  /** Play/pause toggle handler. */
  onToggle?: () => void;
  /** Show the "next story" button at the end of the transport row. @default true */
  showNext?: boolean;
  /** Handler for the "next story" button. */
  onNext?: () => void;
  style?: React.CSSProperties;
}

/**
 * An audio playback row for a recorded story — a draggable scrubber line with a
 * position thumb between mono timecodes, over a transport row: start over,
 * back 10s, play/pause, forward 10s, and next story. Voice is the medium; this
 * is how a recorded answer is heard back.
 */
export declare function KindredListenBar(props: KindredListenBarProps): React.ReactElement;
