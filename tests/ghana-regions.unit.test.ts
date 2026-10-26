import { describe, expect, it } from "vitest";
import { regionSpellings } from "@/lib/ghana-regions";

describe("Ghana region spellings", () => {
  it("matches a region by its name, code, older name or with Region after it", () => {
    for (const asked of ["Greater Accra", "GA", "greater accra region", " Accra "]) {
      expect(regionSpellings(asked)).toEqual(expect.arrayContaining(["greater accra", "ga", "accra", "greater accra region"]));
    }
    expect(regionSpellings("Brong Ahafo")).toEqual(expect.arrayContaining(["bono", "brong ahafo"]));
    expect(regionSpellings("Ashanti")).not.toContain("greater accra");
  });

  it("leaves anything else as it is", () => {
    expect(regionSpellings("Lagos")).toEqual(["lagos"]);
  });
});
