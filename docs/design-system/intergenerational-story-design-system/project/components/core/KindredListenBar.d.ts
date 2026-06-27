import * as React from 'react';

export interface KindredListenBarProps {
  /** Total duration label, e.g. "3:48". */
  duration?: string;
  /** Waveform bar heights in px. */
  bars?: number[];
  onPlay?: () => void;
  style?: React.CSSProperties;
}

/** Audio player for listening to the original recording. */
export declare function KindredListenBar(props: KindredListenBarProps): React.JSX.Element;
