import { AppError } from "@/platform/errors";

/**
 * Provider-neutral calendar adapter contract (item 6). `CalendarEvent` rows are always the source
 * of truth for scheduling (created/updated/cancelled synchronously, never blocked by this
 * adapter); syncing to an external calendar is a best-effort mirror handled via the background
 * job runner so failures/retries never affect core scheduling.
 */
export type CalendarAttendee = { name: string; email?: string; role?: string };
export type CalendarEventInput = {
  externalReference: string;
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  location?: string;
  attendees: CalendarAttendee[];
};
export type CalendarSyncResult = { providerEventId: string };

export interface CalendarAdapter {
  readonly key: string;
  readonly displayName: string;
  isConfigured(): boolean;
  createEvent(input: CalendarEventInput): Promise<CalendarSyncResult>;
  updateEvent(providerEventId: string, input: CalendarEventInput): Promise<CalendarSyncResult>;
  cancelEvent(providerEventId: string): Promise<void>;
}

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Deterministic, always-available default: no external calendar is mirrored, but core scheduling (the `CalendarEvent` row itself) is fully functional either way. */
export class InternalCalendarAdapter implements CalendarAdapter {
  readonly key = "INTERNAL";
  readonly displayName = "Internal calendar (no external sync)";

  isConfigured() {
    return true;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarSyncResult> {
    return { providerEventId: `internal-${input.externalReference}` };
  }

  async updateEvent(providerEventId: string): Promise<CalendarSyncResult> {
    return { providerEventId };
  }

  async cancelEvent(): Promise<void> {
    // Nothing external to cancel.
  }
}

/**
 * Provider-neutral REST calendar adapter. `CALENDAR_BASE_URL` points at whichever calendar vendor
 * or aggregator (Google Calendar, Microsoft Graph, a unifying proxy, ...) implements this generic
 * contract: `POST/PATCH {baseUrl}/events[/id]` and `DELETE {baseUrl}/events/{id}`.
 */
export class HttpCalendarAdapter implements CalendarAdapter {
  readonly key = "HTTP_CALENDAR";
  readonly displayName = "External calendar provider";

  private config() {
    const baseUrl = env("CALENDAR_BASE_URL");
    const apiKey = env("CALENDAR_API_KEY");
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, timeoutMs: Number(env("CALENDAR_TIMEOUT_MS") ?? "10000") };
  }

  isConfigured() {
    return this.config() !== null;
  }

  private async request(path: string, method: string, body?: unknown) {
    const credentials = this.config();
    if (!credentials) throw new AppError("CALENDAR_PROVIDER_UNAVAILABLE", 503, "No external calendar provider is configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), credentials.timeoutMs);
    try {
      const response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${credentials.apiKey}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new AppError("CALENDAR_PROVIDER_ERROR", 502, `The calendar provider responded with status ${response.status}.`);
      return response.status === 204 ? {} : await response.json().catch(() => ({}));
    } finally {
      clearTimeout(timeout);
    }
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarSyncResult> {
    const payload = (await this.request("/events", "POST", input)) as { id?: string };
    if (!payload.id) throw new AppError("CALENDAR_PROVIDER_ERROR", 502, "The calendar provider did not return an event id.");
    return { providerEventId: payload.id };
  }

  async updateEvent(providerEventId: string, input: CalendarEventInput): Promise<CalendarSyncResult> {
    await this.request(`/events/${encodeURIComponent(providerEventId)}`, "PATCH", input);
    return { providerEventId };
  }

  async cancelEvent(providerEventId: string): Promise<void> {
    await this.request(`/events/${encodeURIComponent(providerEventId)}`, "DELETE");
  }
}

export class CalendarProviderRegistry {
  private readonly adapters = new Map<string, CalendarAdapter>();

  constructor(adapters: CalendarAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: CalendarAdapter) {
    if (this.adapters.has(adapter.key)) throw new Error(`Calendar adapter '${adapter.key}' is already registered.`);
    this.adapters.set(adapter.key, adapter);
    return this;
  }

  get(key: string) {
    const adapter = this.adapters.get(key);
    if (!adapter) throw new AppError("CALENDAR_PROVIDER_UNKNOWN", 404, `Calendar adapter '${key}' is not registered.`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()];
  }
}

export const calendarProviders = new CalendarProviderRegistry([new InternalCalendarAdapter(), new HttpCalendarAdapter()]);
