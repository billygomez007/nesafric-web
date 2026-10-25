import { db } from "@/platform/database/client";
import { AppError } from "@/platform/errors";
import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES } from "@/platform/storage/mime";
import { uploadMarketplaceListingMedia, uploadOrganisationDocument, uploadProviderPortfolioImage } from "@/modules/documents/service";
import { downloadWhatsAppMedia, type DownloadedMedia } from "../maintenance/media";

export type MediaOutcome =
  | { status: "added" | "duplicate"; count: number }
  | { status: "limit" | "failed" | "not_editable"; count: number; message: string };

export type MediaDownloader = (mediaId: string) => Promise<DownloadedMedia | null>;

const sourceOf = (mediaId: string) => `whatsapp:${mediaId}`;
const extension = (contentType: string) => contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";

/** Downloads a WhatsApp image (Meta media id only: never a URL a person typed). */
export async function downloadWhatsAppImage(mediaId: string, download: MediaDownloader = downloadWhatsAppMedia) {
  if (!/^\d{1,30}$/.test(mediaId)) return null;
  const file = await download(mediaId).catch(() => null);
  if (!file || !(IMAGE_MIME_TYPES as readonly string[]).includes(file.contentType) || file.contentType === "application/pdf") return null;
  return file;
}

/** Downloads a WhatsApp image or PDF for a private verification document (certificate, ID card). */
export async function downloadWhatsAppDocument(mediaId: string, download: MediaDownloader = downloadWhatsAppMedia) {
  if (!/^\d{1,30}$/.test(mediaId)) return null;
  const file = await download(mediaId).catch(() => null);
  if (!file || !(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.contentType)) return null;
  return file;
}

const photoCount = (listingId: string) => db.listingMedia.count({ where: { listingId, type: "PHOTO" } });

/**
 * Adds one WhatsApp image to a listing through the platform's upload pipeline (authorisation,
 * image processing, malware scan, photo limit under the listing lock). The source media id is
 * unique per listing, so a redelivered message, a retried job or a concurrent duplicate attaches
 * the image once and a failed attempt consumes no slot.
 */
export async function addListingPhoto(input: { userId: string; listingId: string; mediaId: string; marketplaceProfessionalId: string | null; organisationId: string }, download?: MediaDownloader): Promise<MediaOutcome> {
  const sourceMediaId = sourceOf(input.mediaId);
  const attached = () => db.listingMedia.findUnique({ where: { listingId_sourceMediaId: { listingId: input.listingId, sourceMediaId } }, select: { id: true } });
  if (await attached()) return { status: "duplicate", count: await photoCount(input.listingId) };
  const file = await downloadWhatsAppImage(input.mediaId, download);
  if (!file) return { status: "failed", count: await photoCount(input.listingId), message: "I could not download that photo from WhatsApp. Please send it again as a photo (JPEG, PNG or WebP)." };
  const upload = { fileName: `whatsapp-${input.mediaId}.${extension(file.contentType)}`, contentType: file.contentType, dataBase64: file.body.toString("base64"), mediaType: "PHOTO", classification: "PUBLIC", sourceMediaId };
  try {
    if (input.marketplaceProfessionalId) await uploadMarketplaceListingMedia(input.userId, input.marketplaceProfessionalId, input.listingId, upload);
    else await uploadOrganisationDocument(input.userId, input.organisationId, { ...upload, targetType: "LISTING_MEDIA", targetId: input.listingId });
    return { status: "added", count: await photoCount(input.listingId) };
  } catch (error) {
    // Lost a race to a duplicate of the same image: its photo stands.
    if (await attached()) return { status: "duplicate", count: await photoCount(input.listingId) };
    const count = await photoCount(input.listingId);
    if (error instanceof AppError && error.code === "LISTING_MEDIA_LIMIT_REACHED") return { status: "limit", count, message: error.message };
    if (error instanceof AppError && error.code === "LISTING_NOT_EDITABLE") return { status: "not_editable", count, message: error.message };
    if (error instanceof AppError && error.status < 500) return { status: "failed", count, message: error.message };
    throw error;
  }
}

const portfolioCount = (providerId: string) => db.providerPortfolioImage.count({ where: { providerId } });

/** Adds one WhatsApp image to a provider's portfolio, once per source image. */
export async function addPortfolioImage(input: { userId: string; providerId: string; mediaId: string }, download?: MediaDownloader): Promise<MediaOutcome> {
  const sourceMediaId = sourceOf(input.mediaId);
  const attached = () => db.providerPortfolioImage.findUnique({ where: { providerId_sourceMediaId: { providerId: input.providerId, sourceMediaId } }, select: { id: true } });
  if (await attached()) return { status: "duplicate", count: await portfolioCount(input.providerId) };
  const file = await downloadWhatsAppImage(input.mediaId, download);
  if (!file) return { status: "failed", count: await portfolioCount(input.providerId), message: "I could not download that image from WhatsApp. Please send it again as a photo (JPEG, PNG or WebP)." };
  try {
    await uploadProviderPortfolioImage(input.userId, input.providerId, { fileName: `whatsapp-${input.mediaId}.${extension(file.contentType)}`, contentType: file.contentType, dataBase64: file.body.toString("base64"), sourceMediaId });
    return { status: "added", count: await portfolioCount(input.providerId) };
  } catch (error) {
    if (await attached()) return { status: "duplicate", count: await portfolioCount(input.providerId) };
    const count = await portfolioCount(input.providerId);
    if (error instanceof AppError && error.code === "PORTFOLIO_LIMIT_REACHED") return { status: "limit", count, message: error.message };
    if (error instanceof AppError && error.status < 500) return { status: "failed", count, message: error.message };
    throw error;
  }
}
