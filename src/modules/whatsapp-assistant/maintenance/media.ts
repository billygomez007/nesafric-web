import { IMAGE_MIME_TYPES, maxUploadBytes } from "@/platform/storage/mime";

export type DownloadedMedia = { body: Buffer; contentType: string };

const ALLOWED = new Set<string>([...IMAGE_MIME_TYPES, "application/pdf"]);

/**
 * Downloads a media item a person sent on WhatsApp. Meta first returns a short-lived URL for the
 * media id, then the bytes, both with the system-user token. Only images and PDFs within the
 * upload size limit are accepted; anything else returns null and is never stored.
 */
export async function downloadWhatsAppMedia(mediaId: string, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<DownloadedMedia | null> {
  const token = env.WHATSAPP_PROVIDER_ACCESS_TOKEN;
  const version = env.WHATSAPP_GRAPH_API_VERSION;
  if (!token || !version || !/^v\d+\.\d+$/.test(version) || !/^\d{1,30}$/.test(mediaId)) return null;
  const headers = { authorization: `Bearer ${token}` };
  const meta = await fetcher(`https://graph.facebook.com/${version}/${mediaId}`, { headers, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (!meta.ok) return null;
  const info = await meta.json().catch(() => ({})) as { url?: unknown; mime_type?: unknown; file_size?: unknown };
  const contentType = typeof info.mime_type === "string" ? info.mime_type.split(";")[0].trim().toLowerCase() : "";
  if (typeof info.url !== "string" || !info.url.startsWith("https://") || !ALLOWED.has(contentType)) return null;
  const limit = maxUploadBytes();
  if (typeof info.file_size === "number" && info.file_size > limit) return null;
  const file = await fetcher(info.url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!file.ok) return null;
  const body = Buffer.from(await file.arrayBuffer());
  return body.length && body.length <= limit ? { body, contentType } : null;
}
