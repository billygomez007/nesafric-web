// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProviderDetail } from "@/components/provider-detail";

vi.mock("next/navigation", () => ({ usePathname: () => "/providers/p", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const PROVIDER = "5c9e0a11-0000-4000-8000-000000000001";
const FIRST = "/api/public/media/public/providers/kwame/first.png";
const SECOND = "/api/public/media/public/providers/kwame/second.png";

type Server = {
  logoUrl: string | null;
  viewerIsOwner?: boolean;
  upload?: () => { status: number; body: unknown };
  remove?: () => { status: number; body: unknown };
  hold?: Promise<void>;
};

function mockServer(server: Server) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => structuredClone(body) }) as Response;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === `/api/providers/${PROVIDER}/logo`) {
      if (server.hold) await server.hold;
      if (method === "POST") {
        const answer = server.upload?.() ?? { status: 201, body: { id: PROVIDER, displayName: "Kwame Plumbing Services", logoUrl: server.logoUrl ? SECOND : FIRST } };
        if (answer.status < 300) server.logoUrl = (answer.body as { logoUrl: string }).logoUrl;
        return reply(answer.status, answer.body);
      }
      const answer = server.remove?.() ?? { status: 200, body: { id: PROVIDER, logo: null } };
      if (answer.status < 300) server.logoUrl = null;
      return reply(answer.status, answer.body);
    }
    if (url === `/api/providers/${PROVIDER}`) {
      return reply(200, {
        provider: {
          id: PROVIDER, type: "COMPANY", displayName: "Kwame Plumbing Services", legalName: null, contactEmail: null, contactPhone: null, biography: null,
          verificationStatus: "VERIFIED", availabilityStatus: "AVAILABLE", acceptingWork: true, identityVerifiedAt: "2026-09-01T00:00:00Z", businessVerifiedAt: null,
          skillVerifiedAt: null, categories: [], serviceAreas: [], evidence: [], verificationHistory: [],
        },
        directory: null,
        metrics: { assignments: 0, accepted: 0, declined: 0, completed: 0, acceptanceRate: null, onTimeRate: null, ratings: 0, averageRating: null, averageQuality: null, averageTimeliness: null, averageCommunication: null },
        logo: server.logoUrl ? { url: server.logoUrl } : null,
        viewerIsOwner: server.viewerIsOwner ?? true,
      });
    }
    if (url === `/api/providers/${PROVIDER}/jobs`) return reply(200, []);
    return reply(404, { error: { code: "NOT_FOUND", message: "Not found" } });
  }));
  return calls;
}

