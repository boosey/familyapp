/** Color palette ids — must match `[data-theme]` selectors in `_kindred/tokens.css`. */
export const THEME_IDS = ["heirloom", "archive", "hearth"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "heirloom";

export const THEME_STORAGE_KEY = "kin-theme";

export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}
