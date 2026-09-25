/**
 * Thin typed client for the NesAfric JSON API (`src/app/api/**` in the web repo).
 *
 * Public marketplace calls are unauthenticated. Account calls opt in with `auth: true`, which adds
 * `Authorization: Bearer <session token>` (and `x-organisation-id` when given). A 401 on an
 * authenticated call reports the session as lost via `onUnauthenticated`. The error envelope
 * `{ error: { code, message, details?, issues? } }` is normalised, and cookies are never sent.
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
  /** Send the signed-in user's session token. Never set on public marketplace calls. */
  auth?: boolean;
  /** Workspace scope (`x-organisation-id`) for an authenticated call; the server enforces membership. */
  organisationId?: string;
  /**
   * Use this token instead of the current session's (sign-out revoking a token that is no longer
   * active). A 401 on such a call does not report the current session as lost.
   */
  token?: string;
  timeoutMs?: number;
};

export type ClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Current session token (read from memory; the durable copy lives in secure storage). */
  getToken?: () => string | null;
  /** Called when an authenticated call gets 401 (expired or revoked session). */
  onUnauthenticated?: () => void;
};

export const UNAUTHENTICATED = "UNAUTHENTICATED";

export function buildQuery(query: RequestOptions["query"]) {
  const params = Object.entries(query ?? {}).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "");
  return params.length ? `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}` : "";
}

export function createApiClient({ baseUrl, timeoutMs = 20_000, fetchImpl, getToken, onUnauthenticated }: ClientOptions) {
  // Resolved per call (not captured at creation) so a replaced global fetch is always honoured.
  const doFetch: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  async function request<T>(path: string, { method = "GET", query, body, headers: extraHeaders, signal, auth = false, organisationId, token: explicitToken, timeoutMs: requestTimeoutMs = timeoutMs }: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...extraHeaders };
    if (auth) {
      const token = explicitToken ?? getToken?.();
      if (!token) throw new ApiError(401, UNAUTHENTICATED, "Please sign in to continue.");
      headers.authorization = `Bearer ${token}`;
      if (organisationId) headers["x-organisation-id"] = organisationId;
    }
    if (body !== undefined) headers["content-type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort);

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}${buildQuery(query)}`, {
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
      if (auth && !explicitToken && response.status === 401) onUnauthenticated?.();
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
