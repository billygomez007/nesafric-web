// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const PRO = "11111111-1111-4111-8111-111111111111";
const pathname = `/pro/${PRO}/profile`;
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

type Profile = Record<string, unknown> & { logoUrl: string | null; myRole: string };

function profile(overrides: Record<string, unknown> = {}): Profile {
  return {
    id: PRO, slug: "canal-pc", type: "REAL_ESTATE_COMPANY", countryCode: "GH", status: "ACTIVE", verificationStatus: "VERIFIED",
    displayName: "Canal PC", legalName: "Canal PC Ltd", logoUrl: null, description: "We sell homes.", websiteUrl: null,
    contactEmail: "hello@canal.example", contactPhone: null, specialities: ["Sales"], servicesOffered: [], serviceAreas: ["Accra"],
    myRole: "OWNER", ...overrides,
  };
}

function mockApi(initial: ReturnType<typeof profile>) {
  let current = { ...initial };
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => structuredClone(body) }) as Response;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== "GET") calls.push({ method, url, body });
    if (url === `/api/marketplace-professionals/${PRO}/logo`) {
      current = { ...current, logoUrl: method === "DELETE" ? null : "/api/public/media/public/marketplace-professionals/branding/logo.png" };
      return json({ id: PRO, logoUrl: current.logoUrl });
    }
    if (url === `/api/marketplace-professionals/${PRO}`) {
      if (method === "PATCH") current = { ...current, ...body };
      const { myRole: _role, ...rest } = current;
      return json(method === "PATCH" ? rest : current);
    }
    return json({});
  }));
  return calls;
}

const { MarketplaceBusinessProfile } = await import("@/components/marketplace-business-profile");
const { MarketplaceProShell } = await import("@/components/marketplace-pro-shell");

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("business profile & branding", () => {
  it("is reachable from the professional workspace navigation as Business Profile", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    render(<MarketplaceProShell professionalId={PRO}><p>content</p></MarketplaceProShell>);
    const link = screen.getAllByRole("link", { name: "Business Profile" })[0];
    expect(link.getAttribute("href")).toBe(`/pro/${PRO}/profile`);
    expect(link.className).toContain("bg-teal/20");
  });

  it("saves only the changed fields and confirms", async () => {
    const calls = mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    const description = await screen.findByLabelText("Description");
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(description, { target: { value: "We sell and let homes in Accra." } });
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "canal.example" } });
    expect(screen.getByText("You have unsaved changes.")).toBeTruthy();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText("Business profile saved.")).toBeTruthy());
    expect(calls).toEqual([{ method: "PATCH", url: `/api/marketplace-professionals/${PRO}`, body: { description: "We sell and let homes in Accra.", websiteUrl: "https://canal.example" } }]);
  });

  it("validates before saving and Cancel restores the saved values", async () => {
    const calls = mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    const name = await screen.findByLabelText("Business name");
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter the business name.")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(calls).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Business name") as HTMLInputElement).value).toBe("Canal PC");
  });

  it("clearing an optional field sends null and editing a list sends the list", async () => {
    const calls = mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    fireEvent.change(await screen.findByLabelText("Legal business name (optional)"), { target: { value: "" } });
    const areas = screen.getByLabelText("Service areas");
    fireEvent.change(areas, { target: { value: "Kumasi" } });
    fireEvent.keyDown(areas, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ legalName: null, specialities: [], serviceAreas: ["Accra", "Kumasi"] });
  });

  it("prompts for a logo, uploads it, previews it, and can remove it", async () => {
    const calls = mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    expect(await screen.findByText("Add your company logo")).toBeTruthy();

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Canal PC logo file"), { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "Canal PC logo" });
    expect(preview.getAttribute("src")).toContain("/marketplace-professionals/branding/");
    expect(calls[0]).toMatchObject({ method: "POST", url: `/api/marketplace-professionals/${PRO}/logo`, body: { fileName: "logo.png", contentType: "image/png", dataBase64: "iVBORw==" } });
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Canal PC logo" })).toBeNull());
    expect(calls[1]).toEqual({ method: "DELETE", url: `/api/marketplace-professionals/${PRO}/logo`, body: undefined });
  });

  it("rejects a non-image logo before uploading", async () => {
    const calls = mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    const input = await screen.findByLabelText("Canal PC logo file");
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "logo.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Choose a PNG, JPG, WebP or GIF image.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("is read-only for an AGENT", async () => {
    mockApi(profile({ myRole: "AGENT", logoUrl: "/logo.png" }));
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    expect(await screen.findByText(/Only owners and admins of Canal PC can change it/)).toBeTruthy();
    expect((screen.getByLabelText("Business name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Replace logo|Upload logo/ })).toBeNull();
  });

  it("links to the public profile and keeps type and country read-only", async () => {
    mockApi(profile());
    render(<MarketplaceBusinessProfile professionalId={PRO} />);
    const link = await screen.findByRole("link", { name: /View public profile/ });
    expect(link.getAttribute("href")).toBe("/marketplace/professionals/canal-pc");
    const identity = screen.getByRole("heading", { name: "Business identity" }).closest("section")!;
    expect(within(identity).getByText("Real estate company")).toBeTruthy();
    expect(within(identity).queryByRole("combobox")).toBeNull();
  });
});
