import { Prisma } from "@/platform/database/generated/client";
import { db } from "@/platform/database/client";
import { resolveLocation, type ResolvedLocation } from "./resolve";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const BATCH = 200;

type Counts = { scanned: number; resolved: number; partial: number; ambiguous: number; unresolved: number; skippedExisting: number; skippedNoText: number; skippedCountry: number };
const emptyCounts = (): Counts => ({ scanned: 0, resolved: 0, partial: 0, ambiguous: 0, unresolved: 0, skippedExisting: 0, skippedNoText: 0, skippedCountry: 0 });

export type BackfillReport = {
  mode: "DRY_RUN" | "APPLY";
  listings: Counts;
  properties: Counts;
  providerCoverage: Counts;
  professionalCoverage: Counts;
  /** Up to 50 examples of records left for review (ids and the text that did not resolve). */
  flagged: Array<{ kind: string; id: string; text: string; status: string; candidates?: string[] }>;
};

const tally = (counts: Counts, status: ResolvedLocation["status"]) => {
  if (status === "RESOLVED") counts.resolved += 1;
  else if (status === "PARTIAL") counts.partial += 1;
  else if (status === "AMBIGUOUS") counts.ambiguous += 1;
  else counts.unresolved += 1;
};

const textOf = (values: Record<string, string | null | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim()).map(([key, value]) => [key, value!.trim().slice(0, 150)])) as Record<string, string>;

/**
 * Links existing records to reference areas from their free text. Idempotent and conservative:
 *  - only records with no structured location (or coverage) yet are touched, so a location a
 *    person confirmed, or an earlier backfill, is never rewritten;
 *  - a single exact match is saved; several matches are saved as AMBIGUOUS with candidates, and
 *    no match as UNRESOLVED, both for review, with the original text kept. Nothing defaults to an
 *    area, and coverage is never assumed nationwide;
 *  - the listing text, status, review and publication are not changed. Listing locations are
 *    written with "nesafric.geo_backfill" set, so the listing revision (which reviews and WhatsApp
 *    confirmations are checked against) does not change.
 * Dry run (the default) only reports.
 */
