/**
 * PlaceSuggester — a declared vendor seam (album enhancements). Given a GPS coordinate (e.g. a
 * photo's `exif_gps`), a future implementation reverse-geocodes / AI-suggests a human place name
 * ("Cherry Street", "Naples"). Per repo convention every external vendor sits behind an interface
 * with a mock; this is the interface + a null mock. NO write path calls it yet — it is a home for
 * later reverse-geocode/AI wiring, kept vendor-free (no SDK).
 */
export interface PlaceSuggester {
  /** Suggest a place name for a coordinate, or null when nothing is known. */
  suggestPlace(gps: { lat: number; lng: number }): Promise<{ name: string } | null>;
}

/** The default seam implementation — always resolves null (no suggestion). */
export const nullPlaceSuggester: PlaceSuggester = {
  async suggestPlace() {
    return null;
  },
};
