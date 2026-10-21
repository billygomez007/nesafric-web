/**
 * Property-photo rules shared by the browser (validation, compression) and the server (the
 * authoritative checks). Kept dependency-free so both sides import the same numbers.
 */

/** Most photos one listing can hold, on every path (website, API, WhatsApp). Listings created
 * before this limit keep any extra photos they already have, but cannot add more. */
export const MAX_LISTING_PHOTOS = 10;

/** Most media items of any type (photos, videos, floor plans) one listing can hold. */
export const MAX_LISTING_MEDIA_ITEMS = 12;

/** Formats a browser can pick and the server accepts (sniffed by content, not by name). */
export const LISTING_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Largest photo the upload endpoint accepts, after the browser has resized/compressed it.
 * Photos travel base64-encoded inside JSON (+33%), and a Vercel Function rejects any request
 * body over 4.5 MB with a plain-text `413 Request Entity Too Large` *before* our code runs. 3 MiB
 * encodes to ~4.0 MiB, which leaves room for the JSON envelope under that platform limit.
 */
export const MAX_LISTING_PHOTO_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Largest original a professional may pick; it is resized/compressed before it is uploaded. */
export const MAX_LISTING_PHOTO_SOURCE_BYTES = 25 * 1024 * 1024;

/** Longest edge, in pixels, a photo is resized to — sharp on large screens, small to send. */
export const LISTING_PHOTO_MAX_EDGE = 2560;

export function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** Most portfolio images a service provider's public profile can show (the logo is separate). */
export const MAX_PROVIDER_PORTFOLIO_IMAGES = 10;
