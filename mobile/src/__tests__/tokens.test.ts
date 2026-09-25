/// <reference types="node" />
import { readFileSync } from "fs";
import { join } from "path";

import { parseStoredSaves } from "@/marketplace/saved";
import { webCssVariables } from "@/theme/tokens";

describe("design tokens", () => {
  it("match the web design system in src/app/globals.css", () => {
    const css = readFileSync(join(__dirname, "../../../src/app/globals.css"), "utf8");
    for (const [name, value] of Object.entries(webCssVariables)) {
      const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
      expect({ name, value: match?.[1].trim().toLowerCase() }).toEqual({ name, value });
    }
  });
});

describe("saved listings storage", () => {
  it("tolerates missing or corrupt stored data", () => {
    expect(parseStoredSaves(null)).toEqual([]);
    expect(parseStoredSaves("{not json")).toEqual([]);
    expect(parseStoredSaves('{"a":1}')).toEqual([]);
    expect(parseStoredSaves('[{"listing":{"id":"x"},"savedAt":"t"},{"bad":true}]')).toEqual([{ listing: { id: "x" }, savedAt: "t" }]);
  });
});
