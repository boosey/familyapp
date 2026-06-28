/**
 * Shared name for the one-time invite-link flash cookie. Lives in its own module so both the
 * InviteTab (which reads it during render) and the clear-flash route handler (which deletes it)
 * agree on the name and path without a render-time cookie mutation.
 */
export const INVITE_FLASH_COOKIE = "chronicle_flash_invite_token";
export const INVITE_FLASH_PATH = "/hub";

/**
 * Second one-time flash for the family-member invite (the /join/[token] link). Kept distinct from
 * the elder link above so the two invite modes can't clobber each other's show-once state. Same
 * show-once contract; cleared by the same route handler.
 */
export const MEMBER_INVITE_FLASH_COOKIE = "chronicle_flash_member_invite_token";
export const MEMBER_INVITE_FLASH_PATH = "/hub";
