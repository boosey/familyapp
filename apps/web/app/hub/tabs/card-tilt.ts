import type { CSSProperties } from "react";

/**
 * The odd/even card lean for the Scrapbook skin's ask/question card lists, mirroring StoryCard's inline
 * `--tilt` (StoryCard.tsx line ~146). Tilt MATH stays in TS per the repo convention (numbers used in
 * layout geometry are TS constants, not CSS); the CSS module only consumes the custom property, and
 * the whole effect is skin-scoped + suppressed under reduce-motion / solemn in the module.
 *
 * Returns an inline style object carrying the `--tilt` custom property (a string with units, cast to
 * CSSProperties under TS-strict — see apps/web/app/_skins/CSS-MODULES.md rule 6).
 */
const TILT_DEG = 0.55;

export function cardTilt(index: number): CSSProperties {
  return { "--tilt": index % 2 ? `-${TILT_DEG}deg` : `${TILT_DEG}deg` } as CSSProperties;
}
