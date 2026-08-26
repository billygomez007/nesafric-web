import { AppError } from "@/platform/errors";

/**
 * Provider-neutral geocoding adapter contract (item 5). As with payments and e-signature, which
 * real vendor (or aggregator unifying several) sits behind `GEOCODING_BASE_URL` is an operational
 * concern, not a code concern. `status` never lies about precision: only `"OK"` results carry
 * coordinates; everything else is a clear, explicit non-result so callers never mistake "we don't
 * know" for "the location is (0, 0)".
 */
export type GeocodeQuery = { addressLine1?: string | null; city?: string | null; region?: string | null; district?: string | null; countryCode: string };
export type GeocodeStatusValue = "OK" | "NOT_FOUND" | "ERROR" | "NOT_CONFIGURED";
export type GeocodeResult = {
  status: GeocodeStatusValue;
  latitude?: number;
  longitude?: number;
  precision?: "APPROXIMATE" | "DISTRICT" | "CITY" | "REGION";
  providerReference?: string;
  failureReason?: string;
};

export interface GeocodingAdapter {
  readonly key: string;
  readonly displayName: string;
  isConfigured(): boolean;
  geocode(query: GeocodeQuery): Promise<GeocodeResult>;
}

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** A small, public, well-known set of Ghanaian regional-capital centroids used only as a deterministic, credential-free, low-precision fallback. Never fabricates a street-level result. */
const GHANA_REGION_CENTROIDS: Array<{ match: string; latitude: number; longitude: number }> = [
  { match: "accra", latitude: 5.6037, longitude: -0.187 },
  { match: "greater accra", latitude: 5.6037, longitude: -0.187 },
  { match: "kumasi", latitude: 6.6885, longitude: -1.6244 },
  { match: "ashanti", latitude: 6.6885, longitude: -1.6244 },
  { match: "takoradi", latitude: 4.9047, longitude: -1.7554 },
  { match: "sekondi", latitude: 4.9047, longitude: -1.7554 },
  { match: "western", latitude: 4.9047, longitude: -1.7554 },
  { match: "cape coast", latitude: 5.1053, longitude: -1.2466 },
  { match: "central", latitude: 5.1053, longitude: -1.2466 },
  { match: "koforidua", latitude: 6.094, longitude: -0.2591 },
  { match: "eastern", latitude: 6.094, longitude: -0.2591 },
  { match: "ho", latitude: 6.6111, longitude: 0.4708 },
  { match: "volta", latitude: 6.6111, longitude: 0.4708 },
  { match: "tamale", latitude: 9.4008, longitude: -0.8393 },
  { match: "northern", latitude: 9.4008, longitude: -0.8393 },
  { match: "bolgatanga", latitude: 10.7856, longitude: -0.8514 },
  { match: "upper east", latitude: 10.7856, longitude: -0.8514 },
  { match: "wa", latitude: 10.0601, longitude: -2.5099 },
  { match: "upper west", latitude: 10.0601, longitude: -2.5099 },
  { match: "sunyani", latitude: 7.34, longitude: -2.3265 },
  { match: "bono", latitude: 7.34, longitude: -2.3265 },
];

/**
 * Deterministic, credential-free fallback. It never invents street-level coordinates: it only
 * ever resolves a known Ghanaian region/city name to that place's public centroid at REGION/CITY
 * precision, and otherwise reports `NOT_FOUND` rather than guessing.
 */
export class DeterministicFallbackGeocodingAdapter implements GeocodingAdapter {
  readonly key = "deterministic-fallback";
  readonly displayName = "Deterministic fallback (no live provider configured)";

  isConfigured() {
    return true;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    const haystack = [query.city, query.district, query.region].filter(Boolean).map((value) => value!.toLowerCase());
    for (const candidate of haystack) {
      const found = GHANA_REGION_CENTROIDS.find((entry) => candidate.includes(entry.match));
      if (found) {
        return { status: "OK", latitude: found.latitude, longitude: found.longitude, precision: "CITY", providerReference: `fallback:${found.match}` };
      }
    }
    return { status: "NOT_FOUND", failureReason: "No live geocoding provider is configured and no known region/city name was recognised." };
  }
}

/**
 * Provider-neutral REST geocoding adapter. Point `GEOCODING_BASE_URL` at whichever real geocoding
 * vendor (or a thin proxy unifying several) speaks this generic contract: `GET {baseUrl}?address=
 * ...&country=..` returning `{ "status": "OK"|"NOT_FOUND", "latitude"?, "longitude"?, "precision"? }`.
 */
export class HttpGeocodingAdapter implements GeocodingAdapter {
  readonly key = "http";
  readonly displayName = "External geocoding provider";

  private config() {
    const baseUrl = env("GEOCODING_BASE_URL");
    if (!baseUrl) return null;
    return { baseUrl, apiKey: env("GEOCODING_API_KEY"), timeoutMs: Number(env("GEOCODING_TIMEOUT_MS") ?? "8000") };
  }

  isConfigured() {
    return this.config() !== null;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    const config = this.config();
    if (!config) return { status: "NOT_CONFIGURED" };
    const params = new URLSearchParams({
      address: [query.addressLine1, query.district, query.city, query.region].filter(Boolean).join(", "),
      country: query.countryCode,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}?${params.toString()}`, {
        signal: controller.signal,
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
      });
      if (!response.ok) return { status: "ERROR", failureReason: `The geocoding provider responded with status ${response.status}.` };
      const payload = (await response.json().catch(() => ({}))) as { status?: string; latitude?: number; longitude?: number; precision?: string; reference?: string };
      if (payload.status === "OK" && typeof payload.latitude === "number" && typeof payload.longitude === "number") {
        const precision = (["APPROXIMATE", "DISTRICT", "CITY", "REGION"] as const).includes(payload.precision as never) ? (payload.precision as GeocodeResult["precision"]) : "APPROXIMATE";
        return { status: "OK", latitude: payload.latitude, longitude: payload.longitude, precision, providerReference: payload.reference };
      }
      return { status: "NOT_FOUND", failureReason: "The geocoding provider could not resolve this address." };
    } catch (error) {
      return { status: "ERROR", failureReason: error instanceof Error ? error.message : "The geocoding request failed." };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class GeocodingProviderRegistry {
  private readonly adapters = new Map<string, GeocodingAdapter>();

  constructor(adapters: GeocodingAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: GeocodingAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Geocoding adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("GEOCODING_PROVIDER_UNKNOWN", 404, `Geocoding adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const geocodingProviders = new GeocodingProviderRegistry([new HttpGeocodingAdapter(), new DeterministicFallbackGeocodingAdapter()]);

/** The HTTP provider is used whenever it is configured; otherwise the deterministic fallback (never blocking, never fabricating precision). */
export function getActiveGeocodingAdapter(registry: GeocodingProviderRegistry = geocodingProviders): GeocodingAdapter {
  const http = registry.get("http");
  return http.isConfigured() ? http : registry.get("deterministic-fallback");
}
