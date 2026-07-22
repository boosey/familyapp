/**
 * Choose whether the trailing primary action stays labeled or iconifies (#301).
 * Outside expansion precedence: prefer labeled when fully-collapsed browse + labeled action fit;
 * otherwise iconify so Tell/Add Photos still fit without competing with Sub tabs → Views.
 */
export function resolvePrimaryActionForm(input: {
  availableWidth: number;
  /** Width of every present browse unit at its most-collapsed form (no gaps). */
  minBrowseWidth: number;
  /** Inter-unit gaps for browse units + the action (already counted). */
  gapsWidth: number;
  labeledActionWidth: number;
  iconifiedActionWidth: number;
}): "labeled" | "iconified" {
  const available = Number.isFinite(input.availableWidth) ? Math.max(0, input.availableWidth) : 0;
  const minBrowse = Number.isFinite(input.minBrowseWidth) ? Math.max(0, input.minBrowseWidth) : 0;
  const gaps = Number.isFinite(input.gapsWidth) ? Math.max(0, input.gapsWidth) : 0;
  const labeled = Number.isFinite(input.labeledActionWidth)
    ? Math.max(0, input.labeledActionWidth)
    : 0;
  if (minBrowse + gaps + labeled <= available) return "labeled";
  return "iconified";
}
