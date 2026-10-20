import { createHash } from "node:crypto";
import { Prisma, type GeoImportChangeAction } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { areaIdFor, geoDatasetSchema, localityIdFor, type GeoDataset } from "./dataset";
import { normalizeGeoName } from "./normalize";
import { clearGeoCatalogCache } from "./catalog";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const CHUNK = 1_000;

export type ImportChange = {
  action: GeoImportChangeAction;
  status: "APPLIED" | "PENDING_REVIEW" | "SKIPPED";
  entityType: "area" | "locality" | "alias" | "link";
  entityId: string | null;
  payload: Record<string, unknown>;
  reason?: string;
};

export type ImportReport = {
  runId: string;
  mode: "DRY_RUN" | "APPLY";
  sourceId: string;
  checksum: string;
  counts: Record<string, number>;
  warnings: string[];
  /** Changes held for review (renames, re-parenting, re-coding, deactivation) and skipped ones. */
  held: ImportChange[];
};

type Plan = {
  areaCreates: Prisma.GeoAreaCreateManyInput[];
  areaFills: Array<{ id: string; data: Prisma.GeoAreaUpdateInput }>;
  localityCreates: Prisma.GeoLocalityCreateManyInput[];
  aliasCreates: Prisma.GeoAliasCreateManyInput[];
  linkCreates: Prisma.GeoLocalityAreaCreateManyInput[];
  held: ImportChange[];
  warnings: string[];
};

/** Structural checks that make a file unusable. Nothing is written when any fails. */
export function validateDataset(dataset: GeoDataset, existingAreaCodes: Map<string, { id: string; type: string }>) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const key = (type: string, code: string) => `${type}:${code}`;
  const inFile = new Map<string, (typeof dataset.areas)[number]>();
  for (const area of dataset.areas) {
    if (inFile.has(key(area.type, area.code))) errors.push(`Duplicate ${area.type} code ${area.code}.`);
    inFile.set(key(area.type, area.code), area);
  }
  const regionExists = (code: string) => inFile.has(key("REGION", code)) || existingAreaCodes.get(key("REGION", code))?.type === "REGION";
  for (const area of dataset.areas) {
    if (area.type === "REGION" && area.parentCode) errors.push(`Region ${area.code} cannot have a parent.`);
    if (area.type === "DISTRICT" && !area.parentCode) errors.push(`District ${area.code} has no region.`);
    if (area.parentCode && !regionExists(area.parentCode)) errors.push(`${area.type} ${area.code}: parent region ${area.parentCode} not found (constituencies and districts can only sit in a region).`);
  }
  const names = new Map<string, string[]>();
  for (const area of dataset.areas) {
    const nameKey = `${area.type}:${area.parentCode ?? ""}:${normalizeGeoName(area.name)}`;
    names.set(nameKey, [...(names.get(nameKey) ?? []), area.code]);
  }
  for (const [nameKey, codes] of names) if (codes.length > 1) warnings.push(`Same name under one parent (${nameKey}): ${codes.join(", ")}. Kept as separate records; confirm they are distinct.`);
  const refs = new Set<string>();
  for (const locality of dataset.localities) {
    if (refs.has(locality.ref)) errors.push(`Duplicate locality ref ${locality.ref}.`);
    refs.add(locality.ref);
    for (const link of locality.links) {
      if (!inFile.has(key(link.areaType, link.areaCode)) && !existingAreaCodes.has(key(link.areaType, link.areaCode))) errors.push(`Locality ${locality.ref}: linked ${link.areaType} ${link.areaCode} not found.`);
    }
  }
  return { errors, warnings };
}

/**
 * Imports one canonical dataset. Dry run (the default) computes and records the report without
 * changing reference data. Apply writes only safe changes: new areas, localities, aliases and
 * links, and filling empty fields. Renames, re-parenting, re-coding and deactivation (records the
 * source no longer lists) are never applied automatically; they are held for review. Re-running
 * the same file changes nothing.
 */
