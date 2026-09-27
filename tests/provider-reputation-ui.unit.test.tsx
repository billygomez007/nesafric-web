// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProviderDetail } from "@/components/provider-detail";
import { CANCELLATION_REASON_OPTIONS, MaintenanceDetail } from "@/components/maintenance-detail";
import { CANCELLATION_REASONS } from "@/modules/providers/reputation";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const PROVIDER = "5c9e0a11-0000-4000-8000-000000000001";
const REQUEST = "7a000000-0000-4000-8000-000000000001";
const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => structuredClone(body) }) as Response;

function mockProvider(metrics: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/providers/${PROVIDER}`) {
      return reply(200, {
        provider: {
          id: PROVIDER, type: "INDIVIDUAL", displayName: "Kwame Plumbing", legalName: null, contactEmail: null, contactPhone: null, biography: null,
          verificationStatus: "VERIFIED", availabilityStatus: "AVAILABLE", acceptingWork: true, identityVerifiedAt: null, businessVerifiedAt: null,
          skillVerifiedAt: null, categories: [], serviceAreas: [], evidence: [], verificationHistory: [],
        },
        metrics: { assignments: 12, accepted: 9, declined: 3, completed: 4, acceptanceRate: 0.75, onTimeRate: null, ratings: 0, averageRating: null, averageQuality: null, averageTimeliness: null, averageCommunication: null, ...metrics },
        logo: null,
        viewerIsOwner: false,
      });
    }
    if (url.endsWith("/jobs")) return reply(200, []);
    return reply(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }));
}

const completionCard = async () => (await screen.findByText("Completion rate")).parentElement!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("provider dashboard completion rate", () => {
  it("shows the server's rate, not completed ÷ assigned", async () => {
    // 4 completed of 12 assigned would be 33% if computed in the browser.
    mockProvider({ reputation: { completedJobs: 4, concludedJobs: 5, completionRate: 0.8 } });
    render(<ProviderDetail providerId={PROVIDER} />);
    expect(within(await completionCard()).getByText("80%")).toBeTruthy();
    expect(screen.queryByText("33%")).toBeNull();
  });

  it("shows a neutral state — not 0% or 100% — when the server has too little history", async () => {
    mockProvider({ completed: 1, assignments: 1, reputation: { completedJobs: 1, concludedJobs: 1, completionRate: null } });
    render(<ProviderDetail providerId={PROVIDER} />);
    const card = within(await completionCard());
    expect(card.getByText("Not enough completed history")).toBeTruthy();
    expect(card.queryByText(/%/)).toBeNull();
  });
});

describe("maintenance cancellation", () => {
  function mockMaintenance(status = "ASSIGNED") {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") calls.push({ url, method, body: JSON.parse(String(init?.body)) });
      if (url === `/api/maintenance/requests/${REQUEST}`) {
        return reply(200, {
          id: REQUEST, title: "Burst pipe", description: "Kitchen", category: "plumbing", priority: "HIGH", status, createdAt: "2026-09-01T00:00:00Z", completedAt: null, closedAt: null,
          property: { id: "p1", name: "Ocean View", referenceNumber: "OV-1", currencyCode: "GHS" }, unit: null, tenantOrganisation: null, reportedBy: { displayName: "Ama" },
          attachments: [], history: [], approvals: [], workOrders: [],
        });
      }
      if (url.includes("/transition")) return reply(200, {});
      return reply(200, []);
    }));
    return calls;
  }

  it("asks for a reason and sends only the reason — responsibility is decided by the server", async () => {
    localStorage.setItem("propertyos.activeOrganisationId", "org-1");
    const calls = mockMaintenance();
    render(<MaintenanceDetail requestId={REQUEST} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel request…" }));
    const form = screen.getByRole("form", { name: "Cancel maintenance request" });
    const reason = within(form).getByLabelText("Reason") as HTMLSelectElement;
    expect(reason.required).toBe(true);
    fireEvent.change(reason, { target: { value: "PROVIDER_FAILED_TO_ATTEND" } });
    fireEvent.change(within(form).getByLabelText("Cancellation note (optional)"), { target: { value: "Nobody came." } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirm cancellation" }));
    expect(await screen.findByText("Maintenance request cancelled.")).toBeTruthy();
    expect(calls).toEqual([{ url: `/api/maintenance/requests/${REQUEST}/transition`, method: "PATCH", body: { status: "CANCELLED", cancellationReason: "PROVIDER_FAILED_TO_ATTEND", note: "Nobody came." } }]);
  });

  it("can be backed out of without cancelling", async () => {
    localStorage.setItem("propertyos.activeOrganisationId", "org-1");
    const calls = mockMaintenance();
    render(<MaintenanceDetail requestId={REQUEST} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel request…" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep request" }));
    expect(screen.getByRole("button", { name: "Cancel request…" })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("isn't offered once the work is finished", async () => {
    localStorage.setItem("propertyos.activeOrganisationId", "org-1");
    mockMaintenance("COMPLETED");
    render(<MaintenanceDetail requestId={REQUEST} />);
    await screen.findByRole("button", { name: "Close request" });
    expect(screen.queryByRole("button", { name: "Cancel request…" })).toBeNull();
  });

  it("lists every reason the API accepts, and no internal-only choice", () => {
    expect(CANCELLATION_REASON_OPTIONS.map(({ value }) => value).sort()).toEqual([...CANCELLATION_REASONS].sort());
  });
});
