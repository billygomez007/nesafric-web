import catalogue from "@/data/ghana-locations.json";

export type GhanaDistrict = {
  id: string;
  name: string;
  places: string[];
};

export type GhanaRegion = {
  id: string;
  name: string;
  districts: GhanaDistrict[];
};

export const GHANA_REGIONS = catalogue as GhanaRegion[];

export const GHANA_REGION_OPTIONS = GHANA_REGIONS.map(
  (region) => [region.name, region.name] as const,
);

export function districtsForRegion(regionName: string) {
  return (
    GHANA_REGIONS.find(
      (region) =>
        region.name.localeCompare(
          regionName,
          undefined,
          { sensitivity: "base" },
        ) === 0,
    )?.districts ?? []
  );
}

export function placesForDistrict(
  regionName: string,
  districtName: string,
) {
  return (
    districtsForRegion(regionName).find(
      (district) =>
        district.name.localeCompare(
          districtName,
          undefined,
          { sensitivity: "base" },
        ) === 0,
    )?.places ?? []
  );
}
