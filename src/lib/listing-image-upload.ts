import { readApiResponse } from "./api-response";
import {
  formatMegabytes,
  LISTING_PHOTO_MAX_EDGE,
  LISTING_PHOTO_MIME_TYPES,
  MAX_LISTING_PHOTO_SOURCE_BYTES,
  MAX_LISTING_PHOTO_UPLOAD_BYTES,
  MAX_LISTING_PHOTOS,
} from "./listing-media-rules";

export type SelectedListingImage = {
  /** Stable identity for this pick, so its upload status and cover choice survive re-renders. */
  key: string;
  file: File;
  previewUrl: string;
};

export const MAX_LISTING_IMAGES = MAX_LISTING_PHOTOS;
export const ACCEPTED_LISTING_IMAGE_TYPES = LISTING_PHOTO_MIME_TYPES;
/** Largest original a professional may pick (it is compressed before upload). */
export const MAX_LISTING_IMAGE_BYTES = MAX_LISTING_PHOTO_SOURCE_BYTES;
/** Compression aims here, comfortably under the hard upload limit. */
const TARGET_UPLOAD_BYTES = Math.floor(MAX_LISTING_PHOTO_UPLOAD_BYTES * 0.85);
const JPEG_QUALITIES = [0.86, 0.78, 0.7, 0.6];

export function validateListingImage(file: File) {
  if (/\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    throw new Error(`${file.name}: HEIC photos aren't supported yet. Export it as JPEG (or set the camera to "Most Compatible") and try again.`);
  }
  if (!ACCEPTED_LISTING_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_LISTING_IMAGE_TYPES)[number])) {
    throw new Error(`${file.name}: only JPG, PNG and WebP images are supported.`);
  }
  if (file.size === 0) throw new Error(`${file.name}: the file is empty.`);
  if (file.size > MAX_LISTING_IMAGE_BYTES) {
    throw new Error(`${file.name}: image must be ${formatMegabytes(MAX_LISTING_IMAGE_BYTES)} or smaller.`);
  }
}

let keySequence = 0;
function selectImage(file: File): SelectedListingImage {
  keySequence += 1;
  return { key: `${Date.now().toString(36)}-${keySequence}`, file, previewUrl: URL.createObjectURL(file) };
}

/** Validates every file, throwing on the first unacceptable one (kept for existing callers). */
export function filesToSelectedImages(files: File[]): SelectedListingImage[] {
  files.forEach(validateListingImage);
  return files.map(selectImage);
}

/** Validates every file and keeps the acceptable ones, reporting each rejected file by name. */
export function partitionSelectedImages(files: File[]) {
  const accepted: SelectedListingImage[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    try {
      validateListingImage(file);
      accepted.push(selectImage(file));
    } catch (cause) {
      rejected.push(cause instanceof Error ? cause.message : `${file.name}: this file can't be used.`);
    }
  }
  return { accepted, rejected };
}

export function releaseSelectedImage(image: SelectedListingImage) {
  URL.revokeObjectURL(image.previewUrl);
}

/** Decoding and re-encoding, injectable so the resize/compress policy is testable without a browser. */
export type ImageTools = {
  decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; close?: () => void }>;
  encodeJpeg(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
};

export const browserImageTools: ImageTools = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  async encodeJpeg(source, width, height, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.fillStyle = "#ffffff"; // transparent PNG areas become white, not black
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed."))), "image/jpeg", quality));
  },
};

/**
 * Makes a photo safe to send: small JPEG/WebP photos go as they are; anything else is resized to
 * at most LISTING_PHOTO_MAX_EDGE on its long side and re-encoded as JPEG, stepping the quality
 * down until it fits. Throws a message naming the photo when it can't be read or made small enough.
 */
