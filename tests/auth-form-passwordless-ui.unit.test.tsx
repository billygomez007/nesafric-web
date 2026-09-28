// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/platform/analytics", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/platform/analytics")>()), trackEvent: vi.fn() }));

import { AuthForm } from "@/components/auth-form";

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;
const CHALLENGE = { challengeId: "5b0f7f6e-2d3c-4a4b-9a55-000000000001", channel: "sms", destination: "+233 24 *** 4567", expiresAt: "2026-09-28T10:00:00.000Z", resendAfterSeconds: 60 };
const bodies = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) }));

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("web passwordless sign-in", () => {
  it("offers Google, Phone and Email — and never a password field", () => {
    const { container } = render(<AuthForm mode="login" />);
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/api/auth/google/start");
    expect(screen.getByRole("button", { name: "Phone" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Email" })).toBeTruthy();
    expect(container.querySelector("input[type=password]")).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("phone: sends a code, then verifies it with a one-time-code field and signs in", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(CHALLENGE))
      .mockResolvedValueOnce(json({ id: "u1", created: false, workspaces: { propertyOsOrganisations: [], marketplaceProfessionals: [{ id: "pro-1" }] } }));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    const phone = screen.getByLabelText("Mobile number");
    expect(phone.getAttribute("inputmode")).toBe("tel");
    await user.type(phone, "024 123 4567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    const code = await screen.findByLabelText("6-digit code");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(document.activeElement).toBe(code);
    expect(screen.getByText(/We sent a 6-digit code to \+233 24 \*\*\* 4567/)).toBeTruthy();
    expect(screen.getByText(/Resend in \d+s/)).toBeTruthy();
    // Pasting a formatted code keeps just the digits.
    await user.type(code, "12-34 56");
    expect((code as HTMLInputElement).value).toBe("123456");
    await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pro/pro-1"));
    expect(bodies()).toEqual([
      { url: "/api/auth/otp/request", body: { mode: "login", channel: "sms", identifier: "024 123 4567" } },
      { url: "/api/auth/otp/verify", body: { challengeId: CHALLENGE.challengeId, channel: "sms", identifier: "024 123 4567", code: "123456" } },
    ]);
  });

  it("email: shows the server's error in an alert and keeps the person on the code step", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ ...CHALLENGE, channel: "email", destination: "ama@example.com" }))
      .mockResolvedValueOnce(json({ error: { code: "OTP_INVALID", message: "That code is incorrect or has expired." } }, false));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.type(screen.getByLabelText("Email"), "ama@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That code is incorrect or has expired.");
    expect(screen.getByLabelText("6-digit code").getAttribute("aria-invalid")).toBe("true");
    expect(push).not.toHaveBeenCalled();
  });

  it("signing in with an address that has no account offers to create one with the same code", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(CHALLENGE))
      .mockResolvedValueOnce(json({ error: { code: "OTP_NO_ACCOUNT", message: "No NesAfric account uses this phone number yet. Create one to continue." } }, false))
      .mockResolvedValueOnce(json({ id: "u2", created: true, workspaces: { propertyOsOrganisations: [], marketplaceProfessionals: [] } }));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText("Mobile number"), "0241234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
    expect(await screen.findByText(/No NesAfric account uses this phone number yet/)).toBeTruthy();
    await user.type(screen.getByLabelText("Your name"), "Kofi Mensah");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
    expect(bodies()[2].body).toEqual({ challengeId: CHALLENGE.challengeId, channel: "sms", identifier: "0241234567", code: "123456", displayName: "Kofi Mensah" });
  });
});

describe("web code states from Arkesel-backed SMS", () => {
  it("shows 'Sending…' while the code is requested, then the expiry the server set", async () => {
    let release!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText("Mobile number"), "0241234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect((screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement).disabled).toBe(true);
    release(json({ ...CHALLENGE, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }));
    expect(await screen.findByText(/It expires in 5 minutes\./)).toBeTruthy();
  });

  it("explains a temporary SMS outage without leaving the number step", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "OTP_SMS_UNAVAILABLE", message: "Text-message codes are temporarily unavailable. Please use email or try again later." } }, false));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText("Mobile number"), "0241234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    expect(screen.getByLabelText("Mobile number")).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  it("shows the expired-code message and keeps resend available", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(CHALLENGE))
      .mockResolvedValueOnce(json({ error: { code: "OTP_EXPIRED", message: "That code has expired. Send a new code to try again." } }, false));
    const user = userEvent.setup();
    render(<AuthForm mode="login" />);
    await user.type(screen.getByLabelText("Mobile number"), "0241234567");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That code has expired. Send a new code to try again.");
    expect(screen.getByText(/Resend in \d+s|Resend code/)).toBeTruthy();
  });
});

describe("web passwordless sign-up", () => {
  it.each([
    ["Phone", "Mobile number", "0241234567", "sms"],
    ["Email", "Email", "kofi@example.com", "email"],
  ])("%s: name → address → code → account created → onboarding", async (method, label, value, channel) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ ...CHALLENGE, channel }))
      .mockResolvedValueOnce(json({ id: "u3", created: true, workspaces: { propertyOsOrganisations: [], marketplaceProfessionals: [] } }));
    const user = userEvent.setup();
    const { container } = render(<AuthForm mode="register" />);
    expect(container.querySelector("input[type=password]")).toBeNull();
    await user.click(screen.getByRole("button", { name: method }));
    const send = screen.getByRole("button", { name: "Send code" }) as HTMLButtonElement;
    await user.type(screen.getByLabelText(label), value);
    expect(send.disabled).toBe(true); // a name is required first
    await user.type(screen.getByLabelText("Your name"), "Kofi Mensah");
    await user.click(send);
    await user.type(await screen.findByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify & create account" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
    expect(bodies()[0].body).toEqual({ mode: "register", channel, identifier: value });
    expect(bodies()[1].body).toMatchObject({ channel, identifier: value, code: "123456", displayName: "Kofi Mensah" });
  });
});