export async function importGeoDataset(raw: unknown, options: { apply?: boolean; actorUserId?: string | null } = {}): Promise<ImportReport> {
  const dataset = geoDatasetSchema.parse(raw);
  const checksum = createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
  const country = await db.country.findUnique({ where: { code: dataset.countryCode } });
  if (!country) throw new AppError("GEO_IMPORT_COUNTRY_UNKNOWN", 422, `Country ${dataset.countryCode} is not configured.`);

  const existingAreas = await db.geoArea.findMany({ where: { countryCode: dataset.countryCode }, include: { aliases: true } });
  const codeIndex = new Map(existingAreas.filter((area) => area.code).map((area) => [`${area.type}:${area.code}`, { id: area.id, type: area.type }]));
  const { errors, warnings } = validateDataset(dataset, codeIndex);
  if (errors.length) throw new AppError("GEO_IMPORT_INVALID", 422, `The dataset is invalid: ${errors.slice(0, 20).join(" ")}${errors.length > 20 ? ` (${errors.length - 20} more)` : ""}`);

  const plan = await planImport(dataset, existingAreas, warnings);
  const counts = {
    areasCreated: plan.areaCreates.length,
    areasFilled: plan.areaFills.length,
    localitiesCreated: plan.localityCreates.length,
    aliasesAdded: plan.aliasCreates.length,
    linksAdded: plan.linkCreates.length,
    heldForReview: plan.held.filter((change) => change.status === "PENDING_REVIEW").length,
    skipped: plan.held.filter((change) => change.status === "SKIPPED").length,
  };
  const mode = options.apply ? "APPLY" : "DRY_RUN";

  const sourceData = {
    name: dataset.source.name, publisher: dataset.source.publisher, url: dataset.source.url, version: dataset.source.version ?? null,
    retrievedAt: dataset.source.retrievedAt ? new Date(`${dataset.source.retrievedAt}T00:00:00Z`) : null,
    licence: dataset.source.licence, licenceUrl: dataset.source.licenceUrl ?? null, coverage: dataset.source.coverage,
    verificationStatus: dataset.source.verificationStatus, notes: dataset.source.notes ?? null,
  };
  // A dry run records the source (provenance only) so its run can be listed; it changes no areas.
  await db.geoDataSource.upsert({ where: { id: dataset.source.id }, create: { id: dataset.source.id, ...sourceData }, update: sourceData });
  const run = await db.geoImportRun.create({ data: { sourceId: dataset.source.id, mode, inputChecksum: checksum, actorUserId: options.actorUserId ?? null } });
  try {
    if (options.apply) {
      await db.$transaction(async (tx) => {
        for (let i = 0; i < plan.areaCreates.length; i += CHUNK) {
          // Regions first so district/constituency parents exist (the hierarchy trigger checks).
          const batch = plan.areaCreates.slice(i, i + CHUNK);
          await tx.geoArea.createMany({ data: batch.filter((area) => area.type === "REGION"), skipDuplicates: true });
          await tx.geoArea.createMany({ data: batch.filter((area) => area.type !== "REGION"), skipDuplicates: true });
        }
        for (const fill of plan.areaFills) await tx.geoArea.update({ where: { id: fill.id }, data: fill.data });
        for (let i = 0; i < plan.localityCreates.length; i += CHUNK) await tx.geoLocality.createMany({ data: plan.localityCreates.slice(i, i + CHUNK), skipDuplicates: true });
        for (let i = 0; i < plan.aliasCreates.length; i += CHUNK) await tx.geoAlias.createMany({ data: plan.aliasCreates.slice(i, i + CHUNK), skipDuplicates: true });
        for (let i = 0; i < plan.linkCreates.length; i += CHUNK) await tx.geoLocalityArea.createMany({ data: plan.linkCreates.slice(i, i + CHUNK), skipDuplicates: true });
      }, { timeout: 300_000, maxWait: 30_000 });
      clearGeoCatalogCache();
    }
    // Held changes are recorded for both modes; only an APPLY run's are reviewable.
    for (let i = 0; i < plan.held.length; i += CHUNK) {
      await db.geoImportChange.createMany({
        data: plan.held.slice(i, i + CHUNK).map((change) => ({
          runId: run.id, action: change.action, status: options.apply ? change.status : "SKIPPED",
          entityType: change.entityType, entityId: change.entityId, payload: json(change.payload), reason: options.apply ? change.reason ?? null : `Dry run. ${change.reason ?? ""}`.trim(),
        })),
      });
    }
    await db.geoImportRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), summary: json({ counts, warnings: warnings.slice(0, 200) }) } });
  } catch (error) {
    await db.geoImportRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: error instanceof Error ? error.message.slice(0, 2000) : "Import failed." } });
    throw error;
  }
  return { runId: run.id, mode, sourceId: dataset.source.id, checksum, counts, warnings, held: plan.held };
}

