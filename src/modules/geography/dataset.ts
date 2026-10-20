import { z } from "zod";

/**
 * The canonical file format every geographic import reads (`data/geography/**.json`). Each file
 * is one source with its provenance; build scripts turn a source's raw download into this shape
 * without inventing records, and the importer turns it into reference rows.
 */
const verification = z.enum(["OFFICIAL", "SOURCE_ASSERTED", "UNVERIFIED", "TEST_FIXTURE"]);
const code = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_.-]+$/);
const name = z.string().trim().min(1).max(150);
const centroid = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
const alias = z.object({ alias: name, kind: z.enum(["ALTERNATE_NAME", "FORMER_NAME", "SPELLING", "ABBREVIATION"]).default("ALTERNATE_NAME") }).strict();

export const geoDatasetSchema = z.object({
  format: z.literal("nesafric-geo-dataset/1"),
  countryCode: z.string().length(2).regex(/^[A-Z]{2}$/),
  source: z.object({
    id: code,
    name: z.string().min(1).max(200),
    publisher: z.string().min(1).max(300),
    url: z.string().url().max(500),
    version: z.string().max(100).nullable().optional(),
    retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    licence: z.string().min(1).max(200),
    licenceUrl: z.string().url().max(500).nullable().optional(),
    coverage: z.string().min(1).max(500),
    verificationStatus: verification,
    notes: z.string().max(4000).nullable().optional(),
  }).strict(),
  areas: z.array(z.object({
    type: z.enum(["REGION", "DISTRICT", "CONSTITUENCY"]),
    code,
    name,
    /** The parent area's code (a region), in this file or already imported. */
    parentCode: code.nullable().optional(),
    assemblyKind: z.enum(["METROPOLITAN", "MUNICIPAL", "DISTRICT"]).nullable().optional(),
    aliases: z.array(alias).max(20).default([]),
    centroid: centroid.nullable().optional(),
    sourceRecordRef: z.string().max(200).nullable().optional(),
    /** Overrides the source's verification for this record (never upwards). */
    verificationStatus: verification.optional(),
  }).strict()).max(5_000).default([]),
  localities: z.array(z.object({
    /** The source's own id for the record; with the source id it forms the stable key. */
    ref: code,
    name,
    kind: z.enum(["CITY", "TOWN", "NEIGHBOURHOOD", "ESTATE", "VILLAGE", "OTHER"]),
    aliases: z.array(alias).max(20).default([]),
    centroid: centroid.nullable().optional(),
    links: z.array(z.object({
      areaType: z.enum(["REGION", "DISTRICT", "CONSTITUENCY"]),
      areaCode: code,
      relation: z.enum(["WITHIN", "PARTLY_WITHIN"]).default("WITHIN"),
      verificationStatus: verification,
      note: z.string().max(300).nullable().optional(),
    }).strict()).max(20).default([]),
    verificationStatus: verification.optional(),
  }).strict()).max(100_000).default([]),
}).strict();

export type GeoDataset = z.infer<typeof geoDatasetSchema>;

const TYPE_PREFIX = { REGION: "REG", DISTRICT: "DIS", CONSTITUENCY: "CON" } as const;

/** Stable id of an area first imported with this code. Kept even if the code later changes. */
export const areaIdFor = (countryCode: string, type: keyof typeof TYPE_PREFIX, areaCode: string) => `${countryCode}-${TYPE_PREFIX[type]}-${areaCode}`;
/** Stable id of a locality first imported from this source record. */
export const localityIdFor = (countryCode: string, sourceId: string, ref: string) => `${countryCode}-LOC-${sourceId}-${ref}`;