const png = (bytes = 4, type = "image/png", name = "logo.png") => new File([new Uint8Array(bytes)], name, { type });
const choose = (file: File) => fireEvent.change(screen.getByLabelText("Kwame Plumbing Services logo file"), { target: { files: [file] } });
const logoPosts = (calls: { method: string; url: string }[]) => calls.filter((call) => call.url.endsWith("/logo") && call.method !== "GET");

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("provider logo management", () => {
  it("shows the current logo with an accessible name", async () => {
    mockServer({ logoUrl: FIRST });
    render(<ProviderDetail providerId={PROVIDER} />);
    const logo = await screen.findByRole("img", { name: "Kwame Plumbing Services logo" });
    expect(logo.getAttribute("src")).toBe(FIRST);
    expect(logo.className).toContain("object-contain");
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Logo" })).toBeTruthy();
  });

  it("shows initials and no Remove when there is no logo", async () => {
    mockServer({ logoUrl: null });
    render(<ProviderDetail providerId={PROVIDER} />);
    expect(await screen.findByText("Add your logo")).toBeTruthy();
    expect(screen.getByText("KP")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /logo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
    expect(screen.getByLabelText("Kwame Plumbing Services logo file").getAttribute("accept")).toBe("image/jpeg,image/png,image/webp,image/gif");
  });

  it("uploads a valid image, shows progress, and shows the new logo only after the server confirms", async () => {
    let release!: () => void;
    const server: Server = { logoUrl: null, hold: new Promise((resolve) => { release = resolve; }) };
    const calls = mockServer(server);
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByText("Add your logo");
    choose(png());
    const busy = await screen.findByRole("button", { name: "Uploading…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("img", { name: "Kwame Plumbing Services logo" })).toBeNull();
    expect(screen.queryByText("Logo uploaded.")).toBeNull();
    release();
    const logo = await screen.findByRole("img", { name: "Kwame Plumbing Services logo" });
    expect(logo.getAttribute("src")).toBe(FIRST);
    expect(screen.getByText("Logo uploaded.")).toBeTruthy();
    const [post] = logoPosts(calls);
    expect(post).toMatchObject({ method: "POST", url: `/api/providers/${PROVIDER}/logo`, body: { fileName: "logo.png", contentType: "image/png", dataBase64: "AAAAAA==" } });
    // The page reloads from the API after the change.
    await waitFor(() => expect(calls.filter((call) => call.url === `/api/providers/${PROVIDER}` && call.method === "GET").length).toBeGreaterThanOrEqual(2));
  });

  it("rejects an oversized file before any request", async () => {
    const calls = mockServer({ logoUrl: null });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByText("Add your logo");
    choose(png(2 * 1024 * 1024 + 1));
    expect((await screen.findByRole("alert")).textContent).toBe("The logo must be 2 MB or smaller.");
    expect(logoPosts(calls)).toEqual([]);
  });

  it("rejects an unsupported type before any request", async () => {
    const calls = mockServer({ logoUrl: null });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByText("Add your logo");
    choose(png(4, "image/svg+xml", "logo.svg"));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a PNG, JPG, WebP or GIF image.");
    expect(logoPosts(calls)).toEqual([]);
  });

  it("shows the server's rejection and keeps the current state", async () => {
    mockServer({ logoUrl: null, upload: () => ({ status: 422, body: { error: { code: "UNSUPPORTED_FILE_TYPE", message: "The file's contents are not a supported, recognisable file type." } } }) });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByText("Add your logo");
    choose(png());
    expect((await screen.findByRole("alert")).textContent).toBe("The file's contents are not a supported, recognisable file type.");
    expect(screen.queryByText("Logo uploaded.")).toBeNull();
    expect(screen.getByText("KP")).toBeTruthy();
  });

  it("replaces an existing logo through the same endpoint", async () => {
    const calls = mockServer({ logoUrl: FIRST });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByRole("img", { name: "Kwame Plumbing Services logo" });
    choose(png(8));
    await screen.findByText("Logo replaced.");
    expect(screen.getByRole("img", { name: "Kwame Plumbing Services logo" }).getAttribute("src")).toBe(SECOND);
    // Only the upload: the server archives the old object, the page never deletes it itself.
    expect(logoPosts(calls).map((call) => call.method)).toEqual(["POST"]);
  });

  it("asks before removing, then returns to initials", async () => {
    const calls = mockServer({ logoUrl: FIRST });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByRole("img", { name: "Kwame Plumbing Services logo" });
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(screen.getByText("Remove this logo?")).toBeTruthy();
    expect(logoPosts(calls)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Keep logo" }));
    expect(screen.getByRole("img", { name: "Kwame Plumbing Services logo" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Logo removed.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Kwame Plumbing Services logo" })).toBeNull();
    expect(screen.getByText("KP")).toBeTruthy();
    expect(logoPosts(calls).map((call) => call.method)).toEqual(["DELETE"]);
  });

  it("keeps the logo when removal fails", async () => {
    mockServer({ logoUrl: FIRST, remove: () => ({ status: 403, body: { error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } } }) });
    render(<ProviderDetail providerId={PROVIDER} />);
    await screen.findByRole("img", { name: "Kwame Plumbing Services logo" });
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You do not have permission to perform this action.");
    expect(screen.getByRole("img", { name: "Kwame Plumbing Services logo" }).getAttribute("src")).toBe(FIRST);
    expect(screen.queryByText("Logo removed.")).toBeNull();
  });

  it("shows no logo controls to someone who doesn't own the provider", async () => {
    mockServer({ logoUrl: FIRST, viewerIsOwner: false });
    render(<ProviderDetail providerId={PROVIDER} />);
    const heading = await screen.findByRole("heading", { name: "Kwame Plumbing Services" });
    expect(within(heading.closest("section")!).queryByRole("button", { name: /logo/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Logo" })).toBeNull();
    expect(screen.queryByLabelText("Kwame Plumbing Services logo file")).toBeNull();
  });
});
