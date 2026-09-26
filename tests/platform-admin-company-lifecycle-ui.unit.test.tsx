// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

let pathname = "/platform-admin/homepage-media";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

type Company = {
  id: string; displayName: string; slug: string; logoUrl: string | null; type: string;
  status: string; verificationStatus: string; archivedAt: string | null; legalName: null;
};

const company = (id: string, displayName: string, overrides: Partial<Company> = {}): Company => ({
  id, displayName, slug: displayName.toLowerCase().replace(/\W+/g, "-"), logoUrl: null, type: "REAL_ESTATE_COMPANY",
  status: "ACTIVE", verificationStatus: "UNVERIFIED", archivedAt: null, legalName: null, ...overrides,
});

type Rail = { id: string; marketplaceProfessionalId: string; isPublished: boolean; sortOrder: number; marketplaceProfessional: Company };

/** A tiny in-memory stand-in for the platform-admin API. Mutations change the state that the
 * next GET returns, exactly like the real endpoints. */
function mockApi(initial: { companies: Company[]; items?: Rail[]; role?: string }) {
  const state = { companies: initial.companies, items: initial.items ?? [] };
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  // Clone like a real network response would, so state mutations never leak into rendered data.
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 422, json: async () => structuredClone(body) }) as Response;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") calls.push({ method, url, body });
    if (url.endsWith("/whoami")) return json({ isPlatformPrincipal: true, role: initial.role ?? "SUPER_ADMIN" });
    if (url.endsWith("/pending-count")) return json({ count: 0 });
    const verification = url.match(/professionals\/([^/]+)\/verification$/);
    if (verification) {
      const target = state.companies.find((entry) => entry.id === verification[1])!;
      target.verificationStatus = body.status;
      return json(target);
    }
    if (url.endsWith("/api/platform-admin/homepage-media") && method === "POST") {
      const target = state.companies.find((entry) => entry.id === body.marketplaceProfessionalId)!;
      state.items.push({ id: `item-${target.id}`, marketplaceProfessionalId: target.id, isPublished: true, sortOrder: state.items.length, marketplaceProfessional: target });
      return json(state.items.at(-1));
    }
    if (url.endsWith("/api/platform-admin/homepage-media")) {
      return json({
        items: state.items,
        candidates: state.companies.map((entry) => ({ ...entry, homepageCompanyLogos: state.items.filter((item) => item.marketplaceProfessionalId === entry.id) })),
        permissions: { canVerify: true, canManageHomepage: true },
      });
    }
    if (url.includes("/api/platform-admin/professionals?")) {
      return json(state.companies.map((entry) => ({
        ...entry, contactEmail: null, contactPhone: null, countryCode: "GH", specialities: [], servicesOffered: [], serviceAreas: [],
        createdAt: "2026-09-01T00:00:00.000Z", subscription: null, members: [], homepageCompanyLogos: [],
        _count: { members: 1, listings: 0, developments: 0, campaigns: 0, aiemployees: 0 },
      })));
    }
    return json({});
  }));
  return calls;
}

const { default: HomepageMediaPage } = await import("@/app/platform-admin/homepage-media/page");
const { default: ProfessionalsPage } = await import("@/app/platform-admin/professionals/page");

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); pathname = "/platform-admin/homepage-media"; });

