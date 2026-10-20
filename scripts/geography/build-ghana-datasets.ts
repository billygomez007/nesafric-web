/**
 * Builds the canonical Ghana geography datasets in data/geography/gh/ from the raw downloads
 * recorded in docs/geography-sources.md. It only reshapes what the sources contain: no record is
 * invented, and every relationship it derives (a GeoNames point inside a district polygon) is
 * marked UNVERIFIED with a note saying how it was derived.
 *
 *   npx tsx scripts/geography/build-ghana-datasets.ts --sources <dir> [--out data/geography/gh]
 *
 * <dir> must contain:
 *   hdx-cod-ab/csv_extracted/gha_admin1.csv, gha_admin2.csv   (sheets of gha_admin_boundaries.xlsx)
 *   ec-ghana/ec_2024_constituencies_extracted.csv
 *   geonames/extracted/GH.txt
 *   geoboundaries/geoBoundaries-GHA-ADM2_simplified.geojson
 * The input files are read as data only.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { geoDatasetSchema, type GeoDataset } from "../../src/modules/geography/dataset";
import { normalizeGeoName, stableKey } from "../../src/modules/geography/normalize";

const RETRIEVED = "2026-10-20";

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

/** RFC 4180 CSV (quoted fields, embedded commas and quotes). */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((key, index) => [key.replace(/^﻿/, ""), values[index] ?? ""])));
}

const assemblyKind = (name: string) => /\b(Metropolitan|Metropolis)$/i.test(name) ? "METROPOLITAN" as const : /\bMunicipal$/i.test(name) ? "MUNICIPAL" as const : null;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Corrections to source spellings, applied with the source's spelling kept as an alias. Each one
 * is a documented, reviewable decision, not a silent change.
 */
const REGION_NAME_CORRECTIONS: Record<string, { name: string; reason: string }> = {
  // HDX COD-AB v01 spells the region "Northern East"; the region created in 2018 is "North East".
  "Northern East": { name: "North East", reason: "Official region name; HDX spelling kept as an alias." },
};

function buildAdmin(sources: string): GeoDataset {
  const admin1 = parseCsv(readFileSync(path.join(sources, "hdx-cod-ab/csv_extracted/gha_admin1.csv"), "utf8"));
  const admin2 = parseCsv(readFileSync(path.join(sources, "hdx-cod-ab/csv_extracted/gha_admin2.csv"), "utf8"));
  const regions = admin1.map((row) => {
    const correction = REGION_NAME_CORRECTIONS[row.adm1_name];
    return {
      type: "REGION" as const, code: row.adm1_pcode, name: correction?.name ?? row.adm1_name,
      aliases: correction ? [{ alias: row.adm1_name, kind: "SPELLING" as const }] : [],
      centroid: { latitude: round(Number(row.center_lat)), longitude: round(Number(row.center_lon)) },
      sourceRecordRef: row.adm1_pcode,
    };
  });
  const districts = admin2.map((row) => ({
    type: "DISTRICT" as const, code: row.adm2_pcode, name: row.adm2_name, parentCode: row.adm1_pcode,
    assemblyKind: assemblyKind(row.adm2_name),
    aliases: [] as Array<{ alias: string; kind: "SPELLING" }>,
    centroid: { latitude: round(Number(row.center_lat)), longitude: round(Number(row.center_lon)) },
    sourceRecordRef: row.adm2_pcode,
  }));
  return {
    format: "nesafric-geo-dataset/1",
    countryCode: "GH",
    source: {
      id: "hdx-cod-ab-gha-v01",
      name: "Ghana - Subnational Administrative Boundaries (COD-AB)",
      publisher: "OCHA (HDX), contributed by OCHA ROWCA; underlying source: Ghana Statistical Service",
      url: "https://data.humdata.org/dataset/cod-ab-gha",
      version: "v01 (boundaries valid on 2021-03-08, reviewed 2025-10-30)",
      retrievedAt: RETRIEVED,
      licence: "CC BY-IGO",
      licenceUrl: "https://creativecommons.org/licenses/by/3.0/igo/legalcode",
      coverage: `${regions.length} regions and ${districts.length} districts (P-codes, district-to-region membership, centroids). Guan District (Oti, L.I. 2416) is absent.`,
      verificationStatus: "SOURCE_ASSERTED",
      notes: "Common Operational Dataset compiled from Ghana Statistical Service boundaries. Not checked against a current MLGDRA gazette list (unavailable at retrieval). Region 'Northern East' is recorded as 'North East' with the source spelling as an alias. Centroids are polygon centres, not locations.",
    },
    areas: [...regions, ...districts],
    localities: [],
  };
}

