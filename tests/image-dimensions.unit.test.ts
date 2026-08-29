import { describe, expect, it } from "vitest";
import { readImageDimensions } from "@/platform/storage/mime";

function buildPng(width: number, height: number): Buffer {
  const buffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR", "latin1"),
    Buffer.alloc(8),
  ]);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function buildJpeg(width: number, height: number): Buffer {
  const app0Payload = Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])]);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.from([0x00, app0Payload.length + 2]), app0Payload]);
  const sof0Payload = Buffer.alloc(15);
  sof0Payload.writeUInt8(0x08, 0);
  sof0Payload.writeUInt16BE(height, 1);
  sof0Payload.writeUInt16BE(width, 3);
  sof0Payload.writeUInt8(0x03, 5);
  const sof0 = Buffer.concat([Buffer.from([0xff, 0xc0]), Buffer.from([0x00, sof0Payload.length + 2]), sof0Payload]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
}

function buildWebpVp8x(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const chunk = Buffer.concat([Buffer.from("VP8X", "latin1"), Buffer.from([0x0a, 0x00, 0x00, 0x00]), payload]);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from("WEBP", "latin1"), chunk]);
}

describe("readImageDimensions", () => {
  it("reads PNG dimensions from the IHDR chunk", () => {
    expect(readImageDimensions(buildPng(1600, 290), "image/png")).toEqual({ width: 1600, height: 290 });
  });

  it("reads JPEG dimensions from the SOF0 marker, skipping preceding segments", () => {
    expect(readImageDimensions(buildJpeg(800, 500), "image/jpeg")).toEqual({ width: 800, height: 500 });
  });

  it("reads WEBP (VP8X extended) dimensions", () => {
    expect(readImageDimensions(buildWebpVp8x(1600, 290), "image/webp")).toEqual({ width: 1600, height: 290 });
  });

  it("returns null for an unsupported MIME type", () => {
    expect(readImageDimensions(Buffer.from("not an image"), "application/pdf")).toBeNull();
  });

  it("returns null instead of throwing on truncated/malformed bytes", () => {
    expect(readImageDimensions(Buffer.from([0x89, 0x50]), "image/png")).toBeNull();
    expect(readImageDimensions(Buffer.alloc(0), "image/jpeg")).toBeNull();
  });
});
