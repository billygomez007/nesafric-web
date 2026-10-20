export const GHANA = {
  code: "GH",
  name: "Ghana",
  defaultCurrencyCode: "GHS",
  timezone: "Africa/Accra",
  phonePrefix: "+233",
} as const;

export const GHS = { code: "GHS", name: "Ghanaian Cedi", minorUnit: 2, symbol: "GH₵" } as const;

/**
 * Rough bounding boxes used only to reject pins that are plainly in another country. A pin inside
 * the box is not thereby "in" the country; it is only not obviously outside it.
 */
export const COUNTRY_BOUNDS: Record<string, { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }> = {
  GH: { minLatitude: 4.5, maxLatitude: 11.2, minLongitude: -3.3, maxLongitude: 1.3 },
};

/** Labels for each level, per configured country. */
export const GEO_LEVEL_LABELS: Record<string, { region: string; district: string; locality: string }> = {
  GH: { region: "Region", district: "District / Municipal / Metropolitan Assembly", locality: "Town or neighbourhood" },
};
