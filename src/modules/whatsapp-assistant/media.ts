import { AppError } from "@/platform/errors";
import { downloadCloudApiMedia, MediaDownloadError, type InboundMedia } from "./cloud-api";
import { recordEvent } from "./store";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "application/pdf": "pdf", "video/mp4": "mp4", "video/3gpp": "3gp",
};

export type UploadPayload = { fileName: string; contentType: string; dataBase64: string };

export type MediaResult = { ok: true; payload: UploadPayload } | { ok: false; message: string };

/**
 * Downloads one inbound WhatsApp attachment into memory so it can go through NesAfric's existing
 * upload services (content sniffing, size limits, malware scanning, durable storage). The short-
 * lived WhatsApp URL is never stored or reused.
 */
export async function fetchInboundMedia(contactId: string, media: InboundMedia, purpose: string): Promise<MediaResult> {
  try {
    const { bytes, mimeType } = await downloadCloudApiMedia(media.id);
    const contentType = (media.mimeType ?? mimeType).split(";")[0].trim().toLowerCase();
    const extension = EXTENSIONS[contentType] ?? "bin";
    const fileName = (media.fileName?.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || `whatsapp-${media.id.slice(-12)}.${extension}`);
    return { ok: true, payload: { fileName, contentType, dataBase64: bytes.toString("base64") } };
  } catch (error) {
    await recordEvent("media_failed", contactId, { purpose, stage: "download", retryable: error instanceof MediaDownloadError ? error.retryable : true });
    const message = error instanceof MediaDownloadError && /too large/i.test(error.message)
      ? "That file is too large. Please send a smaller photo (WhatsApp's normal photo quality is fine)."
      : "I couldn't download that file from WhatsApp. Please send it again.";
    return { ok: false, message };
  }
}

/** Turns an upload-service rejection into a message the person can act on. */
export async function uploadFailureMessage(contactId: string, purpose: string, error: unknown) {
  await recordEvent("media_failed", contactId, { purpose, stage: "store", code: error instanceof AppError ? error.code : "UNKNOWN" });
  if (error instanceof AppError) {
    if (["UNSUPPORTED_FILE_TYPE", "MEDIA_TYPE_MISMATCH"].includes(error.code)) return "That file type isn't accepted here. Please send a JPG or PNG photo (or a PDF for documents).";
    if (["PHOTO_TOO_LARGE", "FILE_TOO_LARGE", "LOGO_TOO_LARGE"].includes(error.code)) return "That file is too large. Please send a smaller version.";
    if (error.code === "MALWARE_DETECTED" || /malware|infected/i.test(error.message)) return "That file failed our safety check and was not saved. Please send a different file.";
    if (error.code === "LISTING_MEDIA_LIMIT_REACHED") return error.message;
    if (error.status < 500) return error.message;
  }
  console.error("[whatsapp-assistant] media upload failed", { purpose, error: error instanceof Error ? error.message : "unknown" });
  return "Something went wrong saving that file on our side. Please send it again in a moment.";
}