describe("Homepage Media inside the Platform Admin shell", () => {
  it("renders the sidebar and header with Homepage Media active", async () => {
    mockApi({ companies: [] });
    render(<HomepageMediaPage />);
    // The shell renders the menu twice: collapsed for small screens and as the desktop sidebar.
    const navs = await screen.findAllByRole("navigation", { name: "Platform operations" });
    expect(navs).toHaveLength(2);
    const nav = navs[1];
    expect(within(nav).getByRole("link", { name: "Real Estate Professionals" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Campaigns" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Homepage Media" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Homepage Media" })).toBeTruthy();
  });

  it("says when no verified companies exist and points to verification", async () => {
    mockApi({ companies: [company("c1", "Canal PC")] });
    render(<HomepageMediaPage />);
    expect(await screen.findByText("No verified companies are available yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Verify a company" }).getAttribute("href")).toBe("/platform-admin/professionals");
  });

  it("says when verified companies exist but none are on the rail", async () => {
    mockApi({ companies: [company("c1", "Verified Co", { verificationStatus: "VERIFIED" })] });
    render(<HomepageMediaPage />);
    expect(await screen.findByText("Verified companies are available but none have been added to the homepage.")).toBeTruthy();
  });

  it("shows only the actions each company's state allows", async () => {
    mockApi({
      companies: [
        company("c1", "Unverified Co"),
        company("c2", "Verified Co", { verificationStatus: "VERIFIED" }),
        company("c3", "Suspended Co", { verificationStatus: "VERIFIED", status: "SUSPENDED" }),
        company("c4", "Archived Co", { verificationStatus: "VERIFIED", status: "ARCHIVED", archivedAt: "2026-09-01T00:00:00.000Z" }),
      ],
    });
    render(<HomepageMediaPage />);
    const table = await screen.findByRole("table");
    const row = (name: string) => within(table).getByText(name).closest("tr")!;
    const buttons = (name: string) => within(row(name)).queryAllByRole("button").map((button) => button.textContent);

    expect(buttons("Unverified Co")).toEqual(["Verify", "Reject", "Suspend account"]);
    expect(buttons("Verified Co")).toEqual(["Add to homepage", "Suspend verification", "Suspend account"]);
    expect(buttons("Suspended Co")).toEqual(["Reactivate account", "Suspend verification"]);
    expect(buttons("Archived Co")).toEqual([]);
    expect(within(row("Archived Co")).getByText("Archived profiles are read-only.")).toBeTruthy();
  });

  it("verifies an unverified company from Add company logo, then adds it without reloading the page", async () => {
    const calls = mockApi({ companies: [company("c1", "Canal PC")] });
    render(<HomepageMediaPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add company logo" }))[0]);

    const dialog = await screen.findByRole("dialog", { name: "Add company logo" });
    expect(within(dialog).getByText("Unverified")).toBeTruthy();
    expect(within(dialog).getByText(/No logo uploaded/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Add to homepage" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Verify company" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm verify" }));

    const add = await within(dialog).findByRole("button", { name: "Add to homepage" });
    expect(calls[0]).toEqual({ method: "PATCH", url: "/api/platform-admin/professionals/c1/verification", body: { status: "VERIFIED", expectedStatus: "UNVERIFIED" } });

    fireEvent.click(add);
    await waitFor(() => expect(calls[1]).toEqual({ method: "POST", url: "/api/platform-admin/homepage-media", body: { marketplaceProfessionalId: "c1", isPublished: true } }));
    await waitFor(() => expect(within(dialog).getByText("Every eligible company is already in the homepage rail.")).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    const rail = screen.getByRole("heading", { name: "Homepage company rail" }).closest("section")!;
    expect(within(rail).getByText("Canal PC")).toBeTruthy();
    expect(within(rail).getByRole("button", { name: "Unpublish" })).toBeTruthy();
  });

  it("requires a reason before rejecting", async () => {
    const calls = mockApi({ companies: [company("c1", "Canal PC")] });
    render(<HomepageMediaPage />);
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject: Canal PC" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("Real Estate Professionals actions column", () => {
  it("shows Verify, Reject, Suspend account and View on an UNVERIFIED active company", async () => {
    pathname = "/platform-admin/professionals";
    mockApi({ companies: [company("c1", "Canal PC")] });
    render(<ProfessionalsPage />);
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("button", { name: "Canal PC" }).closest("tr")!;
    expect(within(row).getAllByRole("button").map((button) => button.textContent)).toEqual(["Canal PC", "Verify", "Reject", "Suspend account", "View"]);
    expect(within(row).getByText("Active")).toBeTruthy();
    expect(within(row).getByText("Unverified")).toBeTruthy();
  });
});
