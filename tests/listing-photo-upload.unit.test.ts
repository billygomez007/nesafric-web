import { describe, expect, it, vi } from "vitest";
import { readApiResponse } from "@/lib/api-response";
import {
  describeUploadOutcome,
  type ImageTools,
  partitionSelectedImages,
  prepareListingImage,
  uploadListingImagePhotos,
  validateListingImage,
} from "@/lib/listing-image-upload";
import { photosCoverFirst } from "@/lib/listing-cover";
import { LISTING_PHOTO_MAX_EDGE, MAX_LISTING_PHOTO_UPLOAD_BYTES } from "@/lib/listing-media-rules";

/**
 * The upload failure professionals saw: a large phone photo, sent base64-in-JSON, exceeded the
 * hosting platform's 4.5 MB request limit, which answers a plain-text
 * "Request Entity Too Large" (413). The browser called response.json() on it and showed
 * `Unexpected token 'R', "Request En"... is not valid JSON`, and every later photo was skipped.
 */

const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });
const vercel413 = () => new Response("Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE\n", { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } });
const created = (id: string) => new Response(JSON.stringify({ attached: { id, type: "PHOTO", publicUrl: `/media/${id}.jpg`, isCover: false, altText: null } }), { status: 201, headers: { "content-type": "application/json" } });

/** Fake decode/encode: output size shrinks with quality, so the stepping policy is observable. */
function fakeTools(width: number, height: number, sizeAt: (quality: number) => number, calls: { width: number; height: number; quality: number }[] = []): ImageTools {
  return {
    decode: async () => ({ width, height, source: {} as CanvasImageSource }),
    encodeJpeg: async (_source, w, h, quality) => {
      calls.push({ width: w, height: h, quality });
      return new Blob([new Uint8Array(sizeAt(quality))], { type: "image/jpeg" });
    },
  };
}

describe("reading API responses without assuming JSON", () => {
  it("turns the platform's plain-text 413 into a message instead of a JSON parse error", async () => {
    const result = await readApiResponse(vercel413(), "Unable to upload.");
    expect(result).toMatchObject({ ok: false, status: 413, message: "The file is too large to upload." });
  });

  it("uses our JSON error message, and survives a body that claims JSON but isn't", async () => {
    const ours = await readApiResponse(new Response(JSON.stringify({ error: { code: "PHOTO_TOO_LARGE", message: "Property photos must be 3MB or smaller." } }), { status: 413, headers: { "content-type": "application/json" } }), "x");
    expect(ours.message).toBe("Property photos must be 3MB or smaller.");
    const broken = await readApiResponse(new Response("<html>oops", { status: 502, headers: { "content-type": "application/json" } }), "x");
    expect(broken).toMatchObject({ ok: false, status: 502, message: "NesAfric couldn't process this right now (error 502). Please retry." });
  });
});

describe("property photo validation", () => {
  it("accepts JPG, PNG and WebP up to the source limit and names each rejected file", () => {
    expect(() => validateListingImage(file("front.jpg", "image/jpeg", 8 * MB))).not.toThrow();
    const { accepted, rejected } = partitionSelectedImages([
      file("ok.png", "image/png", 1000),
      file("IMG_0001.HEIC", "image/heic", 3 * MB),
      file("anim.gif", "image/gif", 1000),
      file("huge.jpg", "image/jpeg", 26 * MB),
      file("empty.jpg", "image/jpeg", 0),
    ]);
    expect(accepted.map(({ file: f }) => f.name)).toEqual(["ok.png"]);
    expect(rejected).toEqual([
      expect.stringContaining("IMG_0001.HEIC: HEIC photos aren't supported yet"),
      "anim.gif: only JPG, PNG and WebP images are supported.",
      "huge.jpg: image must be 25MB or smaller.",
      "empty.jpg: the file is empty.",
    ]);
  });
});

