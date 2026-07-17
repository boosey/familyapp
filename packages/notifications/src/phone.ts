import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Returns the E.164 form of `raw` (e.g. "+15551230000") or null if it is not a valid number. */
export function normalizePhone(raw: string, defaultRegion: CountryCode = "US"): string | null {
  if (!raw?.trim()) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultRegion);
  return parsed?.isValid() ? parsed.number : null;
}
