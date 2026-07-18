/** Design-language ids — must match `:root[data-skin="…"]` selectors in the `_skins/*.css` files. */
export const SKIN_IDS = ["playful", "heirloom"] as const;
export type SkinId = (typeof SKIN_IDS)[number];
/** Playful is the new default look; heirloom preserves the pre-redesign design language. */
export const DEFAULT_SKIN_ID: SkinId = "playful";
export const SKIN_STORAGE_KEY = "kin-skin";
