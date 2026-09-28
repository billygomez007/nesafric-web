import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/platform/brand";

/**
 * Every NesAfric logo file is generated from `brand/nesafric-logo.png` (the official logo supplied
 * 2026-09-28) by `scripts/generate-brand-assets.mjs`. These checks catch a stale, stretched or
 * wrongly sized derivative and any return of the previous logo files.
 */
const root = path.resolve(__dirname, "..");
const file = (relative: string) => path.join(root, relative);
const meta = (relative: string) => sharp(file(relative)).metadata();

async function opaqueCorners(relative: string) {
  const { data, info } = await sharp(file(relative)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
  return [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1), at(info.width - 1, info.height - 1)];
}

describe("NesAfric brand assets", () => {
  it("keeps the supplied logo as the single source, with a transparent background", async () => {
    const source = await meta("brand/nesafric-logo.png");
    expect([source.width, source.height]).toEqual([2172, 724]);
    expect(await opaqueCorners("brand/nesafric-logo.png")).toEqual([0, 0, 0, 0]);
  });

  it("serves the web logo at the size BRAND declares, so BrandLogo keeps its proportions", async () => {
    expect(BRAND.logo.onLight).toBe("/brand/nesafric-logo.png");
    const logo = await meta("public/brand/nesafric-logo.png");
    expect([logo.width, logo.height]).toEqual([BRAND.logo.width, BRAND.logo.height]);
    expect(logo.hasAlpha).toBe(true);
    // Trimming only: the source artwork's own proportions (2014 x 535 plus an even margin).
    expect(logo.width! / logo.height!).toBeCloseTo((2014 + 32) / (535 + 32), 2);
  });

  it("has a 1200 x 630 social card and square icons", async () => {
    expect(BRAND.logo.og).toBe("/brand/nesafric-og.png");
    const og = await meta("public/brand/nesafric-og.png");
    expect([og.width, og.height]).toEqual([1200, 630]);
    for (const [relative, size] of [["public/brand/nesafric-mark.png", 512], ["src/app/icon.png", 512], ["src/app/apple-icon.png", 180], ["public/icons/icon-192.png", 192], ["public/icons/icon-512.png", 512]] as const) {
      const icon = await meta(relative);
      expect([relative, icon.width, icon.height]).toEqual([relative, size, size]);
    }
  });

  it("gives the native app opaque launcher icons and transparent adaptive/splash layers", async () => {
    const icon = await meta("mobile/assets/images/icon.png");
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    expect(await opaqueCorners("mobile/assets/images/icon.png")).toEqual([255, 255, 255, 255]);
    expect(await opaqueCorners("mobile/assets/images/favicon.png")).toEqual([255, 255, 255, 255]);
    for (const relative of ["mobile/assets/images/android-icon-foreground.png", "mobile/assets/images/splash-icon.png"]) {
      const layer = await meta(relative);
      expect([layer.width, layer.height]).toEqual([1024, 1024]);
      expect(await opaqueCorners(relative)).toEqual([0, 0, 0, 0]);
    }
    const logo = await meta("mobile/assets/images/nesafric-logo.png");
    expect([logo.width, logo.height]).toEqual([1200, 333]);
    // The app's BrandLogo sizes the image with the same aspect.
    expect(readFileSync(file("mobile/src/components/brand-logo.tsx"), "utf8")).toContain("LOGO_ASPECT = 1200 / 333");
  });

  it("no longer ships or references the previous logo files", () => {
    const old = ["nesafric-official-logo", "nesafric-official-mark", "nesafric-wordmark", "nesafric-favicon-source"];
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
    expect(tracked.filter((name) => old.some((stem) => name.includes(stem)))).toEqual([]);
    // `git grep` exits 1 when nothing matches, which is the expected outcome.
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-l", "-E", old.join("|"), "--", "src", "mobile/src", "mobile/app.json", "public"], { cwd: root, encoding: "utf8" }).trim();
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(hits).toBe("");
  });
});
