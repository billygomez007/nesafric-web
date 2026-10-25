import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processUploadedImage } from "@/platform/storage/image-processing";
import { sniffFileType } from "@/platform/storage/mime";
import { makeImage } from "./helpers/images";

const limits = { minEdge: 200, maxEdge: 12_000, resizeTo: 2560 };
const exif = { IFD0: { Make: "Canon", Model: "EOS R5", Software: "Lightroom" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "5/1 33/1 3600/100", GPSLongitudeRef: "W", GPSLongitude: "0/1 11/1 4200/100" } };

/** Adds a PNG text chunk (tEXt) before IEND. */
function withPngText(png: Buffer, keyword: string, value: string) {
  const data = Buffer.concat([Buffer.from(`${keyword}\0${value}`, "latin1")]);
  const type = Buffer.from("tEXt", "latin1");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), length, type, data, crc, png.subarray(iend)]);
}

describe("processUploadedImage", () => {
  it("removes camera, device and GPS metadata and turns a rotated JPEG upright", async () => {
    const input = await makeImage({ width: 320, height: 240, exif, orientation: 6 });
    const before = await sharp(input).metadata();
    // GPSInfo pointer tag 0x8825, in either byte order.
    const hasGps = (data?: Buffer) => Boolean(data && (data.includes(Buffer.from([0x88, 0x25])) || data.includes(Buffer.from([0x25, 0x88]))));
    expect([before.orientation, before.exif?.includes(Buffer.from("Canon")), hasGps(before.exif)]).toEqual([6, true, true]);

    const output = await processUploadedImage(input, "image/jpeg", limits);
    const after = await sharp(output.bytes).metadata();
    // Orientation 6 means "rotate 90°": the stored pixels are upright, so width and height swap.
    expect([output.mimeType, output.width, output.height, after.width, after.height]).toEqual(["image/jpeg", 240, 320, 240, 320]);
    expect([after.exif, after.xmp, after.iptc, after.orientation]).toEqual([undefined, undefined, undefined, undefined]);
    for (const leaked of ["Canon", "EOS R5", "Lightroom", "Exif"]) expect(output.bytes.includes(Buffer.from(leaked))).toBe(false);
    expect(sniffFileType(output.bytes)?.mimeType).toBe("image/jpeg");
  });

  it("removes text chunks from PNG and EXIF from WebP", async () => {
    const png = withPngText(await makeImage({ format: "png" }), "Comment", "taken at 12 Boundary Road, phone +233241234567");
    expect(png.includes(Buffer.from("Boundary Road"))).toBe(true);
    const pngOut = await processUploadedImage(png, "image/png", limits);
    expect(pngOut.bytes.includes(Buffer.from("Boundary Road"))).toBe(false);

    const webp = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#123456" } }).withMetadata({ exif }).webp().toBuffer();
    expect((await sharp(webp).metadata()).exif).toBeDefined();
    const webpOut = await processUploadedImage(webp, "image/webp", limits);
    expect([(await sharp(webpOut.bytes).metadata()).exif, webpOut.bytes.includes(Buffer.from("Canon"))]).toEqual([undefined, false]);
  });

  it("rejects truncated, corrupt and mislabelled files", async () => {
    const jpeg = await makeImage({ width: 400, height: 300 });
    await expect(processUploadedImage(jpeg.subarray(0, Math.floor(jpeg.length * 0.6)), "image/jpeg", limits)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    const corrupt = Buffer.concat([jpeg.subarray(0, 20), Buffer.alloc(2000, 0x41)]);
    await expect(processUploadedImage(corrupt, "image/jpeg", limits)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    // PNG contents presented as a JPEG (the sniffed type and the decoded format disagree).
    await expect(processUploadedImage(await makeImage({ format: "png" }), "image/jpeg", limits)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(processUploadedImage(Buffer.from("GIF89a not really a gif"), "image/gif", limits)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("enforces minimum and maximum dimensions, and resizes large photos", async () => {
    await expect(processUploadedImage(await makeImage({ width: 120, height: 120 }), "image/jpeg", limits)).rejects.toMatchObject({ code: "IMAGE_TOO_SMALL" });
    await expect(processUploadedImage(await makeImage({ width: 12_001, height: 8 }), "image/jpeg", { maxEdge: 12_000 })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    const large = await processUploadedImage(await makeImage({ width: 4000, height: 3000 }), "image/jpeg", limits);
    expect([large.width, large.height]).toEqual([2560, 1920]);
    const logo = await processUploadedImage(await makeImage({ width: 80, height: 80, format: "png" }), "image/png", { minEdge: 64, maxEdge: 12_000 });
    expect([logo.mimeType, logo.width]).toEqual(["image/png", 80]);
  });
});
