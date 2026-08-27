import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const globalsCss = readFileSync(path.join(root, "src/app/globals.css"), "utf-8");

function listTsxFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listTsxFiles(relative));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(relative);
  }
  return files;
}

// Files that legitimately render text-slate-300/400 because it sits on an explicit dark
// background (a bg-slate-950 hero/header or chat bubble), not because it relies on the shared
// light-surface tokens under test here.
const DARK_SURFACE_FILES = new Set([
  "src/components/homepage-announcement-bar.tsx", // dark bg-slate-950 dismissible bar
  "src/components/ai-property-manager.tsx", // "YOU" label inside a dark chat bubble
  "src/components/marketplace-directory.tsx", // dark bg-slate-950 page header
  "src/app/marketplace/page.tsx", // dark bg-slate-950 page header
  "src/app/marketplace/professionals/[slug]/page.tsx", // dark bg-slate-950 page header
  "src/components/marketplace-carousel.tsx", // dark bg-slate-950 campaign carousel slides
  "src/components/marketplace-banner.tsx", // dark bg-navy campaign hero banner
  "src/app/marketplace/properties/page.tsx", // dark bg-navy page header
]);

const ALL_APP_TSX_FILES = listTsxFiles("src")
  .filter((file) => !file.startsWith("src/components/marketing/"));

// The disabled-control check applies regardless of surface color, so it covers dark-surface files
// too; only the muted-text-color check needs the narrower, dark-surface-excluded list.
const LIGHT_SURFACE_TSX_FILES = ALL_APP_TSX_FILES.filter((file) => !DARK_SURFACE_FILES.has(file));

describe("shared theme tokens (regression guard for the platform-wide contrast fix)", () => {
  it("pins color-scheme to light so native form controls (select/option, checkboxes, date pickers) never render in OS dark styling", () => {
    expect(globalsCss).toMatch(/color-scheme:\s*light/);
  });

  it("does not auto-flip --foreground/--background off prefers-color-scheme: dark", () => {
    // Regression guard: this media query previously flipped --foreground to near-white while
    // explicit `bg-white` cards stayed white, making body-inherited text invisible for any
    // visitor whose OS was set to dark mode (the reported Marketplace Professional dashboard bug).
    expect(globalsCss).not.toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });

  it("defines a single, permanent light foreground/background pair", () => {
    expect(globalsCss).toMatch(/--background:\s*#ffffff/);
    expect(globalsCss).toMatch(/--foreground:\s*#171717/);
  });
});

describe("disabled-control contrast (regression guard)", () => {
  it("never fades a disabled control via opacity alone", () => {
    // opacity-based disabled state blends both the control's background AND its text toward the
    // page background at the same rate, which can wash filled buttons out to near-unreadable
    // text-on-pale-box combinations. Every disabled control in the app must instead set an
    // explicit muted background/text pair (see AGENTS history: platform-wide contrast audit).
    const offenders: string[] = [];
    for (const file of ALL_APP_TSX_FILES) {
      const source = readFileSync(path.join(root, file), "utf-8");
      if (/disabled:opacity-\d+/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("secondary/muted text contrast (regression guard)", () => {
  it("never uses text-slate-300/400 for text on a light surface", () => {
    // slate-300/slate-400 on a white or near-white surface fall well below WCAG AA (~1.9:1 and
    // ~2.6:1 respectively). Muted text on light surfaces must use slate-500 or darker.
    const offenders: string[] = [];
    for (const file of LIGHT_SURFACE_TSX_FILES) {
      const source = readFileSync(path.join(root, file), "utf-8");
      if (/text-slate-(300|400)\b/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