export async function prepareListingImage(file: File, tools: ImageTools = browserImageTools): Promise<File> {
  if (file.size <= TARGET_UPLOAD_BYTES && (file.type === "image/jpeg" || file.type === "image/webp")) return file;
  let decoded: Awaited<ReturnType<ImageTools["decode"]>>;
  try {
    decoded = await tools.decode(file);
  } catch {
    throw new Error(`${file.name}: this image couldn't be read. It may be damaged or in an unsupported format.`);
  }
  try {
    const scale = Math.min(1, LISTING_PHOTO_MAX_EDGE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    let smallest: Blob | null = null;
    for (const quality of JPEG_QUALITIES) {
      const blob = await tools.encodeJpeg(decoded.source, width, height, quality);
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= TARGET_UPLOAD_BYTES) break;
    }
    if (!smallest || smallest.size > MAX_LISTING_PHOTO_UPLOAD_BYTES) {
      throw new Error(`${file.name}: this image is still larger than ${formatMegabytes(MAX_LISTING_PHOTO_UPLOAD_BYTES)} after compression. Try a smaller photo.`);
    }
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([smallest], name, { type: "image/jpeg" });
  } finally {
    decoded.close?.();
  }
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Chunked so a multi-megabyte photo never overflows the argument limit of fromCharCode.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export type UploadedListingMedia = { id: string; type: string; publicUrl: string; isCover: boolean; altText: string | null };
export type ListingImageUploadResult =
  | { key: string; fileName: string; ok: true; media: UploadedListingMedia | null }
  | { key: string; fileName: string; ok: false; message: string };

type UploadTarget = { listingId: string; organisationId?: string; professionalId?: string; title: string };

/** Uploads one photo. Never throws: every outcome — including a non-JSON 413 — is a result. */
export async function uploadListingImage(
  params: UploadTarget & { image: SelectedListingImage; position: number; tools?: ImageTools; fetcher?: typeof fetch },
): Promise<ListingImageUploadResult> {
  const { image } = params;
  const fileName = image.file.name;
  if (!params.professionalId && !params.organisationId) {
    return { key: image.key, fileName, ok: false, message: "An organisation is required for PropertyOS image uploads." };
  }
  try {
    const prepared = await prepareListingImage(image.file, params.tools);
    const dataBase64 = await fileToBase64(prepared);
    const url = params.professionalId
      ? `/api/marketplace-professionals/${params.professionalId}/listings/${params.listingId}/media`
      : "/api/documents/uploads";
    const response = await (params.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(!params.professionalId && params.organisationId ? { "x-organisation-id": params.organisationId } : {}),
      },
      body: JSON.stringify({
        ...(params.professionalId ? {} : { targetType: "LISTING_MEDIA", targetId: params.listingId }),
        fileName: prepared.name,
        contentType: prepared.type,
        dataBase64,
        classification: "PUBLIC",
        mediaType: "PHOTO",
        title: `Property photo ${params.position}`,
        altText: `${params.title} — property photo ${params.position}`,
      }),
    });
    const result = await readApiResponse<{ attached?: UploadedListingMedia }>(response, `Unable to upload ${fileName}.`);
    if (!result.ok) return { key: image.key, fileName, ok: false, message: `${fileName}: ${result.message}` };
    return { key: image.key, fileName, ok: true, media: result.data?.attached ?? null };
  } catch (cause) {
    const message = cause instanceof TypeError
      ? `${fileName}: the connection dropped during upload. Check your connection and retry.`
      : cause instanceof Error ? cause.message : `${fileName}: upload failed.`;
    return { key: image.key, fileName, ok: false, message };
  }
}

/**
 * Uploads photos one at a time to the same listing, continuing past failures so every photo that
 * can be uploaded is. Returns one result per photo, in order.
 */
export async function uploadListingImagePhotos(
  params: UploadTarget & { images: SelectedListingImage[]; firstPosition?: number; onResult?: (result: ListingImageUploadResult) => void; tools?: ImageTools; fetcher?: typeof fetch },
) {
  const results: ListingImageUploadResult[] = [];
  for (const [index, image] of params.images.entries()) {
    const result = await uploadListingImage({ ...params, image, position: (params.firstPosition ?? 1) + index });
    results.push(result);
    params.onResult?.(result);
  }
  return results;
}

/** "Property draft created, but 2 of 6 photos could not be uploaded." — null when all succeeded. */
export function describeUploadOutcome(results: ListingImageUploadResult[], context: "created" | "saved") {
  const failed = results.filter((result) => !result.ok).length;
  if (!failed) return null;
  const lead = context === "created" ? "Property draft created" : "Your changes were saved";
  return `${lead}, but ${failed} of ${results.length} photo${results.length === 1 ? "" : "s"} could not be uploaded.`;
}

/** Legacy all-or-nothing wrapper: uploads every photo, then throws one message if any failed. */
export async function uploadListingImages(params: UploadTarget & { images: SelectedListingImage[] }) {
  const results = await uploadListingImagePhotos(params);
  const failures = results.filter((result): result is Extract<ListingImageUploadResult, { ok: false }> => !result.ok);
  if (failures.length) throw new Error(failures.map((failure) => failure.message).join(" "));
  return results;
}
