/**
 * Thin typed client for the NesAfric JSON API (`src/app/api/**` in the web repo).
 *
 * Phase 1A only calls public, unauthenticated endpoints. It normalises the platform error
 * envelope `{ error: { code, message, details?, issues? } }` and never sends cookies.
 */
export type ApiIssue = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Status 0: the request never reached the server (offline, DNS, TLS, timeout). */
export const NETWORK_ERROR = "NETWORK_ERROR";

export type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type ClientOptions = { baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch };

/** This branch previews real listings without sending writes to the live NesAfric API. */
export function isProductionApi(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === "nesafric.com" || host === "www.nesafric.com";
}

export function buildQuery(query: RequestOptions["query"]) {
  const params = Object.entries(query ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "");
  return params.length ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}

export function createApiClient({ baseUrl, timeoutMs = 20_000, fetchImpl = fetch }: ClientOptions) {
  async function request<T>(path: string, { method = "GET", query, body, headers: extraHeaders, signal }: RequestOptions = {}): Promise<T> {
    if (method !== "GET" && isProductionApi(baseUrl)) {
      throw new ApiError(403, "READ_ONLY_PREVIEW", "Contact and viewing requests are disabled in this preview.");
    }
    const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["content-type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort);

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}${buildQuery(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR, "Can't reach NesAfric. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }

    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload?.error ?? {};
      throw new ApiError(
        response.status,
        typeof error.code === "string" ? error.code : `HTTP_${response.status}`,
        typeof error.message === "string" ? error.message : "Something went wrong. Please try again.",
        Array.isArray(error.issues) ? error.issues : [],
      );
    }
    return payload as T;
  }

  return { request, baseUrl };
}

export type ApiClient = ReturnType<typeof createApiClient>;
