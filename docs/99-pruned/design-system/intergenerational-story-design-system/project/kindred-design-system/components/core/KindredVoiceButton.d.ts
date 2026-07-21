import * as React from 'react';

export interface KindredVoiceButtonProps {
  /** idle pulses to invite speech; recording shows a calm stop square. */
  state?: 'idle' | 'recording';
  /** Override the caption under the mic. */
  label?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * The 96px voice action — the loudest element on any Kindred screen.
 * @startingPoint section="Kindred Core" subtitle="Idle / recording voice action" viewport="240x180"
 */
export declare function KindredVoiceButton(props: KindredVoiceButtonProps): React.JSX.Element;
