import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Property Services hierarchy", () => {
  const seed = read("prisma/seed.ts");
  const servicesPage = read("src/app/marketplace/services/page.tsx");
  const categoryPage = read(
    "src/app/marketplace/services/category/[key]/page.tsx",
  );
  const directory = read("src/components/property-services-directory.tsx");
  const search = read("src/components/marketplace-search.tsx");

  const approvedParents = [
    "Construction & Building Works",
    "Repairs & Maintenance",
    "Cleaning & Property Care",
    "Landscaping & Outdoor Services",
    "Security, Access & Safety",
    "Energy, Power & Utilities",
    "Interior Design & Fit-Out",
    "Architecture, Engineering & Technical Services",
    "Surveying, Valuation & Planning",
    "Moving, Relocation & Storage",
    "Legal, Documentation & Compliance Services",
  ];

  it("seeds exactly the eleven approved top-level categories", () => {
    const block = seed.match(
      /const propertyServiceGroups = \[([\s\S]*?)\] as const;/,
    );

    expect(block).not.toBeNull();

    const parentRows =
      block?.[1].match(
        /\["property_services_[^"]+",\s*"[^"]+",\s*\d+\]/g,
      ) ?? [];

    expect(parentRows).toHaveLength(11);

    for (const name of approvedParents) {
      expect(block?.[1]).toContain(`"${name}"`);
    }
  });

  it("keeps top-level categories as navigation-only nodes", () => {
    expect(seed).toContain("parentId: null");
    expect(seed).toContain("onboardingSelectable: false");
    expect(directory).toContain("category.parentId === null");
    expect(directory).toContain(
      "/marketplace/services/category/${encodeURIComponent(category.key)}",
    );
  });

  it("uses leaf services for provider search", () => {
    expect(directory).toContain(
      "/marketplace/services?category=${encodeURIComponent(category.key)}",
    );
    expect(search).toContain(
      "categories.filter((category) => category.parentId !== null)",
    );
  });

  it("uses the approved service marketplace customer-facing copy", () => {
    expect(servicesPage).toContain("Find your perfect professional");
    expect(servicesPage).toContain(
      "Search trusted professionals and companies for your property.",
    );
  });

  it("has a dedicated category route and breadcrumb", () => {
    expect(categoryPage).toContain('href="/marketplace/services"');
    expect(categoryPage).toContain("Property Services");
    expect(categoryPage).toContain(
      '<PropertyServicesDirectory mode="children" parentKey={category.key} />',
    );
  });
  it("uses the authoritative parent category name instead of deriving it from the URL key", () => {
    expect(categoryPage).toContain(
      "listPubliclyVisibleServiceCategories",
    );
    expect(categoryPage).toContain("category.name");
    expect(categoryPage).toContain("category.parentId === null");
    expect(categoryPage).toContain("notFound()");
    expect(categoryPage).not.toContain("titleFromKey");
  });


  it("does not fabricate a category description when the database has none", () => {
    expect(categoryPage).toContain("category.description ?? undefined");
    expect(categoryPage).not.toContain(
      "professionals and companies on NesAfric Property Services",
    );
  });


  it("preserves the main-category to subcategory to provider navigation contract", () => {
    const directory = read("src/components/property-services-directory.tsx");
    const search = read("src/components/marketplace-search.tsx");
    const categoryPage = read(
      "src/app/marketplace/services/category/[key]/page.tsx",
    );

    expect(directory).toContain("/marketplace/services/category/");
    expect(directory).toContain("/marketplace/services?category=");
    expect(search).toContain("/marketplace/services/");
    expect(categoryPage).toContain("Property Services");
  });

});
