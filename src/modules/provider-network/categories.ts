/**
 * Work categories a landlord assigns to providers in their private network. Routing rules match
 * maintenance issues to these keys; `serviceCategoryKey` links to the marketplace taxonomy when a
 * provider profile is created on acceptance (null when the taxonomy has no equivalent).
 */
export const NETWORK_CATEGORIES = {
  plumbing: { label: "plumbing", aliases: ["plumber", "plumbing"], serviceCategoryKey: "plumbing" },
  electrical: { label: "electrical", aliases: ["electrician", "electrical"], serviceCategoryKey: "electrical" },
  carpentry: { label: "carpentry", aliases: ["carpenter", "carpentry", "joiner"], serviceCategoryKey: "carpentry" },
  painting: { label: "painting", aliases: ["painter", "painting"], serviceCategoryKey: "painting" },
  locksmith: { label: "locks", aliases: ["locksmith", "locks"], serviceCategoryKey: null },
  hvac: { label: "air conditioning", aliases: ["hvac", "ac", "air conditioning", "hvac technician"], serviceCategoryKey: "hvac" },
  cleaning: { label: "cleaning", aliases: ["cleaning", "cleaner", "cleaning services"], serviceCategoryKey: "residential_cleaning" },
  pest_control: { label: "pest control", aliases: ["pest control", "pest", "fumigation"], serviceCategoryKey: "pest_control" },
  general_maintenance: { label: "general maintenance", aliases: ["general maintenance", "handyman", "maintenance"], serviceCategoryKey: "handyman" },
  building: { label: "building works", aliases: ["builder", "contractor", "builders", "building"], serviceCategoryKey: "building_contractor" },
} as const;

export type NetworkCategory = keyof typeof NETWORK_CATEGORIES;
export const NETWORK_CATEGORY_KEYS = Object.keys(NETWORK_CATEGORIES) as NetworkCategory[];

export function parseNetworkCategory(raw: string): NetworkCategory | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if ((NETWORK_CATEGORY_KEYS as string[]).includes(value)) return value as NetworkCategory;
  return NETWORK_CATEGORY_KEYS.find((key) => (NETWORK_CATEGORIES[key].aliases as readonly string[]).includes(value)) ?? null;
}

export const categoryLabels = (keys: readonly string[]) => keys.map((key) => NETWORK_CATEGORIES[key as NetworkCategory]?.label ?? key).join(", ");
