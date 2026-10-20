import sharp, { type Metadata } from "sharp";
import { AppError } from "@/platform/errors";

export type ProcessedImage = { bytes: Buffer; mimeType: string; width: number; height: number };

export type ImageLimits = {
  /** Smallest accepted width or height after orientation, in pixels. */
  minEdge?: number;
  /** Largest accepted width or height of the original, in pixels. */
  maxEdge: number;
  /** Resize so the longest edge is at most this many pixels (never enlarges). */
  resizeTo?: number;
};

const FORMAT_MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
/** Formats re-encoded here. Others (for example HEIC evidence) are stored as uploaded. */
export const PROCESSED_IMAGE_MIME_TYPES = Object.values(FORMAT_MIME);
/** Decompression-bomb guard: refuse images over 100 megapixels before decoding them. */
const MAX_INPUT_PIXELS = 100_000_000;

const invalid = (message = "The image file is damaged or incomplete. Please send it again.") => new AppError("INVALID_IMAGE", 422, message);

/**
 * Fully decodes an uploaded image with sharp (libvips, the library Next.js uses for its own
 * images), rotates it upright from its EXIF orientation, and re-encodes it in the same format.
 * The output carries no EXIF, GPS, XMP, IPTC or comments, so the camera, device and location of
 * a photo never reach storage. A truncated or corrupt file fails decoding and is rejected, as is a
 * file whose decoded format differs from the type its bytes were sniffed as.
 */
export async function processUploadedImage(input: Buffer, sniffedMimeType: string, limits: ImageLimits): Promise<ProcessedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: "truncated", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw invalid();
  }
  const mimeType = metadata.format ? FORMAT_MIME[metadata.format] : undefined;
  if (!mimeType || mimeType !== sniffedMimeType) throw invalid("The image's contents do not match its file type. Please send a JPEG, PNG or WebP photo.");
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (!width || !height) throw invalid();
  if (Math.max(width, height) > limits.maxEdge) {
    throw new AppError("IMAGE_TOO_LARGE", 422, `This image is ${width} × ${height}px. Images can be at most ${limits.maxEdge}px on each side.`);
  }
  if (limits.minEdge !== undefined && Math.min(width, height) < limits.minEdge) {
    throw new AppError("IMAGE_TOO_SMALL", 422, `This image is ${width} × ${height}px. Images must be at least ${limits.minEdge}px on each side.`);
  }
  try {
    let pipeline = sharp(input, { failOn: "truncated", limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate();
    if (limits.resizeTo) pipeline = pipeline.resize({ width: limits.resizeTo, height: limits.resizeTo, fit: "inside", withoutEnlargement: true });
    pipeline = mimeType === "image/jpeg" ? pipeline.jpeg({ quality: 88 })
      : mimeType === "image/png" ? pipeline.png()
        : mimeType === "image/webp" ? pipeline.webp({ quality: 88 })
          : pipeline.gif();
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { bytes: data, mimeType, width: info.width, height: info.height };
  } catch {
    throw invalid();
  }
}
