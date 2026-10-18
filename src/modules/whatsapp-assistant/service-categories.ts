import { listPubliclyVisibleServiceCategories } from "@/modules/providers/service";
import { normalize } from "./nlu";

/**
 * Maps everyday words ("plumber", "my pipe is leaking", "fumigation") onto NesAfric's real
 * service-category records. Categories always come from the database; a synonym only applies when
 * its category key actually exists and is publicly visible, so nothing is invented.
 */
const SYNONYMS: Array<[RegExp, string[]]> = [
  [/\b(plumb\w*|pipes?|leak\w*|toilet|sink|tap|faucet|water heater|drain\w*|blocked)\b/, ["plumbing"]],
  [/\b(electric\w*|wiring|sockets?|switch(es)?|lights? (not working|repair)|power cut|fuse)\b/, ["electrical"]],
  [/\b(carpent\w*|joiner\w*|doors?|wood ?work)\b/, ["carpentry", "furniture_joinery"]],
  [/\b(paint\w*|decorat\w*)\b/, ["painting", "decorative_painting"]],
  [/\b(mason\w*|block ?work|bricklay\w*|plaster\w*)\b/, ["masonry"]],
  [/\b(contractor|builder|construction|build (a|my) house)\b/, ["building_contractor", "general_contractor"]],
  [/\barchitect\w*\b/, ["architecture"]],
  [/\bquantity survey\w*\b/, ["quantity_surveying"]],
  [/\b(land )?survey\w*\b/, ["land_surveying"]],
  [/\b(lawyer|solicitor|legal|conveyanc\w*)\b/, ["property_lawyers", "land_documentation"]],
  [/\b(valuer|valuation|value my)\b/, ["property_valuation"]],
  [/\b(clean\w*|janitor\w*)\b/, ["residential_cleaning", "deep_cleaning", "commercial_cleaning"]],
  [/\b(pest|fumigat\w*|termites?|cockroach\w*|rodents?|mosquito\w*|bed ?bugs?)\b/, ["pest_control"]],
  [/\b(mov(er|ers|ing)|relocat\w*|haulage)\b/, ["home_moving", "relocation_services", "office_moving"]],
  [/\binterior\w*\b/, ["interior_design", "interior_fitout"]],
  [/\b(security|guards?|watchm[ae]n)\b/, ["security"]],
  [/\b(a\/c|air ?con\w*|hvac|aircon)\b/, ["hvac"]],
  [/\bgenerators?\b/, ["generator_power_backup"]],
  [/\bsolar\b/, ["solar"]],
  [/\b(cctv|camera)\b/, ["cctv_installation"]],
  [/\bborehole\b/, ["borehole_water_systems"]],
  [/\b(garden\w*|landscap\w*|lawn)\b/, ["landscaping", "gardening", "lawn_maintenance"]],
  [/\b(roof\w*)\b/, ["roofing"]],
  [/\b(tiler|tiling|tiles)\b/, ["tiling"]],
  [/\b(weld\w*)\b/, ["welding", "steel_works"]],
  [/\b(handyman|odd jobs|general repairs?|maintenance|repair\w*|fix\w*)\b/, ["handyman"]],
  [/\b(property manag\w*|facility manag\w*)\b/, ["property_management", "facility_maintenance"]],
];

export type ServiceCategoryOption = { id: string; key: string; name: string; parentName: string | null };

export async function publicServiceCategories(): Promise<ServiceCategoryOption[]> {
  const rows = await listPubliclyVisibleServiceCategories();
  return rows.map((row) => ({ id: row.id, key: row.key, name: row.name, parentName: row.parent?.name ?? null }));
}

/** Best category for a message, or undefined when nothing matches convincingly. */
export function matchServiceCategory(raw: string, categories: ServiceCategoryOption[]): ServiceCategoryOption | undefined {
  const value = normalize(raw);
  if (!value) return undefined;
  const byKey = new Map(categories.map((category) => [category.key, category]));
  for (const [pattern, keys] of SYNONYMS) {
    if (!pattern.test(value)) continue;
    const found = keys.map((key) => byKey.get(key)).find(Boolean);
    if (found) return found;
  }
  // Fall back to word overlap with the category's own name (leaf categories only).
  const words = new Set(value.split(" ").filter((word) => word.length >= 4));
  let best: { category: ServiceCategoryOption; score: number } | undefined;
  for (const category of categories) {
    if (!category.parentName) continue;
    const nameWords = normalize(category.name).split(/[ /&,-]+/).filter((word) => word.length >= 4);
    const score = nameWords.filter((word) => words.has(word) || [...words].some((candidate) => candidate.startsWith(word.slice(0, 5)))).length;
    if (score > 0 && (!best || score > best.score)) best = { category, score };
  }
  return best?.category;
}

/** The most commonly requested categories, for the "which service?" menu. Only those that exist. */
export const POPULAR_CATEGORY_KEYS = ["plumbing", "electrical", "residential_cleaning", "pest_control", "hvac", "painting", "carpentry", "building_contractor", "home_moving"];
