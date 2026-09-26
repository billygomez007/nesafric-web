import { ApiError, buildQuery, createApiClient, NETWORK_ERROR } from "@/api/client";
import { ConfigError, parseApiUrl } from "@/config";

describe("parseApiUrl", () => {
  it("has no default and rejects insecure or invalid URLs", () => {
    expect(() => parseApiUrl(undefined)).toThrow(ConfigError);
    expect(() => parseApiUrl("SET_ME_BEFORE_BUILDING")).toThrow(ConfigError);
    expect(() => parseApiUrl("http://api.example.com")).toThrow(ConfigError);
    expect(parseApiUrl("https://api.example.com/some/path")).toBe("https://api.example.com");
    expect(parseApiUrl("http://10.0.2.2:3000")).toBe("http://10.0.2.2:3000");
  });
});

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("api client", () => {
  it("builds query strings without empty values", () => {
    expect(buildQuery({ a: "x y", b: undefined, c: "", d: 2 })).toBe("?a=x%20y&d=2");
    expect(buildQuery({})).toBe("");
  });

  it("sends JSON without cookies and returns the payload", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(201, { id: "lead" }));
    const api = createApiClient({ baseUrl: "https://api.test", fetchImpl });
    await expect(api.request("/api/x", { method: "POST", body: { a: 1 } })).resolves.toEqual({ id: "lead" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.test/api/x");
    expect(init).toMatchObject({ method: "POST", credentials: "omit", body: '{"a":1}' });
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("normalises the platform error envelope", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      response(400, { error: { code: "VALIDATION_ERROR", message: "The request contains invalid input.", issues: [{ path: "email", message: "Invalid email" }] } }),
    );
    const api = createApiClient({ baseUrl: "https://api.test", fetchImpl });
    const error = await api.request("/x").catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: "VALIDATION_ERROR", issues: [{ path: "email", message: "Invalid email" }] });
  });

  it("reports network failures distinctly", async () => {
    const api = createApiClient({ baseUrl: "https://api.test", fetchImpl: jest.fn().mockRejectedValue(new TypeError("Network request failed")) });
    await expect(api.request("/x")).rejects.toMatchObject({ status: 0, code: NETWORK_ERROR });
  });

  it("handles non-JSON error bodies", async () => {
    const api = createApiClient({
      baseUrl: "https://api.test",
      fetchImpl: jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("bad"); } } as unknown as Response),
    });
    await expect(api.request("/x")).rejects.toMatchObject({ status: 502, code: "HTTP_502" });
  });

  it("uses an explicit token for a revocation call without reporting the current session as lost", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(401, { error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }));
    const onUnauthenticated = jest.fn();
    const api = createApiClient({ baseUrl: "https://api.test", fetchImpl, getToken: () => "current-session-token-123", onUnauthenticated });

    await expect(api.request("/api/auth/logout", { method: "POST", auth: true, token: "signed-out-token-4567" })).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer signed-out-token-4567");
    expect(onUnauthenticated).not.toHaveBeenCalled();

    // An ordinary authenticated call still reports a 401 for the current session.
    await expect(api.request("/api/account/profile", { auth: true })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("refuses an authenticated call once there is no token, without touching the network", async () => {
    const fetchImpl = jest.fn();
    const api = createApiClient({ baseUrl: "https://api.test", fetchImpl, getToken: () => null });
    await expect(api.request("/api/workspaces", { auth: true })).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
