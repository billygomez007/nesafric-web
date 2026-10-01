/// <reference types="node" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { renderRouter } from "expo-router/testing-library";
import path from "path";

import type { Workspaces } from "@/api/account";
import { listingPayload, toMinorUnits, type ListingDraft } from "@/api/workspace-actions";
import { setActiveToken } from "@/auth/token-store";
import { formatListingPrice } from "@/marketplace/format";
import { PRICE_UNIT_LABELS, priceUnitsFor, priceUnitSuffix } from "@/marketplace/price-units";
import { listing } from "@/test-utils/fixtures";
import { setWorkspaceIntent } from "@/workspace/intent";
import { resetWorkspaceNavigator } from "@/workspace/navigator";
import { decodedSize, toPhotoUploads } from "@/workspace/photos";
import { validateListingDraft } from "@/workspace/screens/listing-editor";

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));

const APP_DIR = path.join(__dirname, "../app");
const TOKEN = "tok_A1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv";
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const ORG = { id: "0b8f6a52-5b0c-4a1e-9c1c-000000000001", name: "Golden Coast Properties" };
const FOREIGN_ORG = "0b8f6a52-5b0c-4a1e-9c1c-0000000000ff";
const PRO = { id: "7a1f0c2e-0000-4000-8000-000000000001", displayName: "Xcel Realty", type: "BROKERAGE", status: "ACTIVE", verificationStatus: "VERIFIED", slug: "xcel-realty", myRole: "AGENT" };
const FOREIGN_PRO = "7a1f0c2e-0000-4000-8000-0000000000ff";
const WORKSPACES: Workspaces = { propertyOsOrganisations: [ORG], marketplaceProfessionals: [PRO], serviceProviders: [] };

const LISTING_ID = "9d0c3b7a-0000-4000-8000-000000000001";
const OTHER_PROS_LISTING = "9d0c3b7a-0000-4000-8000-0000000000ff";
const PROPERTY_ID = "6e2d1c4b-0000-4000-8000-000000000001";
const UNIT_ID = "6e2d1c4b-0000-4000-8000-0000000000a2";
const TENANT_ID = "4c3b2a19-0000-4000-8000-000000000001";

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[];

function json(status: number, body?: unknown) {
  return Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
}
const forbidden = () => json(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });

function rawListing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID, status: "DRAFT", verificationStatus: "UNVERIFIED", listingType: "SALE", category: "LAND", title: "Serviced plot in Oyarifa",
    publicDescription: "A serviced residential plot close to the main road.", askingAmountMinor: "120000", rentAmountMinor: null, currencyCode: "GHS",
    frequency: "PER_SQM", availableFrom: "2026-10-01T00:00:00.000Z", bedrooms: null, bathrooms: null, sizeSqm: null, landSizeSqm: "750", furnishing: null,
    negotiable: false, region: "Greater Accra", city: "Accra", district: null, locality: "Oyarifa", listingAuthority: "OWNER_SELF",
    amenities: [], media: [{ id: "m1", type: "PHOTO", publicUrl: "https://cdn.test/plot.jpg", isCover: true }], statusHistory: [],
    ...overrides,
  };
}

type Server = { deny?: string[]; listingStatus?: string };

/**
 * The server: professional routes answer only for the listed professional, and a listing only for
 * the professional it belongs to (404 otherwise); organisation routes only for the listed
 * organisation (403 otherwise); `deny` refuses paths with 403 (the role lacks the permission).
 */