describe("resizing and compressing before upload", () => {
  it("sends small JPEGs untouched", async () => {
    const small = file("small.jpg", "image/jpeg", 900_000);
    expect(await prepareListingImage(small, fakeTools(1000, 800, () => 1))).toBe(small);
  });

  it("resizes a large photo to the max edge and re-encodes it as JPEG under the upload limit", async () => {
    const calls: { width: number; height: number; quality: number }[] = [];
    const out = await prepareListingImage(file("IMG_4032.png", "image/png", 14 * MB), fakeTools(6000, 4000, (q) => (q > 0.8 ? 3.1 * MB : 1.9 * MB), calls));
    expect(calls[0]).toMatchObject({ width: LISTING_PHOTO_MAX_EDGE, height: Math.round(4000 * (LISTING_PHOTO_MAX_EDGE / 6000)) });
    expect(calls.map(({ quality }) => quality)).toEqual([0.86, 0.78]);
    expect(out).toMatchObject({ name: "IMG_4032.jpg", type: "image/jpeg" });
    expect(out.size).toBeLessThanOrEqual(MAX_LISTING_PHOTO_UPLOAD_BYTES);
  });

  it("refuses a photo that can't be read or can't be made small enough, naming it", async () => {
    const broken: ImageTools = { decode: async () => { throw new Error("bad"); }, encodeJpeg: vi.fn() };
    await expect(prepareListingImage(file("corrupt.jpg", "image/jpeg", 5 * MB), broken)).rejects.toThrow("corrupt.jpg: this image couldn't be read");
    await expect(prepareListingImage(file("noise.png", "image/png", 20 * MB), fakeTools(2000, 2000, () => 3.5 * MB))).rejects.toThrow("noise.png: this image is still larger than 3MB after compression");
  });
});

describe("partial upload recovery", () => {
  it("keeps going past failures, reports 2 of 6, and a retry sends only the failed photos", async () => {
    const images = ["1", "2", "3", "4", "5", "6"].map((n) => ({ key: `k${n}`, file: file(`photo-${n}.jpg`, "image/jpeg", 1000), previewUrl: "" }));
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const name = JSON.parse(String(init?.body)).fileName as string;
      if (name === "photo-3.jpg") return vercel413();
      if (name === "photo-5.jpg") throw new TypeError("Failed to fetch");
      return created(name);
    }) as unknown as typeof fetch;

    const results = await uploadListingImagePhotos({ listingId: "L1", professionalId: "P1", title: "Villa", images, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(results.map((result) => result.ok)).toEqual([true, true, false, true, false, true]);
    expect(results[2]).toMatchObject({ ok: false, message: "photo-3.jpg: The file is too large to upload." });
    expect(results[4]).toMatchObject({ ok: false, message: expect.stringContaining("photo-5.jpg: the connection dropped") });
    expect(describeUploadOutcome(results, "created")).toBe("Property draft created, but 2 of 6 photos could not be uploaded.");
    // Every request went to the same listing — the draft is never recreated.
    expect(vi.mocked(fetcher).mock.calls.every(([url]) => String(url) === "/api/marketplace-professionals/P1/listings/L1/media")).toBe(true);

    const retry = vi.fn(async (_url: string, init?: RequestInit) => created(JSON.parse(String(init?.body)).fileName)) as unknown as typeof fetch;
    const failed = images.filter((image) => results.find((result) => result.key === image.key && !result.ok));
    const again = await uploadListingImagePhotos({ listingId: "L1", professionalId: "P1", title: "Villa", images: failed, fetcher: retry });
    expect(vi.mocked(retry).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).fileName)).toEqual(["photo-3.jpg", "photo-5.jpg"]);
    expect(describeUploadOutcome(again, "saved")).toBeNull();
  });
});

describe("the chosen cover leads every photo list", () => {
  it("puts the isCover photo first, keeps the rest in order, and ignores non-photos", () => {
    const media = [
      { id: "a", type: "PHOTO", isCover: false },
      { id: "plan", type: "FLOOR_PLAN", isCover: false },
      { id: "b", type: "PHOTO", isCover: true },
      { id: "c", type: "PHOTO", isCover: false },
    ];
    expect(photosCoverFirst(media).map(({ id }) => id)).toEqual(["b", "a", "c"]);
    expect(photosCoverFirst(media.map((item) => ({ ...item, isCover: false }))).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });
});
