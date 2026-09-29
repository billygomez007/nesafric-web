// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/components/marketing/campaign-tracking", () => ({ trackCampaignEvent: vi.fn() }));
vi.mock("@/platform/analytics", () => ({ trackEvent: vi.fn() }));

const { ServiceProviderOnboardingForm, providerOnboardingErrorMessage } = await import("@/components/service-provider-onboarding-form");

const PROVIDER_ID = "7d0f5f0e-2a39-4c55-9d7c-4a1d3cf0a001";
type Reply = { status: number; body: unknown };
type Call = { url: string; method: string; body: unknown };

let calls: Call[];
let routes: Record<string, Reply | (() => Reply)>;

function json(status: number, body: unknown) {
  return { status, body };
}

function savedProvider(overrides: { displayName: string; contactPhone?: string | null }) {
  return {
    id: PROVIDER_ID,
    type: "INDIVIDUAL",
    contactEmail: null,
    contactPhone: "0241234567",
    categories: [{ category: { id: "c1", name: "Plumbing" } }],
    serviceAreas: [{ id: "a1", name: "Accra, GH" }],
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  push.mockReset();
  // Production today: no document requirements are configured, so nothing is uploaded.
  routes = {
    "GET /api/providers/categories": json(200, [{ id: "c1", key: "plumbing", name: "Plumbing" }]),
    "POST /api/providers": json(201, savedProvider({ displayName: "Kofi Plumbing" })),
    [`PATCH /api/providers/${PROVIDER_ID}`]: () => {
      // Like the server: the update echoes what it saved (here with a server-side normalisation).
      const body = calls.at(-1)!.body as { displayName: string; contactPhone: string | null };
      return json(200, savedProvider({ displayName: `${body.displayName} (saved)`, contactPhone: body.contactPhone }));
    },
    [`PATCH /api/marketplace/providers/${PROVIDER_ID}/profile`]: json(200, {}),
    "GET /api/public/providers/document-requirements": json(200, []),
    [`POST /api/providers/${PROVIDER_ID}/verification/consent`]: json(201, { id: "consent" }),
    [`POST /api/providers/${PROVIDER_ID}/verification`]: json(400, { error: { code: "VALIDATION_ERROR", message: "The request contains invalid input." } }),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(input).split("?")[0];
    calls.push({ url: path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${path}`];
    const reply = typeof route === "function" ? route() : route ?? json(404, {});
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = (path: string) => calls.filter((call) => call.method === "POST" && call.url === path);

async function fillToServiceAreas() {
  render(<ServiceProviderOnboardingForm />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByPlaceholderText("e.g. Kofi Mensah Electrical"), { target: { value: "Kofi Plumbing" } });
  fireEvent.change(screen.getByLabelText(/Contact phone/), { target: { value: "0241234567" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByLabelText("Plumbing"));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByPlaceholderText("City"), { target: { value: "Accra" } });
}

async function continueTo(label: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await screen.findByText(label);
}

async function acceptConsent() {
  for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
}

describe("service provider onboarding → workspace", () => {
  it("with no documents to upload, finishing opens the new provider workspace instead of failing verification", async () => {
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    await screen.findByText("Mandatory identity verification");
    expect(posts("/api/providers")).toHaveLength(1);

    await continueTo("Business & credential documents");
    await continueTo("Portfolio");
    await continueTo("Review & consent");
    await acceptConsent();
    await continueTo("Submit for verification");
    expect(screen.getByTestId("provider-no-evidence-note")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Finish and open workspace" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/providers/${PROVIDER_ID}`));
    // The empty-evidence submit that used to 400 is never sent.
    expect(posts(`/api/providers/${PROVIDER_ID}/verification`)).toHaveLength(0);
    expect(posts(`/api/providers/${PROVIDER_ID}/verification/consent`)).toHaveLength(1);
  });

  it("a double click creates one provider, and Back then Continue reuses it", async () => {
    await fillToServiceAreas();
    const create = screen.getByRole("button", { name: "Create profile & continue" });
    fireEvent.click(create);
    fireEvent.click(create);
    await screen.findByText("Mandatory identity verification");
    expect(posts("/api/providers")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & continue" }));
    await screen.findByText("Mandatory identity verification");
    expect(posts("/api/providers")).toHaveLength(1);
  });

  it("edits made after going Back are saved to the existing provider, and the review shows what was saved", async () => {
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    await screen.findByText("Mandatory identity verification");

    // Back to business information, change the name and phone.
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Kofi Mensah Electrical"), { target: { value: "Kofi Plumbing & Sons" } });
    fireEvent.change(screen.getByLabelText(/Contact phone/), { target: { value: "0209999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & continue" }));
    await screen.findByText("Mandatory identity verification");

    // One provider; the edit went through the owner-checked update route.
    expect(posts("/api/providers")).toHaveLength(1);
    const patches = calls.filter((call) => call.method === "PATCH" && call.url === `/api/providers/${PROVIDER_ID}`);
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ displayName: "Kofi Plumbing & Sons", contactPhone: "0209999999", categoryIds: ["c1"], serviceAreas: [{ areaType: "SERVICE_AREA", name: "Accra, GH" }], legalName: null, contactEmail: null });

    await continueTo("Business & credential documents");
    await continueTo("Portfolio");
    await continueTo("Review & consent");
    const review = screen.getByTestId("provider-review-saved");
    // The server's saved value, not the form's local text.
    expect(review.textContent).toContain("Kofi Plumbing & Sons (saved)");
    expect(review.textContent).toContain("0209999999");
    expect(review.textContent).toContain("Plumbing");
  });

  it("locks the account type once the profile exists", async () => {
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    await screen.findByText("Mandatory identity verification");
    for (let i = 0; i < 4; i += 1) fireEvent.click(await screen.findByRole("button", { name: "← Back" }));
    expect(await screen.findByTestId("provider-type-locked")).toBeTruthy();
    const company = screen.getByRole("button", { name: /Company \/ business/ }) as HTMLButtonElement;
    expect(company.disabled).toBe(true);
    fireEvent.click(company);
    expect((screen.getByRole("button", { name: /Individual \/ artisan/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  });

  it("a failed save keeps the person on the step, says why and keeps the workspace reachable", async () => {
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    await screen.findByText("Mandatory identity verification");
    routes[`PATCH /api/providers/${PROVIDER_ID}`] = json(403, { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your profile is saved as it was");
    expect(screen.queryByText("Mandatory identity verification")).toBeNull();
    expect(posts("/api/providers")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("provider-open-workspace"));
    expect(push).toHaveBeenCalledWith(`/providers/${PROVIDER_ID}`);
  });

  it("an account that already owns a provider is offered its workspace, not a dead end", async () => {
    routes["POST /api/providers"] = json(409, { error: { code: "PROVIDER_IDENTITY_EXISTS", message: "This user or company already has a provider identity.", details: { providerId: PROVIDER_ID } } });
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You already have a service provider profile.");
    // Continuing again never overwrites that earlier profile with this form, nor creates another.
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Open your workspace to edit it."));
    expect(calls.some((call) => call.method === "PATCH" && call.url === `/api/providers/${PROVIDER_ID}`)).toBe(false);
    expect(posts("/api/providers")).toHaveLength(1);
    expect(screen.queryByText("Mandatory identity verification")).toBeNull();
    fireEvent.click(screen.getByTestId("provider-open-workspace"));
    expect(push).toHaveBeenCalledWith(`/providers/${PROVIDER_ID}`);
  });

  it("a failure after the profile exists names the problem and keeps the workspace reachable", async () => {
    routes[`POST /api/providers/${PROVIDER_ID}/verification/consent`] = json(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
    await fillToServiceAreas();
    fireEvent.click(screen.getByRole("button", { name: "Create profile & continue" }));
    await screen.findByText("Mandatory identity verification");
    await continueTo("Business & credential documents");
    await continueTo("Portfolio");
    await continueTo("Review & consent");
    await acceptConsent();
    await continueTo("Submit for verification");
    fireEvent.click(screen.getByRole("button", { name: "Finish and open workspace" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your session expired. Sign in again to continue.");
    expect(alert.textContent).toContain("Your profile is saved");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("provider-open-workspace"));
    expect(push).toHaveBeenCalledWith(`/providers/${PROVIDER_ID}`);
  });
});

describe("providerOnboardingErrorMessage", () => {
  it("names known failures instead of a generic message", () => {
    expect(providerOnboardingErrorMessage(401, {}, "x")).toBe("Your session expired. Sign in again to continue.");
    expect(providerOnboardingErrorMessage(409, { code: "CONTACT_NOT_READY" }, "x")).toMatch(/contact email or phone/);
    expect(providerOnboardingErrorMessage(409, { code: "INVALID_VERIFICATION_STATE" }, "x")).toMatch(/already been submitted/);
    expect(providerOnboardingErrorMessage(400, { code: "VALIDATION_ERROR", message: "The request contains invalid input." }, "Specific fallback")).toBe("Specific fallback");
  });
});