export async function backfillGeography(options: { apply?: boolean; countryCode?: string } = {}): Promise<BackfillReport> {
  const apply = Boolean(options.apply);
  const countryCode = options.countryCode ?? "GH";
  const report: BackfillReport = { mode: apply ? "APPLY" : "DRY_RUN", listings: emptyCounts(), properties: emptyCounts(), providerCoverage: emptyCounts(), professionalCoverage: emptyCounts(), flagged: [] };
  const flag = (kind: string, id: string, text: Record<string, string>, result: ResolvedLocation) => {
    if (report.flagged.length < 50 && result.status !== "RESOLVED" && result.status !== "PARTIAL") report.flagged.push({ kind, id, text: Object.values(text).join(", "), status: result.status, candidates: result.candidates.map((candidate) => candidate.label) });
  };

  // Listings and properties: one structured location each, purpose-specific.
  for (const kind of ["listing", "property"] as const) {
    const counts = kind === "listing" ? report.listings : report.properties;
    let cursor: string | undefined;
    for (;;) {
      const rows = kind === "listing"
        ? await db.listing.findMany({ where: { countryCode }, select: { id: true, region: true, district: true, city: true, locality: true, geoLocation: { select: { id: true } } }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
        // A property's street address is private and never used for matching.
        : await db.property.findMany({ where: { countryCode }, select: { id: true, region: true, district: true, city: true, geoLocation: { select: { id: true } } }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      for (const row of rows) {
        counts.scanned += 1;
        if (row.geoLocation) { counts.skippedExisting += 1; continue; }
        const text = textOf({ region: row.region, district: row.district, city: row.city, locality: "locality" in row ? (row.locality as string | null) : null });
        if (!Object.keys(text).length) { counts.skippedNoText += 1; continue; }
        const result = await resolveLocation({ countryCode, text });
        if (result.issues.includes("COUNTRY_NOT_CONFIGURED")) { counts.skippedCountry += 1; continue; }
        tally(counts, result.status);
        flag(kind, row.id, text, result);
        if (!apply) continue;
        await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('nesafric.geo_backfill', 'on', true)`;
          // Re-checked under the transaction: a location saved meanwhile is never overwritten.
          const exists = await tx.geoLocation.findFirst({ where: kind === "listing" ? { listingId: row.id } : { propertyId: row.id }, select: { id: true } });
          if (exists) return;
          await tx.geoLocation.create({
            data: {
              purpose: kind === "listing" ? "LISTING" : "PROPERTY",
              ...(kind === "listing" ? { listingId: row.id } : { propertyId: row.id }),
              countryCode,
              regionId: result.region?.id ?? null, districtId: result.district?.id ?? null, localityId: result.locality?.id ?? null,
              originalText: json(text),
              resolutionStatus: result.status === "RESOLVED" || result.status === "PARTIAL" ? result.status : result.status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED",
              resolutionSource: "BACKFILL",
              resolutionNote: result.issues.length ? result.issues.join(",") : null,
              candidates: result.candidates.length ? json(result.candidates) : Prisma.DbNull,
            },
          });
        });
      }
    }
  }

  // Provider coverage from the existing free-text service areas (both legacy tables).
  const providers = await db.serviceProvider.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      serviceAreas: { select: { areaType: true, name: true, reference: true } },
      marketplaceProfile: { select: { serviceAreas: { select: { countryCode: true, region: true, city: true, district: true, label: true } } } },
      _count: { select: { geoCoverage: true } },
    },
  });
  for (const provider of providers) {
    const texts = [
      ...(provider.marketplaceProfile?.serviceAreas ?? []).filter((area) => area.countryCode === countryCode).map((area) => textOf({ region: area.region, district: area.district, city: area.city ?? area.label })),
      ...provider.serviceAreas.map((area) => textOf({ region: area.reference, city: area.name })),
    ];
    await backfillCoverage(report.providerCoverage, "provider", provider.id, provider._count.geoCoverage > 0, texts, { serviceProviderId: provider.id });
  }
  const professionals = await db.marketplaceProfessional.findMany({ where: { archivedAt: null, countryCode }, select: { id: true, serviceAreas: true, _count: { select: { geoCoverage: true } } } });
  for (const professional of professionals) {
    await backfillCoverage(report.professionalCoverage, "professional", professional.id, professional._count.geoCoverage > 0, professional.serviceAreas.map((area) => textOf({ freeText: area })), { marketplaceProfessionalId: professional.id });
  }
  return report;

  async function backfillCoverage(counts: Counts, kind: string, id: string, hasCoverage: boolean, texts: Array<Record<string, string>>, holder: { serviceProviderId: string } | { marketplaceProfessionalId: string }) {
    if (hasCoverage) { counts.skippedExisting += texts.length || 1; return; }
    const items: Prisma.GeoCoverageAreaCreateManyInput[] = [];
    const seen = new Set<string>();
    for (const text of texts) {
      counts.scanned += 1;
      // A region-only (or empty) legacy row meant "this region" or "anywhere": only the first is
      // recorded, and "anywhere" is never turned into nationwide coverage.
      if (!Object.keys(text).length) { counts.skippedNoText += 1; continue; }
      const result = await resolveLocation({ countryCode, text });
      tally(counts, result.status);
      flag(`${kind}-coverage`, id, text, result);
      // Coverage is only as wide as what was written: a town that did not resolve is never
      // widened to its region.
      const specific = Boolean(text.city || text.locality || text.freeText);
      const target = result.candidates.length ? null
        : result.locality && result.district ? { localityId: result.locality.id }
          : result.locality ? null
            : result.district ? { areaId: result.district.id }
              : result.region && !specific ? { areaId: result.region.id } : null;
      if (!target && report.flagged.length < 50 && (result.status === "RESOLVED" || result.status === "PARTIAL")) report.flagged.push({ kind: `${kind}-coverage`, id, text: Object.values(text).join(", "), status: "NOT_SPECIFIC_ENOUGH" });
      if (!target) continue;
      const key = JSON.stringify(target);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...holder, countryCode, ...target, source: "BACKFILL", originalText: Object.values(text).join(", ").slice(0, 300) });
    }
    if (apply && items.length) {
      await db.$transaction(async (tx) => {
        if (await tx.geoCoverageArea.count({ where: holder }) > 0) return;
        await tx.geoCoverageArea.createMany({ data: items, skipDuplicates: true });
      });
    }
  }
}
