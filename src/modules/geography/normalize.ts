/**
 * Name normalisation shared by imports, resolution and search. Lower-cases, strips accents and
 * punctuation and collapses spaces, so "Ga East", "GA-EAST" and "Gá East" all compare equal.
 * It never strips meaningful words: "Accra Metropolitan" and "Accra" stay different names, and
 * any equivalence between them must be recorded as an alias with a source.
 */
export function normalizeGeoName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Words people add around a region name ("Ashanti Region") that never change which region it is. */
export function normalizeRegionQuery(value: string): string {
  return normalizeGeoName(value).replace(/\s+region$/, "").trim();
}

/** A deterministic, stable key for a record that has no source code (for example a locality). */
export function stableKey(...parts: string[]): string {
  const text = parts.map((part) => normalizeGeoName(part).replace(/\s+/g, "-")).join(":");
  // FNV-1a 32-bit, base36: short, deterministic and identical on every machine and run.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/** Valid WGS84 coordinates (and not the "null island" placeholder some clients send). */
export function isValidCoordinate(latitude: unknown, longitude: unknown): latitude is number {
  return typeof latitude === "number" && typeof longitude === "number"
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    && !(latitude === 0 && longitude === 0);
}
