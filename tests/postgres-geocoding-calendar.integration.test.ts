import http from "node:http";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/platform/database/client";
import { registerUser } from "@/modules/identity/service";
import { createOrganisation } from "@/modules/organisations/service";
import { createProperty } from "@/modules/assets/service";
import { createListing, getPublicListing, searchPublicListings, transitionListing, updateListingVerification } from "@/modules/listings/service";
import { applyPropertyLocationToListing, geocodeProperty } from "@/modules/geocoding/service";
import { geocodingProviders } from "@/modules/geocoding/provider";
import {
  cancelCalendarEvent,
  createCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "@/modules/calendar/service";
import { calendarProviders, type CalendarAdapter, type CalendarSyncResult } from "@/modules/calendar/provider";
import { jobHandlers } from "@/platform/jobs/handlers";
import { runDueJobs } from "@/platform/jobs/runner";

async function cleanDatabase() {
  await db.$executeRawUnsafe('TRUNCATE TABLE "User", "Organisation", "PropertyOwner" CASCADE');
}

class FlakyCalendarAdapter implements CalendarAdapter {
  readonly key = "FLAKY_CALENDAR";
  readonly displayName = "Flaky test calendar provider";
  shouldFail = true;

  isConfigured() {
    return true;
  }

  async createEvent(): Promise<CalendarSyncResult> {
    if (this.shouldFail) throw new Error("Simulated calendar provider outage.");
    return { providerEventId: "flaky-event-1" };
  }

  async updateEvent(): Promise<CalendarSyncResult> {
    if (this.shouldFail) throw new Error("Simulated calendar provider outage.");
    return { providerEventId: "flaky-event-1" };
  }

  async cancelEvent(): Promise<void> {
    if (this.shouldFail) throw new Error("Simulated calendar provider outage.");
  }
}

const flakyAdapter = new FlakyCalendarAdapter();
calendarProviders.register(flakyAdapter);

describe("PostgreSQL Phase 19 geocoding and calendar", () => {
  beforeEach(async () => {
    await cleanDatabase();
    delete process.env.GEOCODING_BASE_URL;
    flakyAdapter.shouldFail = true;
  });
  afterAll(async () => {
    await cleanDatabase();
    await db.$disconnect();
  });

  it("geocodes with a deterministic fallback, records status/history, and keeps public listing coordinates approximate", async () => {
    const owner = await registerUser({ displayName: "Geo Owner", email: "geo-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Geo Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const property = await createProperty(owner.id, organisation.id, {
      name: "Geo House", referenceNumber: "GEO-001", category: "Residential", countryCode: "GH", currencyCode: "GHS",
      city: "Accra", region: "Greater Accra", addressLine1: "12 Independence Avenue", units: [],
    });
    // Property creation never required geocoding — it starts unattempted.
    expect(property.geocodeStatus).toBe("NOT_ATTEMPTED");

    const { property: geocoded, result } = await geocodeProperty(owner.id, organisation.id, property.id);
    expect(result.status).toBe("OK");
    expect(geocoded.geocodeStatus).toBe("OK");
    expect(Number(geocoded.latitude)).toBeCloseTo(5.6037, 2);
    expect(Number(geocoded.longitude)).toBeCloseTo(-0.187, 2);
    const lookup = await db.geocodeLookup.findFirstOrThrow({ where: { propertyId: property.id } });
    expect(lookup.status).toBe("OK");
    expect((await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: "geocode.completed" } })).length).toBe(1);

    const unknownProperty = await createProperty(owner.id, organisation.id, {
      name: "Mystery House", referenceNumber: "GEO-002", category: "Residential", countryCode: "GH", currencyCode: "GHS",
      city: "Nowhereville-that-does-not-exist", units: [],
    });
    const unknownResult = await geocodeProperty(owner.id, organisation.id, unknownProperty.id);
    expect(unknownResult.result.status).toBe("NOT_FOUND");
    expect(unknownResult.property.latitude).toBeNull();
    expect(unknownResult.property.geocodeStatus).toBe("NOT_FOUND");

    // A real HTTP provider, when configured, takes priority over the deterministic fallback; provider errors are recorded as integration health.
    const server = http.createServer((_req, res) => { res.statusCode = 500; res.end("boom"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind geocoding test server.");
    process.env.GEOCODING_BASE_URL = `http://127.0.0.1:${address.port}`;
    try {
      const errorResult = await geocodeProperty(owner.id, organisation.id, property.id);
      expect(errorResult.result.status).toBe("ERROR");
      const integrationConfig = await db.integrationConfig.findUniqueOrThrow({ where: { organisationId_integrationType: { organisationId: organisation.id, integrationType: "GEOCODING" } } });
      // A failure right after an earlier success degrades gracefully rather than jumping straight to ERROR.
      expect(integrationConfig.status).toBe("DEGRADED");
      expect(integrationConfig.lastFailureReason).toBeTruthy();
      expect((await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: "integration.failed" } })).length).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
      delete process.env.GEOCODING_BASE_URL;
    }
    expect(geocodingProviders.get("http").isConfigured()).toBe(false);

    // Public listing projection is always an approximation, never the exact private property coordinate.
    const listing = await createListing(owner.id, organisation.id, {
      propertyId: property.id, listingType: "RENT", category: "apartment", title: "Geo listing",
      publicDescription: "A listing whose public map pin must never reveal the property's exact private coordinates.",
      rentAmountMinor: "300000", currencyCode: "GHS", frequency: "MONTHLY", availableFrom: "2026-09-01", countryCode: "GH", city: "Accra",
      media: [{ type: "PHOTO", publicUrl: "https://cdn.example.test/geo-listing.jpg", sortOrder: 0 }],
    });
    const withLocation = await applyPropertyLocationToListing(owner.id, organisation.id, listing.id);
    expect(withLocation.mapPrecision).toBe("CITY");
    expect(withLocation.mapLatitude!.toString()).not.toBe(geocoded.latitude!.toString());
    expect(withLocation.mapLongitude!.toString()).not.toBe(geocoded.longitude!.toString());

    await updateListingVerification(owner.id, organisation.id, listing.id, {
      status: "PENDING",
      evidence: [{ type: "OWNERSHIP_OR_AUTHORITY", privateReference: "private/evidence/geo-listing-deed.pdf" }],
    });
    await updateListingVerification(owner.id, organisation.id, listing.id, { status: "VERIFIED" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PENDING_REVIEW" });
    await transitionListing(owner.id, organisation.id, listing.id, { status: "PUBLISHED" });

    const { listing: publicListing } = await getPublicListing(listing.id);
    expect(publicListing.location.map.latitude).toBe(withLocation.mapLatitude!.toString());
    expect(publicListing.location.map.longitude).toBe(withLocation.mapLongitude!.toString());
    expect(publicListing.location.map.latitude).not.toBe(geocoded.latitude!.toString());
    expect(JSON.stringify(publicListing)).not.toContain("addressLine1");

    const searchResults = await searchPublicListings({ country: "GH", city: "Accra" });
    expect(searchResults.items.some((item) => item.id === listing.id)).toBe(true);
  });

  it("manages calendar CRUD with a deterministic internal default and retries/records external sync failures without blocking core scheduling", async () => {
    const owner = await registerUser({ displayName: "Calendar Owner", email: "calendar-owner@example.com", password: "secure-password-123" });
    const organisation = await createOrganisation(owner.id, { name: "Calendar Organisation", type: "PROPERTY_MANAGEMENT", countryCode: "GH" });

    const created = await createCalendarEvent(owner.id, organisation.id, {
      type: "VIEWING", sourceType: "STANDALONE", sourceId: randomUUID(),
      title: "Prospective tenant viewing", startAt: "2026-09-10T10:00:00Z", endAt: "2026-09-10T10:30:00Z",
      attendees: [{ name: "Prospective Tenant", email: "prospect@example.com" }],
    });
    expect(created.status).toBe("SCHEDULED");
    expect(created.providerKey).toBe("INTERNAL");
    expect(await db.backgroundJob.count({ where: { organisationId: organisation.id, type: "calendar-sync" } })).toBe(1);
    await runDueJobs(jobHandlers);
    expect((await db.calendarEvent.findUniqueOrThrow({ where: { id: created.id } })).syncStatus).toBe("SYNCED");

    const updated = await updateCalendarEvent(owner.id, organisation.id, created.id, { title: "Prospective tenant viewing (rescheduled)" });
    expect(updated.status).toBe("UPDATED");
    await runDueJobs(jobHandlers);
    expect((await db.calendarEvent.findUniqueOrThrow({ where: { id: created.id } })).syncStatus).toBe("SYNCED");

    await cancelCalendarEvent(owner.id, organisation.id, created.id);
    expect((await db.calendarEvent.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("CANCELLED");

    const events = await listCalendarEvents(owner.id, organisation.id, { type: "VIEWING" });
    expect(events.items.some((event) => event.id === created.id)).toBe(true);

    const eventNames = (await db.domainEvent.findMany({ where: { organisationId: organisation.id, name: { startsWith: "calendar.event_" } } })).map(({ name }) => name);
    expect(eventNames).toEqual(expect.arrayContaining(["calendar.event_created", "calendar.event_updated", "calendar.event_cancelled"]));

    // An external provider that is currently failing never blocks core scheduling — the CalendarEvent row is created immediately regardless — and the job runner's existing retry/error bookkeeping applies.
    const flaky = await createCalendarEvent(owner.id, organisation.id, {
      type: "MAINTENANCE_APPOINTMENT", sourceType: "STANDALONE", sourceId: randomUUID(),
      title: "Boiler repair visit", startAt: "2026-09-11T09:00:00Z", endAt: "2026-09-11T11:00:00Z", providerKey: "FLAKY_CALENDAR",
    });
    expect(flaky.status).toBe("SCHEDULED"); // core scheduling succeeded synchronously despite the provider being configured to fail
    await runDueJobs(jobHandlers);
    const afterFailedSync = await db.calendarEvent.findUniqueOrThrow({ where: { id: flaky.id } });
    expect(afterFailedSync.syncStatus).toBe("FAILED");
    expect(afterFailedSync.lastSyncError).toContain("Simulated calendar provider outage");
    const failedJob = await db.backgroundJob.findFirstOrThrow({ where: { organisationId: organisation.id, type: "calendar-sync", payload: { path: ["calendarEventId"], equals: flaky.id } } });
    expect(failedJob.status).toBe("FAILED");
    expect(failedJob.attempts).toBeGreaterThanOrEqual(1);
    const integrationConfig = await db.integrationConfig.findUniqueOrThrow({ where: { organisationId_integrationType: { organisationId: organisation.id, integrationType: "CALENDAR" } } });
    // A failure right after two earlier successful syncs degrades gracefully rather than jumping straight to ERROR.
    expect(integrationConfig.status).toBe("DEGRADED");

    // Once the provider recovers, retrying the job succeeds.
    flakyAdapter.shouldFail = false;
    await db.backgroundJob.update({ where: { id: failedJob.id }, data: { runAt: new Date(), status: "FAILED" } });
    await runDueJobs(jobHandlers);
    expect((await db.calendarEvent.findUniqueOrThrow({ where: { id: flaky.id } })).syncStatus).toBe("SYNCED");
  });
});