function mockServer(server: Server = {}) {
  calls = [];
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, headers, body });
    const authed = Boolean(headers.authorization);
    if (server.deny?.includes(`${method} ${url.pathname}`)) return forbidden();

    const pro = url.pathname.match(/^\/api\/marketplace-professionals\/([^/]+)(\/.*)?$/);
    if (pro) {
      if (!authed || pro[1] !== PRO.id) return forbidden();
      const rest = pro[2] ?? "";
      if (rest === "/listings" && method === "GET") return json(200, { items: [{ ...rawListing(), status: server.listingStatus ?? "DRAFT" }], total: 1 });
      if (rest === "/listings" && method === "POST") return json(201, rawListing({ media: [], title: body.listing.title }));
      const one = rest.match(/^\/listings\/([^/]+)(\/.*)?$/);
      if (one && one[1] !== LISTING_ID) return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
      if (one && !one[2] && method === "GET") return json(200, rawListing({ status: server.listingStatus ?? "DRAFT" }));
      if (one?.[2] === "/details" && method === "PUT") return json(200, rawListing({ title: body.listing.title }));
      if (one?.[2] === "/media" && method === "POST") return json(201, { attached: { id: "m2" } });
      if (one?.[2] === "/submit" && method === "POST") return json(200, rawListing({ status: "PENDING_REVIEW" }));
      if (rest === "/dashboard") return json(200, { listings: { active: 0, draft: 1, pendingReview: 0, paused: 0, total: 1 }, newLeads: 0, upcomingViewings: 0, teamMembers: 1, profileCompletenessPercent: 50, verificationStatus: "VERIFIED" });
      return json(200, { items: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } });
    }

    const orgAllowed = authed && headers["x-organisation-id"] === ORG.id;
    if (/^\/api\/(properties|tenants|leases)/.test(url.pathname) && !orgAllowed) return forbidden();
    switch (`${method} ${url.pathname}`) {
      case "GET /api/workspaces":
        return authed ? json(200, WORKSPACES) : json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
      case "GET /api/account/profile":
        return json(200, { id: "u1", displayName: "Ama Mensah", email: "ama@example.com", emailVerified: true, createdAt: "2026-09-01T00:00:00.000Z" });
      case "GET /api/account/tenancies":
        return json(200, { tenancies: [] });
      case "GET /api/properties":
        if (url.searchParams.get("id") === PROPERTY_ID) {
          return json(200, { id: PROPERTY_ID, name: "Ocean View Apartments", referenceNumber: "OVA-1", category: "Residential", status: "ACTIVE", city: "Accra", addressLine1: null, description: null, buildings: [], units: [{ id: UNIT_ID, name: "A2", unitType: "2-bed flat", floor: "1", bedrooms: 2, bathrooms: 1, status: "AVAILABLE" }], leases: [] });
        }
        return json(200, [{ id: PROPERTY_ID, name: "Ocean View Apartments", referenceNumber: "OVA-1", category: "Residential", status: "ACTIVE", city: "Accra", _count: { units: 1 } }]);
      case "POST /api/properties":
        return json(201, { id: PROPERTY_ID });
      case "PATCH /api/properties":
        return json(200, { id: PROPERTY_ID });
      case `POST /api/properties/${PROPERTY_ID}/units`:
        return json(201, { id: "new-unit" });
      case `PATCH /api/properties/${PROPERTY_ID}/units/${UNIT_ID}`:
        return json(200, { id: UNIT_ID });
      case "GET /api/tenants":
        return json(200, [{ id: TENANT_ID, createdAt: "2026-08-01T00:00:00.000Z", tenant: { legalName: "Kwame Boateng", preferredName: null } }]);
      case "POST /api/tenants":
        return json(201, { tenant: { id: "t-root" }, relationship: { id: TENANT_ID } });
      case `POST /api/tenants/${TENANT_ID}/access-invitations`:
        return json(201, {
          invitation: {
            id: "invite-1",
            status: "active",
            createdAt: "2026-10-01T00:00:00.000Z",
            expiresAt: "2026-10-08T00:00:00.000Z",
          },
          delivery: {
            email: "QUEUED",
            sms: "SKIPPED",
          },
        });
      case `GET /api/tenants/${TENANT_ID}`:
        return json(200, { id: TENANT_ID, email: "kwame@example.com", phone: null, tenant: { legalName: "Kwame Boateng", preferredName: null }, leaseParties: [] });
      case `PATCH /api/tenants/${TENANT_ID}`:
        return json(200, { id: TENANT_ID });
      case "POST /api/leases":
        return json(201, { id: "lease-1" });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    }
  }) as jest.Mock;
}

function signedIn() {
  secureStore.set("nesafric.session.v1", JSON.stringify({ token: TOKEN, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { id: "u1", email: "ama@example.com", displayName: "Ama Mensah" } }));
}

const writes = () => calls.filter((call) => call.method !== "GET");
const writesTo = (method: string, pathname: string) => calls.filter((call) => call.method === method && call.url.pathname === pathname);

