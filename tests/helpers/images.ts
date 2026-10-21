import sharp from "sharp";

/**
 * Real, decodable images for tests. Uploads are fully decoded and re-encoded on the server, so a
 * few magic bytes or a truncated header no longer pass as an image.
 */
export async function makeImage(options: { width?: number; height?: number; format?: "jpeg" | "png" | "webp"; colour?: string; exif?: Record<string, Record<string, string>>; orientation?: number } = {}) {
  const { width = 320, height = 240, format = "jpeg", colour = "#2a7ab0" } = options;
  let image = sharp({ create: { width, height, channels: 3, background: colour } });
  if (options.exif || options.orientation) image = image.withMetadata({ ...(options.orientation ? { orientation: options.orientation } : {}), ...(options.exif ? { exif: options.exif } : {}) });
  return format === "png" ? image.png().toBuffer() : format === "webp" ? image.webp().toBuffer() : image.jpeg().toBuffer();
}

/** A 320 × 240 JPEG. */
export const VALID_JPEG = await makeImage();
/** A 320 × 240 PNG (large enough for photos, logos and portfolio images). */
export const VALID_PNG = await makeImage({ format: "png" });
export const VALID_JPEG_BASE64 = VALID_JPEG.toString("base64");
export const VALID_PNG_BASE64 = VALID_PNG.toString("base64");
