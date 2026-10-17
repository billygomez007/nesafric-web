import { createHmac, timingSafeEqual } from "node:crypto";
import { whatsAppAssistantConfig, type WhatsAppAssistantConfig } from "./config";
import type { CloudApiMessage } from "./messages";

/**
 * WhatsApp Cloud API (Meta Graph API) transport for the NesAfric assistant: webhook signature
 * verification, webhook parsing, sending and authorised media download. Everything that touches
 * the network goes through an injectable `fetch`, so tests never call Meta.
 */

export type InboundMedia = { id: string; mimeType?: string; kind: "image" | "document" | "video" | "audio"; caption?: string; fileName?: string; sha256?: string };
export type InboundLocation = { latitude: number; longitude: number; name?: string; address?: string };

export type ParsedInboundMessage = {
  waMessageId: string;
  waId: string;
  profileName?: string;
  phoneNumberId?: string;
  type: string;
  sentAt: Date;
  text?: string;
  /** Interactive button/list reply id, or a template quick-reply payload. */
  choiceId?: string;
  media?: InboundMedia;
  location?: InboundLocation;
};

export type ParsedStatusUpdate = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  errorCode?: number;
  errorTitle?: string;
};

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj | undefined => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Obj : undefined);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.length ? value : undefined);

function safeEqual(expected: string, actual: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verifies Meta's `X-Hub-Signature-256: sha256=<hmac of the raw body with the app secret>`. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, header.slice("sha256=".length));
}

/** GET webhook subscription handshake. Returns the challenge only for a matching verify token. */
export function verifySubscription(params: URLSearchParams, verifyToken: string | undefined): string | null {
  const token = params.get("hub.verify_token");
  if (params.get("hub.mode") !== "subscribe" || !verifyToken || !token || !safeEqual(verifyToken, token)) return null;
  return params.get("hub.challenge");
}

const MEDIA_KINDS = ["image", "document", "video", "audio"] as const;

function parseMessage(message: Obj, contacts: Obj[], phoneNumberId: string | undefined): ParsedInboundMessage | null {
  const waMessageId = str(message.id);
  const waId = str(message.from);
  if (!waMessageId || !waId) return null;
  const type = str(message.type) ?? "unknown";
  const contact = contacts.find((candidate) => str(candidate.wa_id) === waId) ?? contacts[0];
  const timestamp = Number(str(message.timestamp));
  const parsed: ParsedInboundMessage = {
    waMessageId,
    waId,
    profileName: str(obj(contact?.profile)?.name),
    phoneNumberId,
    type,
    sentAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date(),
  };
  if (type === "text") parsed.text = str(obj(message.text)?.body);
  if (type === "interactive") {
    const interactive = obj(message.interactive);
    const reply = obj(interactive?.button_reply) ?? obj(interactive?.list_reply);
    parsed.choiceId = str(reply?.id);
    parsed.text = str(reply?.title);
  }
  if (type === "button") {
    const button = obj(message.button);
    parsed.choiceId = str(button?.payload);
    parsed.text = str(button?.text);
  }
  if ((MEDIA_KINDS as readonly string[]).includes(type)) {
    const media = obj(message[type]);
    const id = str(media?.id);
    if (id) {
      parsed.media = {
        id,
        kind: type as InboundMedia["kind"],
        mimeType: str(media?.mime_type),
        caption: str(media?.caption),
        fileName: str(media?.filename),
        sha256: str(media?.sha256),
      };
      parsed.text = parsed.media.caption;
    }
  }
  if (type === "location") {
    const location = obj(message.location);
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      parsed.location = { latitude, longitude, name: str(location?.name), address: str(location?.address) };
    }
  }
  return parsed;
}

/**
 * Extracts messages and delivery statuses from a Cloud API webhook payload. Unknown shapes are
 * skipped rather than thrown, so one odd event never blocks the rest of a batch.
 */
export function parseWebhook(payload: unknown): { messages: ParsedInboundMessage[]; statuses: ParsedStatusUpdate[] } {
  const messages: ParsedInboundMessage[] = [];
  const statuses: ParsedStatusUpdate[] = [];
  for (const entry of arr(obj(payload)?.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const value = obj(obj(change)?.value);
      if (!value) continue;
      const phoneNumberId = str(obj(value.metadata)?.phone_number_id);
      const contacts = arr(value.contacts).map(obj).filter((contact): contact is Obj => Boolean(contact));
      for (const message of arr(value.messages)) {
        const parsed = obj(message) && parseMessage(obj(message)!, contacts, phoneNumberId);
        if (parsed) messages.push(parsed);
      }
      for (const status of arr(value.statuses)) {
        const item = obj(status);
        const providerMessageId = str(item?.id);
        const state = str(item?.status);
        if (!providerMessageId || !state || !["sent", "delivered", "read", "failed"].includes(state)) continue;
        const error = obj(arr(item?.errors)[0]);
        const timestamp = Number(str(item?.timestamp));
        statuses.push({
          providerMessageId,
          status: state as ParsedStatusUpdate["status"],
          timestamp: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : new Date(),
          errorCode: typeof error?.code === "number" ? error.code : undefined,
          errorTitle: str(error?.title),
        });
      }
    }
  }
  return { messages, statuses };
}