async function planImport(dataset: GeoDataset, existingAreas: Array<Prisma.GeoAreaGetPayload<{ include: { aliases: true } }>>, warnings: string[]): Promise<Plan> {
  const plan: Plan = { areaCreates: [], areaFills: [], localityCreates: [], aliasCreates: [], linkCreates: [], held: [], warnings };
  const sourceId = dataset.source.id;
  const country = dataset.countryCode;
  const byId = new Map(existingAreas.map((area) => [area.id, area]));
  const byCode = new Map(existingAreas.filter((area) => area.code).map((area) => [`${area.type}:${area.code}`, area]));
  const bySourceRef = new Map(existingAreas.filter((area) => area.sourceId && area.sourceRecordRef).map((area) => [`${area.sourceId}:${area.sourceRecordRef}`, area]));
  /** Resolved id for every area code in this file (existing or about to be created). */
  const idForCode = new Map<string, string>();
  const seen = new Set<string>();
  const verificationFor = (status?: string) => (status ?? dataset.source.verificationStatus) as Prisma.GeoAreaCreateManyInput["verificationStatus"];

  const sorted = [...dataset.areas].sort((a, b) => (a.type === "REGION" ? 0 : 1) - (b.type === "REGION" ? 0 : 1));
  for (const area of sorted) {
    const parentId = area.parentCode ? idForCode.get(`REGION:${area.parentCode}`) ?? byCode.get(`REGION:${area.parentCode}`)?.id ?? null : null;
    let existing = byId.get(areaIdFor(country, area.type, area.code)) ?? byCode.get(`${area.type}:${area.code}`)
      ?? (area.sourceRecordRef ? bySourceRef.get(`${sourceId}:${area.sourceRecordRef}`) : undefined);
    if (!existing) {
      // Same name, level and parent but another code: possibly the same place re-coded. Never
      // merged automatically.
      const sameName = existingAreas.filter((row) => row.type === area.type && row.parentId === parentId && row.normalizedName === normalizeGeoName(area.name));
      if (sameName.length === 1) {
        existing = sameName[0];
        if (existing.code !== area.code) plan.held.push({ action: "RECODE", status: "PENDING_REVIEW", entityType: "area", entityId: existing.id, payload: { from: existing.code, to: area.code, name: area.name }, reason: "Same name and parent as an existing area with a different code." });
      }
    }
    if (!existing) {
      const id = areaIdFor(country, area.type, area.code);
      idForCode.set(`${area.type}:${area.code}`, id);
      plan.areaCreates.push({
        id, countryCode: country, type: area.type, assemblyKind: area.assemblyKind ?? null, name: area.name, normalizedName: normalizeGeoName(area.name), code: area.code, parentId,
        centroidLatitude: area.centroid?.latitude ?? null, centroidLongitude: area.centroid?.longitude ?? null,
        verificationStatus: verificationFor(area.verificationStatus), sourceId, sourceRecordRef: area.sourceRecordRef ?? null,
      });
      for (const alias of area.aliases) plan.aliasCreates.push({ areaId: id, alias: alias.alias, normalizedAlias: normalizeGeoName(alias.alias), kind: alias.kind, sourceId });
      continue;
    }
    seen.add(existing.id);
    idForCode.set(`${area.type}:${area.code}`, existing.id);
    const knownNames = new Set([existing.normalizedName, ...existing.aliases.map((alias) => alias.normalizedAlias)]);
    if (!knownNames.has(normalizeGeoName(area.name))) plan.held.push({ action: "RENAME", status: "PENDING_REVIEW", entityType: "area", entityId: existing.id, payload: { from: existing.name, to: area.name }, reason: "The source now uses a different name." });
    if ((existing.parentId ?? null) !== parentId) plan.held.push({ action: "REPARENT", status: "PENDING_REVIEW", entityType: "area", entityId: existing.id, payload: { from: existing.parentId, to: parentId }, reason: "The source places this area under a different parent." });
    if (!existing.active) plan.held.push({ action: "CREATE_AREA", status: "SKIPPED", entityType: "area", entityId: existing.id, payload: { name: area.name }, reason: "Listed by the source but deactivated here; reactivate it from the admin page if intended." });
    const fill: Prisma.GeoAreaUpdateInput = {};
    if (existing.centroidLatitude === null && area.centroid) Object.assign(fill, { centroidLatitude: area.centroid.latitude, centroidLongitude: area.centroid.longitude });
    if (existing.assemblyKind === null && area.assemblyKind) fill.assemblyKind = area.assemblyKind;
    if (Object.keys(fill).length) plan.areaFills.push({ id: existing.id, data: fill });
    for (const alias of area.aliases) {
      const normalized = normalizeGeoName(alias.alias);
      if (!knownNames.has(normalized)) { plan.aliasCreates.push({ areaId: existing.id, alias: alias.alias, normalizedAlias: normalized, kind: alias.kind, sourceId }); knownNames.add(normalized); }
    }
  }
  // Records this source created earlier but no longer lists: deactivation needs a reviewer.
  for (const area of existingAreas) {
    if (area.sourceId === sourceId && area.active && !seen.has(area.id) && dataset.areas.length) {
      plan.held.push({ action: "DEACTIVATE", status: "PENDING_REVIEW", entityType: "area", entityId: area.id, payload: { name: area.name, code: area.code }, reason: "No longer listed by the source." });
    }
  }

  if (dataset.localities.length) {
    const existingLocalities = await db.geoLocality.findMany({
      where: { countryCode: country },
      select: { id: true, name: true, normalizedName: true, active: true, sourceId: true, aliases: { select: { normalizedAlias: true } }, areaLinks: { select: { areaId: true } } },
    });
    const localityById = new Map(existingLocalities.map((row) => [row.id, row]));
    const areaIdOf = (type: string, code: string) => idForCode.get(`${type}:${code}`) ?? byCode.get(`${type}:${code}`)?.id ?? null;
    const seenLocalities = new Set<string>();
    for (const locality of dataset.localities) {
      const id = localityIdFor(country, sourceId, locality.ref);
      const existing = localityById.get(id);
      seenLocalities.add(id);
      if (!existing) {
        plan.localityCreates.push({
          id, countryCode: country, kind: locality.kind, name: locality.name, normalizedName: normalizeGeoName(locality.name),
          centroidLatitude: locality.centroid?.latitude ?? null, centroidLongitude: locality.centroid?.longitude ?? null, centroidSource: locality.centroid ? sourceId : null,
          verificationStatus: (locality.verificationStatus ?? dataset.source.verificationStatus) as Prisma.GeoLocalityCreateManyInput["verificationStatus"], sourceId, sourceRecordRef: locality.ref,
        });
      } else if (!new Set([existing.normalizedName, ...existing.aliases.map((alias) => alias.normalizedAlias)]).has(normalizeGeoName(locality.name))) {
        plan.held.push({ action: "RENAME", status: "PENDING_REVIEW", entityType: "locality", entityId: id, payload: { from: existing.name, to: locality.name }, reason: "The source now uses a different name." });
      }
      const knownAliases = new Set(existing ? [existing.normalizedName, ...existing.aliases.map((alias) => alias.normalizedAlias)] : [normalizeGeoName(locality.name)]);
      for (const alias of locality.aliases) {
        const normalized = normalizeGeoName(alias.alias);
        if (!knownAliases.has(normalized)) { plan.aliasCreates.push({ localityId: id, alias: alias.alias, normalizedAlias: normalized, kind: alias.kind, sourceId }); knownAliases.add(normalized); }
      }
      const linked = new Set(existing?.areaLinks.map((link) => link.areaId) ?? []);
      for (const link of locality.links) {
        const areaId = areaIdOf(link.areaType, link.areaCode);
        if (!areaId || linked.has(areaId)) continue;
        linked.add(areaId);
        plan.linkCreates.push({ localityId: id, areaId, relation: link.relation, verificationStatus: link.verificationStatus, sourceId, note: link.note ?? null });
      }
    }
    for (const row of existingLocalities) {
      if (row.sourceId === sourceId && row.active && !seenLocalities.has(row.id)) plan.held.push({ action: "DEACTIVATE", status: "PENDING_REVIEW", entityType: "locality", entityId: row.id, payload: { name: row.name }, reason: "No longer listed by the source." });
    }
  }
  return plan;
}