function buildConstituencies(sources: string, regionCodes: Map<string, string>): GeoDataset {
  const rows = parseCsv(readFileSync(path.join(sources, "ec-ghana/ec_2024_constituencies_extracted.csv"), "utf8"));
  const areas = rows.map((row) => {
    const regionName = normalizeGeoName(row.ec_region_page.replace(/-region$/, ""));
    const parentCode = regionCodes.get(regionName);
    if (!parentCode) throw new Error(`Unknown region page ${row.ec_region_page}`);
    const name = row.constituency_name_as_shown.trim();
    return {
      type: "CONSTITUENCY" as const,
      // The EC publishes no stable constituency codes; this key is derived from region and name.
      code: `EC24-${parentCode}-${stableKey(name)}`,
      name, parentCode, aliases: [],
      sourceRecordRef: row.result_sheet_filename_code || null,
    };
  });
  return {
    format: "nesafric-geo-dataset/1",
    countryCode: "GH",
    source: {
      id: "ec-gh-2024-constituencies",
      name: "Electoral Commission of Ghana - 2024 election results pages (constituency names by region)",
      publisher: "Electoral Commission of Ghana",
      url: "https://ec.gov.gh/",
      version: "2024 general election (result sheets uploaded 2025-01)",
      retrievedAt: RETRIEVED,
      licence: "No licence stated; constituency names and their regions are used as facts only",
      licenceUrl: null,
      coverage: `${areas.length} parliamentary constituencies with their region. No districts, boundaries or official codes.`,
      verificationStatus: "SOURCE_ASSERTED",
      notes: "Electoral geography only. Constituencies are never parents of districts or localities, and no constituency-to-district relationship is recorded because none is published authoritatively.",
    },
    areas,
    localities: [],
  };
}

type Ring = Array<[number, number]>;
type Polygon = Ring[];

