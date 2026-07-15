/** Color palette ids — must match `[data-theme]` selectors in `_kindred/tokens.css`. */
export const THEME_IDS = ["heirloom", "archive", "hearth"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME_ID: ThemeId = "heirloom";

export const THEME_STORAGE_KEY = "kin-theme";

// Validation (was `isThemeId`) and application (was `applyTheme`) now live in the preference
// registry — see preferences/registry.ts (`enum` validator) and preferences/client.ts (`data-attr`
// applier). Kept here: the ids, the type, the default, and the storage key the registry references.
