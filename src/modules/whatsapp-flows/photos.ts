import sharp from "sharp";
import type { PublicListing } from "@/modules/whatsapp-assistant/property-cards";

/**
 * Listing photos for a Flow screen. WhatsApp Flows show images only as base64 inside the screen
 * data, so the cover and the next two public photos are fetched and shrunk to small JPEGs. A
 * photo that is slow or unreadable is left out: the screen never waits on it for long.
 */
const MAX_PHOTOS = 3;
const FETCH_TIMEOUT_MS = 2_500;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export type FlowPhoto = { src: string; alt: string };

export function photoUrls(media: PublicListing["media"]) {
  const photos = media.filter((item) => item.type === "PHOTO" && typeof item.url === "string" && item.url.startsWith("https://"));
  return [...photos.filter((item) => item.isCover), ...photos.filter((item) => !item.isCover)].slice(0, MAX_PHOTOS);
}

async function shrink(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) return null;
  const jpeg = await sharp(bytes).rotate().resize({ width: 640, height: 480, fit: "cover" }).jpeg({ quality: 60 }).toBuffer();
  return jpeg.toString("base64");
}

export async function listingPhotos(listing: Pick<PublicListing, "media" | "title">, load: (url: string) => Promise<string | null> = shrink): Promise<FlowPhoto[]> {
  const loaded = await Promise.all(photoUrls(listing.media).map(async (item) => {
    const src = await load(item.url!).catch(() => null);
    return src ? { src, alt: (item.altText ?? item.title ?? listing.title).slice(0, 100) } : null;
  }));
  return loaded.filter((photo): photo is FlowPhoto => photo !== null);
}
