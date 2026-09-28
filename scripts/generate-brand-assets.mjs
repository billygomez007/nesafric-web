#!/usr/bin/env node
/**
 * Regenerates every NesAfric logo derivative (web + native) from the one supplied source,
 * `brand/nesafric-logo.png` (official logo, supplied 2026-09-28, transparent background).
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Nothing is redrawn, recoloured or restyled: derivatives are only trimmed of transparent margin,
 * scaled proportionally, and — where a platform forbids transparency (app icons, favicons, social
 * cards) — placed on the app's existing background colour. Small icons use the logo's own house
 * mark (cropped from the source) because the full lockup and tagline are unreadable at that size.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "brand/nesafric-logo.png");
/** App background (web `--background`, Expo `backgroundColor`): the existing brand canvas. */
const CANVAS = "#fcfbf8";
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const ALPHA_THRESHOLD = 16;

/** Bounding box of pixels at least slightly opaque, optionally limited to a column range. */
async function opaqueBox(buffer, fromX = 0, toX = Infinity) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = Math.max(0, fromX); x < Math.min(width, toX); x++) {
      if (data[(y * width + x) * channels + 3] > ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1, columns: await opaqueColumns(data, info) };
}

async function opaqueColumns(data, { width, height, channels }) {
  const columns = [];
  for (let x = 0; x < width; x++) {
    let any = false;
    for (let y = 0; y < height && !any; y++) any = data[(y * width + x) * channels + 3] > ALPHA_THRESHOLD;
    columns.push(any);
  }
  return columns;
}

/** The house mark is the first opaque block before the widest transparent gap (the space before "N"). */
function markColumns(columns) {
  const runs = [];
  for (let x = 0, start = -1; x <= columns.length; x++) {
    if (columns[x] && start < 0) start = x;
    if (!columns[x] && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  let split = 0, widest = -1;
  for (let i = 0; i < runs.length - 1; i++) {
    const gap = runs[i + 1][0] - runs[i][1];
    if (gap > widest) { widest = gap; split = i; }
  }
  return [runs[0][0], runs[split][1] + 1];
}

function out(relative) {
  return path.join(root, relative);
}

async function write(image, relative) {
  await mkdir(path.dirname(out(relative)), { recursive: true });
  await image.png({ compressionLevel: 9 }).toFile(out(relative));
  const meta = await sharp(out(relative)).metadata();
  console.log(`${relative.padEnd(52)} ${meta.width}x${meta.height}`);
}

/** Fits `buffer` inside a square canvas with `padding` (fraction of the side) on every edge. */
async function square(buffer, size, padding, background) {
  const inner = Math.round(size * (1 - padding * 2));
  const fitted = await sharp(buffer).resize(inner, inner, { fit: "contain", background: TRANSPARENT }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: fitted, gravity: "centre" }]);
}

const source = await sharp(SOURCE).ensureAlpha().toBuffer();
const box = await opaqueBox(source);
const [markLeft, markRight] = markColumns(box.columns);
const markBox = await opaqueBox(source, markLeft, markRight);

// Full lockup, trimmed to the artwork with a hairline of transparent margin.
const margin = Math.round(box.height * 0.03);
const logo = await sharp(source)
  .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
  .extend({ top: margin, bottom: margin, left: margin, right: margin, background: TRANSPARENT })
  .toBuffer();
const mark = await sharp(source).extract({ left: markBox.left, top: markBox.top, width: markBox.width, height: markBox.height }).toBuffer();

// ---- Web ----
await write(sharp(logo), "public/brand/nesafric-logo.png");
await write(await square(mark, 512, 0.08, TRANSPARENT), "public/brand/nesafric-mark.png");
await write(await square(mark, 512, 0.12, CANVAS), "src/app/icon.png");
await write(await square(mark, 180, 0.12, CANVAS), "src/app/apple-icon.png");
await write(await square(mark, 192, 0.12, CANVAS), "public/icons/icon-192.png");
await write(await square(mark, 512, 0.12, CANVAS), "public/icons/icon-512.png");
{
  // Social card: the full logo, centred on the brand canvas at 1200 x 630.
  const fitted = await sharp(logo).resize(960, 380, { fit: "inside" }).toBuffer();
  await write(sharp({ create: { width: 1200, height: 630, channels: 4, background: CANVAS } }).composite([{ input: fitted, gravity: "centre" }]).flatten({ background: CANVAS }), "public/brand/nesafric-og.png");
}

// ---- Native (Expo) ----
await write(sharp(logo).resize({ width: 1200 }), "mobile/assets/images/nesafric-logo.png");
// iOS forbids transparency in the app icon; Expo also uses it for Android legacy icons.
await write((await square(mark, 1024, 0.16, CANVAS)).flatten({ background: CANVAS }), "mobile/assets/images/icon.png");
// Android adaptive icon: the mark stays inside the 66% safe zone of the 108dp foreground layer;
// the background colour comes from app.json (`adaptiveIcon.backgroundColor`).
await write(await square(mark, 1024, 0.22, TRANSPARENT), "mobile/assets/images/android-icon-foreground.png");
await write(await square(mark, 1024, 0.04, TRANSPARENT), "mobile/assets/images/splash-icon.png");
await write((await square(mark, 48, 0.08, CANVAS)).flatten({ background: CANVAS }), "mobile/assets/images/favicon.png");

console.log(`\nlogo aspect ${(box.width + margin * 2)}x${(box.height + margin * 2)}; mark ${markBox.width}x${markBox.height} at ${markBox.left},${markBox.top}`);
