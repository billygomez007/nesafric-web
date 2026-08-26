/**
 * Dependency-free file-byte MIME sniffing, safe filename derivation, and upload limits.
 *
 * Item 1 requires MIME to be "validated by file bytes (not browser MIME alone)". Rather than
 * trusting a browser-supplied `Content-Type` (trivially spoofable), every upload is sniffed from
 * its actual magic bytes here; the declared type is retained only as metadata for comparison.
 */

export type SniffedFile = {
  mimeType: string;
  extension: string;
  kind: "IMAGE" | "DOCUMENT" | "VIDEO";
};

const SIGNATURES: Array<{ mimeType: string; extension: string; kind: SniffedFile["kind"]; test: (bytes: Buffer) => boolean }> = [
  { mimeType: "application/pdf", extension: "pdf", kind: "DOCUMENT", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mimeType: "image/jpeg", extension: "jpg", kind: "IMAGE", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: "image/png",
    extension: "png",
    kind: "IMAGE",
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: "image/gif",
    extension: "gif",
    kind: "IMAGE",
    test: (b) => b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a"),
  },
  {
    mimeType: "image/webp",
    extension: "webp",
    kind: "IMAGE",
    test: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    mimeType: "image/heic",
    extension: "heic",
    kind: "IMAGE",
    test: (b) => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp" && ["heic", "heix", "hevc", "mif1", "msf1"].includes(b.subarray(8, 12).toString("latin1")),
  },
  {
    mimeType: "video/mp4",
    extension: "mp4",
    kind: "VIDEO",
    test: (b) => b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp",
  },
  {
    mimeType: "video/webm",
    extension: "webm",
    kind: "VIDEO",
    test: (b) => b.length > 4 && b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  },
];

/** Every file type PropertyOS can accept anywhere. Per-target-type allow-lists further restrict this. */
export function sniffFileType(bytes: Buffer): SniffedFile | null {
  for (const signature of SIGNATURES) {
    if (signature.test(bytes)) return { mimeType: signature.mimeType, extension: signature.extension, kind: signature.kind };
  }
  return null;
}

export const IMAGE_MIME_TYPES = SIGNATURES.filter((s) => s.kind === "IMAGE").map((s) => s.mimeType);
export const VIDEO_MIME_TYPES = SIGNATURES.filter((s) => s.kind === "VIDEO").map((s) => s.mimeType);
export const DOCUMENT_MIME_TYPES = ["application/pdf", ...IMAGE_MIME_TYPES];

/** Default per-upload byte ceiling; override with STORAGE_MAX_UPLOAD_BYTES. Images/PDFs are small; this is generous but bounded. */
export function maxUploadBytes() {
  const configured = Number(process.env.STORAGE_MAX_UPLOAD_BYTES ?? "");
  return Number.isFinite(configured) && configured > 0 ? configured : 25 * 1024 * 1024;
}

/**
 * Derives a filesystem/URL-safe filename. The extension is always regenerated from the sniffed
 * content type (never trusted from the caller-supplied name) so a renamed executable cannot ride
 * along as a trusted extension.
 */
export function safeFileName(originalFileName: string, sniffed: SniffedFile): string {
  const base = originalFileName.split(/[\\/]/).pop() ?? "file";
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return `${cleaned.length ? cleaned : "file"}.${sniffed.extension}`;
}