beforeEach(async () => {
  secureStore.clear();
  await AsyncStorage.clear();
  setActiveToken(null);
  setWorkspaceIntent(null);
  resetWorkspaceNavigator();
  jest.clearAllMocks();
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockReset();
});

const photoAsset = (name: string, base64 = "/9j/4AAQSkZJRgABAQ==") => ({ uri: `file:///${name}`, fileName: name, mimeType: "image/jpeg", base64, width: 1200, height: 800, assetId: name, type: "image" as const });

describe("real estate professional: native listings", () => {
  it("opens Add listing from the Listings tab without leaving the app", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listings` });
    fireEvent.press(await screen.findByTestId("add-listing"));
    expect(await screen.findByTestId("listing-editor")).toBeTruthy();
    expect(screen.getByTestId("listing-save")).toBeTruthy();
  });

  it("creates a sale listing priced per m², uploads the picked photo and opens the saved draft", async () => {
    mockServer();
    signedIn();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [photoAsset("plot.jpg")] } as never);
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/new` });

    fireEvent.press(await screen.findByText("For sale"));
    fireEvent.press(screen.getByText("Land"));
    fireEvent.changeText(screen.getByTestId("listing-title"), "Serviced plot in Oyarifa");
    fireEvent.changeText(screen.getByTestId("listing-description"), "A serviced residential plot close to the main road.");
    fireEvent.changeText(screen.getByTestId("listing-price"), "1,200");
    fireEvent.press(screen.getByText("Per square metre (m²)"));
    fireEvent.press(screen.getByTestId("listing-region"));
    fireEvent.press(await screen.findByText("Greater Accra"));

    fireEvent.press(screen.getByTestId("listing-district"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Search district / municipality"),
      "Ayawaso West",
    );
    fireEvent.press(await screen.findByText("Ayawaso West"));

    fireEvent.press(screen.getByTestId("listing-locality"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Search location / area"),
      "East Legon",
    );
    fireEvent.press(await screen.findByText("East Legon"));

    await act(async () => fireEvent.press(screen.getByTestId("listing-add-photos")));
    expect(await screen.findByText("Uploads on save")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("listing-save")));

    await waitFor(() => expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings`)).toHaveLength(1));
    const [create] = writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings`);
    expect(create.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(create.body).toMatchObject({
      asset: {
        purpose: "SALE",
        category: "LAND",
        priceMinor: "120000",
        currencyCode: "GHS",
        countryCode: "GH",
        region: "Greater Accra",
        district: "Ayawaso West",
        locality: "East Legon",
      },
      listing: { listingType: "SALE", askingAmountMinor: "120000", rentAmountMinor: null, frequency: "PER_SQM", title: "Serviced plot in Oyarifa" },
      listingAuthority: "OWNER_SELF",
    });
    await waitFor(() => expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/media`)).toHaveLength(1));
    const [upload] = writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/media`);
    expect(upload.body).toEqual({ fileName: "plot.jpg", contentType: "image/jpeg", dataBase64: "/9j/4AAQSkZJRgABAQ==", mediaType: "PHOTO" });
    // The saved draft reopens in the editor, with its photo and a Submit for review action.
    expect(await screen.findByTestId("listing-photo-m1")).toBeTruthy();
    expect(screen.getByTestId("listing-submit")).toBeTruthy();
  });

  it("uploads photos straight to an existing draft", async () => {
    mockServer();
    signedIn();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [photoAsset("a.jpg"), photoAsset("b.jpg")] } as never);
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/${LISTING_ID}` });
    const add = await screen.findByTestId("listing-add-photos", {}, { timeout: 3000 });
    await act(async () => fireEvent.press(add));
    await waitFor(() => expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/media`)).toHaveLength(2));
    expect(jest.mocked(ImagePicker.launchImageLibraryAsync)).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ["images"], base64: true, selectionLimit: 11 }));
  });

  it("edits a draft in place and submits it for review with evidence", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/${LISTING_ID}` });
    const title = await screen.findByTestId("listing-title");
    expect(title.props.value).toBe("Serviced plot in Oyarifa");
    fireEvent.changeText(title, "Serviced plot, Oyarifa (750 m²)");
    await act(async () => fireEvent.press(screen.getByTestId("listing-save")));
    await waitFor(() => expect(writesTo("PUT", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/details`)).toHaveLength(1));
    const [edit] = writesTo("PUT", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/details`);
    expect(edit.body).toMatchObject({ listing: { title: "Serviced plot, Oyarifa (750 m²)", frequency: "PER_SQM", askingAmountMinor: "120000", landSizeSqm: 750 } });
    expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings`)).toHaveLength(0);
    expect(await screen.findByText("Changes saved.")).toBeTruthy();

    fireEvent.press(screen.getByText("Owner mandate"));
    fireEvent.changeText(screen.getByTestId("listing-evidence-reference"), "MANDATE-2026-114");
    await act(async () => fireEvent.press(screen.getByTestId("listing-submit")));
    await waitFor(() => expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/submit`)).toHaveLength(1));
    expect(writesTo("POST", `/api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/submit`)[0].body).toEqual({ evidence: { type: "owner_mandate", reference: "MANDATE-2026-114" } });
  });

  it("locks editing while a listing is in review", async () => {
    mockServer({ listingStatus: "PENDING_REVIEW" });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/${LISTING_ID}` });
    expect(await screen.findByText(/This listing is in review/)).toBeTruthy();
    expect(screen.queryByTestId("listing-save")).toBeNull();
    expect(screen.queryByTestId("listing-add-photos")).toBeNull();
  });

  it("cannot open or modify another professional's workspace or listing", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${FOREIGN_PRO}/listing/new` });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(calls.some((call) => call.url.pathname.includes(FOREIGN_PRO))).toBe(false);
  });

  it("shows the server's refusal for a listing that belongs to someone else, and sends no edit", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/${OTHER_PROS_LISTING}` });
    expect(await screen.findByText("This listing isn’t available")).toBeTruthy();
    expect(screen.queryByTestId("listing-save")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("shows a role refusal from the server instead of pretending the save worked", async () => {
    mockServer({ deny: [`PUT /api/marketplace-professionals/${PRO.id}/listings/${LISTING_ID}/details`] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/agent/${PRO.id}/listing/${LISTING_ID}` });
    await screen.findByTestId("listing-title");
    await act(async () => fireEvent.press(screen.getByTestId("listing-save")));
    expect(await screen.findByText(/Your role in this workspace doesn’t allow this/)).toBeTruthy();
    expect(screen.queryByText("Changes saved.")).toBeNull();
  });
});

describe("landlord / property manager: native portfolio", () => {
  it("adds a property in this workspace and opens it", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/properties` });
    fireEvent.press(await screen.findByTestId("add-property"));
    fireEvent.changeText(await screen.findByTestId("property-name"), "Palm Court");
    fireEvent.changeText(screen.getByTestId("property-reference"), "PC-1");
    fireEvent.press(screen.getByText("Commercial"));
    fireEvent.changeText(screen.getByTestId("property-city"), "Tema");
    await act(async () => fireEvent.press(screen.getByTestId("property-save")));
    await waitFor(() => expect(writesTo("POST", "/api/properties")).toHaveLength(1));
    const [create] = writesTo("POST", "/api/properties");
    expect(create.headers["x-organisation-id"]).toBe(ORG.id);
    expect(create.body).toEqual({ name: "Palm Court", referenceNumber: "PC-1", category: "Commercial", countryCode: "GH", currencyCode: "GHS", city: "Tema" });
    expect(await screen.findByTestId("property-detail")).toBeTruthy();
  });

  it("adds and edits units of a property", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/property/${PROPERTY_ID}` });
    fireEvent.press(await screen.findByTestId("unit-add"));
    fireEvent.changeText(await screen.findByTestId("unit-name"), "B1");
    await act(async () => fireEvent.press(screen.getByTestId("unit-save")));
    await waitFor(() => expect(writesTo("POST", `/api/properties/${PROPERTY_ID}/units`)).toHaveLength(1));
    expect(writesTo("POST", `/api/properties/${PROPERTY_ID}/units`)[0].body).toMatchObject({ name: "B1", status: "AVAILABLE" });

    fireEvent.press(await screen.findByTestId(`unit-${UNIT_ID}`));
    const name = await screen.findByTestId("unit-name");
    expect(name.props.value).toBe("A2");
    fireEvent.press(screen.getByText("Occupied"));
    await act(async () => fireEvent.press(screen.getByTestId("unit-save")));
    await waitFor(() => expect(writesTo("PATCH", `/api/properties/${PROPERTY_ID}/units/${UNIT_ID}`)).toHaveLength(1));
    const [edit] = writesTo("PATCH", `/api/properties/${PROPERTY_ID}/units/${UNIT_ID}`);
    expect(edit.headers["x-organisation-id"]).toBe(ORG.id);
    expect(edit.body).toMatchObject({ name: "A2", status: "OCCUPIED", bedrooms: 2 });
  });

  it("adds a tenant and places them in the chosen property and unit of this workspace", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/tenants` });
    fireEvent.press(await screen.findByTestId("add-tenant"));
    fireEvent.changeText(await screen.findByTestId("tenant-legal-name"), "Efua Mensah");
    fireEvent.changeText(screen.getByTestId("tenant-email"), "efua@example.com");
    fireEvent.press(screen.getByTestId("tenant-place"));
    fireEvent.press(await screen.findByText("Ocean View Apartments"));
    fireEvent.press(await screen.findByText("A2"));
    fireEvent.changeText(screen.getByTestId("placement-rent"), "2500");
    await act(async () => fireEvent.press(screen.getByTestId("tenant-save")));

    await waitFor(() => expect(writesTo("POST", "/api/leases")).toHaveLength(1));
    const [tenant] = writesTo("POST", "/api/tenants");
    expect(tenant.headers["x-organisation-id"]).toBe(ORG.id);
    expect(tenant.body).toEqual({ legalName: "Efua Mensah", email: "efua@example.com" });
    const [lease] = writesTo("POST", "/api/leases");
    expect(lease.headers["x-organisation-id"]).toBe(ORG.id);
    expect(lease.body).toMatchObject({ propertyId: PROPERTY_ID, unitId: UNIT_ID, tenantOrganisationIds: [TENANT_ID], rentAmountMinor: "250000", currencyCode: "GHS", rentFrequency: "MONTHLY", status: "DRAFT" });
    expect(await screen.findByTestId("tenant-detail")).toBeTruthy();
  });

  it("edits a tenant's details", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/tenants` });
    fireEvent.press(await screen.findByTestId(`tenant-${TENANT_ID}`));
    const name = await screen.findByTestId("tenant-legal-name");
    expect(name.props.value).toBe("Kwame Boateng");
    fireEvent.changeText(name, "Kwame A. Boateng");
    await act(async () => fireEvent.press(screen.getByTestId("tenant-save")));
    await waitFor(() => expect(writesTo("PATCH", `/api/tenants/${TENANT_ID}`)).toHaveLength(1));
    expect(writesTo("PATCH", `/api/tenants/${TENANT_ID}`)[0].body).toMatchObject({ legalName: "Kwame A. Boateng", email: "kwame@example.com" });
  });

  it("an unauthorised role cannot create a property or tenant — the server's refusal is shown", async () => {
    mockServer({ deny: ["POST /api/properties", "POST /api/tenants"] });
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${ORG.id}/property/new` });
    fireEvent.changeText(await screen.findByTestId("property-name"), "Palm Court");
    fireEvent.changeText(screen.getByTestId("property-reference"), "PC-1");
    await act(async () => fireEvent.press(screen.getByTestId("property-save")));
    expect(await screen.findByText(/Your role in this workspace doesn’t allow this/)).toBeTruthy();
    expect(screen.queryByTestId("property-detail")).toBeNull();
  });

  it("never sends property or tenant writes for a workspace the user isn't a member of", async () => {
    mockServer();
    signedIn();
    renderRouter(APP_DIR, { initialUrl: `/workspace/${FOREIGN_ORG}/tenant/new` });
    expect(await screen.findByText("Workspace not available")).toBeTruthy();
    expect(screen.queryByTestId("tenant-save")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe("price units", () => {
  const priced = (listingType: "RENT" | "SALE", frequency: string | null, amount = "120000") =>
    formatListingPrice(listing({ listingType, pricing: { askingAmountMinor: listingType === "SALE" ? amount : null, rentAmountMinor: listingType === "RENT" ? amount : null, currencyCode: "GHS", frequency: frequency as never } }));

  it("formats per day, month, year, square metre and kilometre", () => {
    expect(priced("RENT", "DAILY", "35000")).toBe("GH₵350/day");
    expect(priced("RENT", "MONTHLY", "850000")).toBe("GH₵8,500/month");
    expect(priced("RENT", "ANNUAL", "9000000")).toBe("GH₵90,000/year");
    expect(priced("SALE", "PER_SQM")).toBe("GH₵1,200/m²");
    expect(priced("RENT", "PER_SQM")).toBe("GH₵1,200/m²");
    expect(priced("SALE", "PER_KM", "500000000")).toBe("GH₵5,000,000/km");
    expect(priced("SALE", null, "85000000")).toBe("GH₵850,000");
    // A rent period never shows on a sale, and unknown values show no unit.
    expect(priceUnitSuffix("SALE", "MONTHLY")).toBe("");
    expect(priceUnitSuffix("RENT", "WEEKLY")).toBe("");
  });

  it("offers every unit for rentals and only per-quantity units for sales, with customer-facing labels", () => {
    expect(priceUnitsFor("RENT").map((unit) => PRICE_UNIT_LABELS[unit])).toEqual(["Per day", "Per month", "Per quarter", "Per year", "Per square metre (m²)", "Per kilometre (km)", "Custom terms"]);
    expect(priceUnitsFor("SALE")).toEqual(["PER_SQM", "PER_KM"]);
  });

  it("sends the chosen unit as the listing's price unit, separate from the area", () => {
    const draft: ListingDraft = {
      listingType: "RENT", category: "WAREHOUSE", title: "Warehouse bay", description: "Covered warehouse bay with loading dock access.", price: "45", priceUnit: "PER_SQM",
      availableFrom: "2026-10-01", bedrooms: "", bathrooms: "", sizeSqm: "750", landSizeSqm: "", furnishing: "", negotiable: true, region: "", city: "Tema", district: "", locality: "", amenities: ["CCTV"], listingAuthority: "PROPERTY_MANAGER",
    };
    const payload = listingPayload(draft);
    expect(payload.listing).toMatchObject({ frequency: "PER_SQM", rentAmountMinor: "4500", sizeSqm: 750, bedrooms: null, amenities: [{ key: "cctv", label: "CCTV" }] });
    expect(payload.asset).toMatchObject({ purpose: "RENT", priceMinor: "4500", sizeSqm: 750 });
    expect(listingPayload({ ...draft, listingType: "SALE", priceUnit: "" }).listing.frequency).toBeNull();
    expect(listingPayload({ ...draft, priceUnit: "DAILY" }).listing.frequency).toBe("DAILY");
  });

  it("converts typed prices to minor units and validates the draft before sending", () => {
    expect(toMinorUnits("1,200")).toBe("120000");
    expect(toMinorUnits("1200.5")).toBe("120050");
    expect(toMinorUnits("0.05")).toBe("5");
    expect(toMinorUnits("12.345")).toBeNull();
    expect(toMinorUnits("abc")).toBeNull();
    const errors = validateListingDraft({ listingType: "RENT", category: "HOUSE", title: "Hi", description: "short", price: "", priceUnit: "", availableFrom: "2026-13-01", bedrooms: "", bathrooms: "", sizeSqm: "", landSizeSqm: "", furnishing: "", negotiable: false, region: "", city: "", district: "", locality: "", amenities: [], listingAuthority: "OWNER_SELF" });
    expect(Object.keys(errors).sort()).toEqual(["availableFrom", "description", "price", "priceUnit", "title"]);
  });
});

describe("listing photos", () => {
  it("accepts JPEG/PNG/WebP under 3 MB and names each rejected photo", () => {
    const big = "A".repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3) + 8);
    const picked = toPhotoUploads([photoAsset("ok.jpg") as never, { ...photoAsset("huge.jpg", big) } as never, { ...photoAsset("clip.gif"), mimeType: "image/gif" } as never, { ...photoAsset("empty.jpg"), base64: null } as never]);
    expect(picked.photos.map((photo) => photo.fileName)).toEqual(["ok.jpg"]);
    expect(picked.rejected).toEqual(["huge.jpg is larger than 3 MB.", "clip.gif isn't a JPEG, PNG or WebP photo.", "empty.jpg couldn't be read."]);
    expect(decodedSize("AAAA")).toBe(3);
    expect(decodedSize("AA==")).toBe(1);
  });
});
