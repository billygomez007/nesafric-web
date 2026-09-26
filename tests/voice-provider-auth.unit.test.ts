import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/voice/service", () => ({
  startInboundCall: vi.fn(async () => ({ call: { id: "call" } })),
  getTenantCallSummary: vi.fn(async () => ({ leases: [] })),
}));

const { POST: inbound } = await import("@/app/api/voice/inbound/route");
const { GET: tenantSummary } = await import("@/app/api/voice/calls/[callId]/tenant-summary/route");
const service = await import("@/modules/voice/service");

const params = { params: Promise.resolve({ callId: "11111111-1111-4111-8111-111111111111" }) };
const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/voice/inbound", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({}) });

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("provider-facing voice call API", () => {
  it("is disabled (503) when no provider secret is configured", async () => {
    vi.stubEnv("VOICE_PROVIDER_API_SECRET", "");
    const response = await inbound(request({ "x-voice-provider-secret": "anything" }));
    expect(response.status).toBe(503);
    expect(service.startInboundCall).not.toHaveBeenCalled();
  });

  it("rejects missing or wrong secrets without touching call data", async () => {
    vi.stubEnv("VOICE_PROVIDER_API_SECRET", "bridge-secret");
    expect((await inbound(request())).status).toBe(401);
    expect((await tenantSummary(new Request("http://localhost/x", { headers: { "x-voice-provider-secret": "bridge-secreT" } }), params)).status).toBe(401);
    expect(service.startInboundCall).not.toHaveBeenCalled();
    expect(service.getTenantCallSummary).not.toHaveBeenCalled();
  });

  it("accepts the configured secret", async () => {
    vi.stubEnv("VOICE_PROVIDER_API_SECRET", "bridge-secret");
    expect((await inbound(request({ "x-voice-provider-secret": "bridge-secret" }))).status).toBe(201);
    expect((await tenantSummary(new Request("http://localhost/x", { headers: { "x-voice-provider-secret": "bridge-secret" } }), params)).status).toBe(200);
  });
});
