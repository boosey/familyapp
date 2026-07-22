/** Design-language ids — must match `:root[data-skin="…"]` selectors in the `_skins/*.css` files. */
export const SKIN_IDS = ["scrapbook", "heirloom"] as const;
export type SkinId = (typeof SKIN_IDS)[number];
/** Scrapbook is the default look; heirloom preserves the pre-redesign design language. */
export const DEFAULT_SKIN_ID: SkinId = "scrapbook";
export const SKIN_STORAGE_KEY = "kin-skin";

/**
 * Stale storage values that still map to a current SkinId.
 * Devices that still have `kin-skin=playful` must keep Scrapbook (not fall through to Heirloom).
 * Dropping these aliases is out of scope until a later migration ticket.
 */
export const SKIN_ALIASES: Readonly<Record<string, SkinId>> = {
  playful: "scrapbook",
};