function insideRing(point: [number, number], ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const insidePolygon = (point: [number, number], polygon: Polygon) => insideRing(point, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(point, hole));

/** Approximate distance (km) from a point to a polygon's edges (equirectangular, fine at this scale). */
function edgeDistanceKm(point: [number, number], polygons: Polygon[]) {
  const kx = 111.32 * Math.cos((point[1] * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = (ring[i][0] - point[0]) * kx, ay = (ring[i][1] - point[1]) * ky;
    const bx = (ring[i + 1][0] - point[0]) * kx, by = (ring[i + 1][1] - point[1]) * ky;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** A point this close to a (simplified) district boundary is not linked: the person is asked. */
const BOUNDARY_MARGIN_KM = 0.75;

function buildLocalities(sources: string, districtsByName: Map<string, string>): { dataset: GeoDataset; stats: Record<string, number> } {
  const geojson = JSON.parse(readFileSync(path.join(sources, "geoboundaries/geoBoundaries-GHA-ADM2_simplified.geojson"), "utf8")) as { features: Array<{ properties: { shapeName: string }; geometry: { type: string; coordinates: unknown } }> };
  const shapes = geojson.features.map((feature) => {
    const code = districtsByName.get(normalizeGeoName(feature.properties.shapeName));
    const polygons = (feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Polygon[];
    return { code, name: feature.properties.shapeName, polygons };
  });
  const unmatchedShapes = shapes.filter((shape) => !shape.code).map((shape) => shape.name);
  if (unmatchedShapes.length) console.warn(`District polygons without an HDX match (no links derived inside them): ${unmatchedShapes.join("; ")}`);

  const lines = readFileSync(path.join(sources, "geonames/extracted/GH.txt"), "utf8").split("\n").filter(Boolean);
  const KINDS: Record<string, "CITY" | "TOWN" | "NEIGHBOURHOOD" | "OTHER"> = { PPLC: "CITY", PPLA: "CITY", PPLA2: "CITY", PPL: "TOWN", PPLX: "NEIGHBOURHOOD", PPLL: "OTHER" };
  const stats = { places: 0, linked: 0, nearBoundary: 0, outside: 0 };
  const localities: GeoDataset["localities"] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    const kind = KINDS[cols[7]];
    if (cols[6] !== "P" || !kind) continue; // PPLQ (abandoned) and PPLW (destroyed) are skipped.
    const name = cols[1].trim();
    if (!name || name.length > 150) continue;
    stats.places += 1;
    const point: [number, number] = [Number(cols[5]), Number(cols[4])];
    const aliases: Array<{ alias: string; kind: "SPELLING" | "ALTERNATE_NAME" }> = [];
    if (cols[2] && normalizeGeoName(cols[2]) !== normalizeGeoName(name)) aliases.push({ alias: cols[2].slice(0, 150), kind: "SPELLING" });
    // "East Legon Residential Area" is what people call "East Legon".
    const short = name.replace(/\s+Residential(?:\s+Area)?$/i, "").trim();
    if (short !== name && short.length >= 2) aliases.push({ alias: short, kind: "ALTERNATE_NAME" });
    const containing = shapes.filter((shape) => shape.code && shape.polygons.some((polygon) => insidePolygon(point, polygon)));
    const links: GeoDataset["localities"][number]["links"] = [];
    if (containing.length === 1) {
      if (edgeDistanceKm(point, containing[0].polygons) >= BOUNDARY_MARGIN_KM) {
        links.push({ areaType: "DISTRICT", areaCode: containing[0].code!, relation: "WITHIN", verificationStatus: "UNVERIFIED", note: "Derived: GeoNames point inside the geoBoundaries 2019 district polygon (simplified)." });
        stats.linked += 1;
      } else stats.nearBoundary += 1;
    } else stats.outside += 1;
    localities.push({
      ref: cols[0], name, kind, aliases,
      centroid: Number.isFinite(point[0]) && Number.isFinite(point[1]) ? { latitude: round(point[1]), longitude: round(point[0]) } : null,
      links,
    });
  }
  return {
    stats,
    dataset: {
      format: "nesafric-geo-dataset/1",
      countryCode: "GH",
      source: {
        id: "geonames-gh",
        name: "GeoNames gazetteer, Ghana extract (populated places)",
        publisher: "GeoNames (geonames.org)",
        url: "https://download.geonames.org/export/dump/GH.zip",
        version: "Dump of 2026-10-20",
        retrievedAt: RETRIEVED,
        licence: "CC BY 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
        coverage: `${stats.places} populated places and neighbourhoods with approximate points. District links derived for ${stats.linked}; ${stats.nearBoundary} near a boundary and ${stats.outside} outside every matched polygon are left unlinked.`,
        verificationStatus: "SOURCE_ASSERTED",
        notes: "Crowd-sourced gazetteer; names and points are not official. District links are derived from geoBoundaries gbOpen GHA ADM2 (CC BY 4.0, USAID/GSS, 2019) polygons and marked UNVERIFIED. Points are approximate centres, never anyone's location.",
      },
      areas: [],
      localities,
    },
  };
}

function write(out: string, file: string, dataset: GeoDataset) {
  const parsed = geoDatasetSchema.parse(dataset);
  writeFileSync(path.join(out, file), `${JSON.stringify(parsed)}\n`);
  console.log(`${file}: ${parsed.areas.length} areas, ${parsed.localities.length} localities`);
}

function main() {
  const sources = arg("sources");
  const out = arg("out", "data/geography/gh");
  mkdirSync(out, { recursive: true });
  const admin = buildAdmin(sources);
  const regionCodes = new Map(admin.areas.filter((area) => area.type === "REGION").flatMap((area) => [[normalizeGeoName(area.name), area.code], ...area.aliases.map((alias) => [normalizeGeoName(alias.alias), area.code] as [string, string])]));
  const districtsByName = new Map(admin.areas.filter((area) => area.type === "DISTRICT").map((area) => [normalizeGeoName(area.name), area.code]));
  write(out, "hdx-cod-ab-admin.json", admin);
  write(out, "ec-2024-constituencies.json", buildConstituencies(sources, regionCodes));
  const { dataset, stats } = buildLocalities(sources, districtsByName);
  write(out, "geonames-localities.json", dataset);
  console.log(JSON.stringify(stats));
}

main();
