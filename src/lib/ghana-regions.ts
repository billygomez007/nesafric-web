/**
 * Ghana's sixteen regions and the other ways listings record them. Listing forms take the region as
 * free text, so live listings hold "GA", "Greater Accra Region" or "Accra" for the same region; a
 * region filter matches all of them.
 */
const REGION_ALIASES: Record<string, string[]> = {
  "Greater Accra": ["GA", "GAR", "Accra"],
  Ashanti: ["AH", "AS", "ASH", "Kumasi"],
  Western: ["WP", "WR"],
  "Western North": ["WN", "WNR"],
  Central: ["CP", "CR"],
  Eastern: ["EP", "ER"],
  Volta: ["TV", "VR"],
  Oti: ["OT", "OTR"],
  Northern: ["NP", "NR"],
  Savannah: ["SV", "SR"],
  "North East": ["NE", "NER", "North-East"],
  "Upper East": ["UE", "UER"],
  "Upper West": ["UW", "UWR"],
  Bono: ["BO", "BA", "Brong Ahafo", "Brong-Ahafo"],
  "Bono East": ["BE", "BER"],
  Ahafo: ["AF", "AHR"],
};

const key = (value: string) => value.trim().toLowerCase().replace(/\s+region$/, "").replace(/\s+/g, " ");

/** Every lower-case spelling of the region `value` names (itself only when it is not a Ghana region). */
export function regionSpellings(value: string): string[] {
  const wanted = key(value);
  const entry = Object.entries(REGION_ALIASES).find(([name, aliases]) => [name, ...aliases].some((alias) => key(alias) === wanted));
  if (!entry) return [value.trim().toLowerCase()];
  return [...new Set([entry[0], ...entry[1]].flatMap((name) => [name.toLowerCase(), `${name.toLowerCase()} region`]))];
}