export type SendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; retryable: boolean; error: string; code?: number };

/** Meta error codes that are permanent for this message (not worth retrying). */
const PERMANENT_ERROR_CODES = new Set([131047, 131026, 131051, 131052, 131053, 132000, 132001, 132012, 100, 190]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let transport: FetchLike = (input, init) => fetch(input, init);

/** Test seam: replace the HTTP transport used for every Graph API call. */
export function setWhatsAppTransport(next: FetchLike | null) {
  transport = next ?? ((input, init) => fetch(input, init));
}

async function graphFetch(url: string, init: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await transport(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendCloudApiMessage(body: CloudApiMessage, config: WhatsAppAssistantConfig = whatsAppAssistantConfig()): Promise<SendResult> {
  if (!config.accessToken || !config.phoneNumberId) return { ok: false, retryable: false, error: "WhatsApp sending is not configured." };
  let response: Response;
  try {
    response = await graphFetch(`${config.graphApiBaseUrl}/${config.graphApiVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, retryable: true, error: error instanceof Error && error.name === "AbortError" ? "WhatsApp request timed out." : "WhatsApp could not be reached." };
  }
  const payload = obj(await response.json().catch(() => undefined));
  if (response.ok) {
    return { ok: true, providerMessageId: str(obj(arr(payload?.messages)[0])?.id) };
  }
  const error = obj(payload?.error);
  const code = typeof error?.code === "number" ? error.code : undefined;
  const retryable = response.status === 429 || response.status >= 500 || code === 130429 || code === 131016;
  return {
    ok: false,
    retryable: retryable && !(code !== undefined && PERMANENT_ERROR_CODES.has(code)),
    code,
    // Meta's message only — never the request body, token or URL.
    error: `WhatsApp responded ${response.status}${code ? ` (code ${code})` : ""}: ${str(error?.message) ?? "request failed"}`.slice(0, 500),
  };
}

export type DownloadedMedia = { bytes: Buffer; mimeType: string };

/**
 * Downloads inbound media through the authorised two-step Graph API flow (media id → short-lived
 * URL → bytes). The temporary URL is used once and never stored.
 */
export async function downloadCloudApiMedia(mediaId: string, config: WhatsAppAssistantConfig = whatsAppAssistantConfig()): Promise<DownloadedMedia> {
  if (!config.accessToken) throw new MediaDownloadError("WhatsApp media download is not configured.", false);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw new MediaDownloadError("Invalid media id.", false);
  const headers = { authorization: `Bearer ${config.accessToken}` };
  let metaResponse: Response;
  try {
    metaResponse = await graphFetch(`${config.graphApiBaseUrl}/${config.graphApiVersion}/${mediaId}`, { headers });
  } catch {
    throw new MediaDownloadError("WhatsApp media could not be reached.", true);
  }
  if (!metaResponse.ok) throw new MediaDownloadError(`WhatsApp media lookup failed (${metaResponse.status}).`, metaResponse.status >= 500 || metaResponse.status === 429);
  const meta = obj(await metaResponse.json().catch(() => undefined));
  const url = str(meta?.url);
  const declaredSize = Number(meta?.file_size);
  if (!url) throw new MediaDownloadError("WhatsApp media has expired.", false);
  if (Number.isFinite(declaredSize) && declaredSize > config.maxMediaBytes) throw new MediaDownloadError("The file is too large.", false);
  let fileResponse: Response;
  try {
    fileResponse = await graphFetch(url, { headers }, 30_000);
  } catch {
    throw new MediaDownloadError("WhatsApp media could not be downloaded.", true);
  }
  if (!fileResponse.ok) throw new MediaDownloadError(`WhatsApp media download failed (${fileResponse.status}).`, fileResponse.status >= 500);
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (bytes.length > config.maxMediaBytes) throw new MediaDownloadError("The file is too large.", false);
  return { bytes, mimeType: str(meta?.mime_type) ?? fileResponse.headers.get("content-type") ?? "application/octet-stream" };
}

export class MediaDownloadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "MediaDownloadError";
  }
}
