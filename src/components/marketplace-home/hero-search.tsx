"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass } from "@/components/ui/field-styles";

/** Ghana's sixteen administrative regions — the values the public listings API filters `region` on. */
const GHANA_REGIONS = [
  "Greater Accra", "Ashanti", "Western", "Central", "Eastern", "Volta", "Northern", "Upper East",
  "Upper West", "Bono", "Bono East", "Ahafo", "Oti", "Savannah", "North East", "Western North",
];

/** The property categories professionals list under (same keys as the listing form). */
const PROPERTY_TYPES = [
  ["APARTMENT", "Apartment"], ["HOUSE", "House"], ["TOWNHOUSE", "Townhouse"], ["VILLA", "Villa"],
  ["OFFICE", "Office"], ["SHOP", "Shop / retail"], ["WAREHOUSE", "Warehouse"], ["COMMERCIAL", "Commercial space"],
  ["GUEST_HOUSE", "Guest house"],
] as const;

type Mode = "RENT" | "SALE" | "DEVELOPMENTS" | "LAND";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "RENT", label: "Rent" },
  { key: "SALE", label: "Buy" },
  { key: "DEVELOPMENTS", label: "New developments" },
  { key: "LAND", label: "Land" },
];

/**
 * Marketplace search. Every control maps to an existing public-listings query parameter; the
 * search itself runs on /marketplace/properties, which reads these parameters from the URL.
 * "New developments" has no listing-level filter in the public API, so it opens the developer
 * directory instead of pretending to filter.
 */
export function HeroSearch() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("RENT");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    if (mode === "RENT" || mode === "SALE") params.set("listingType", mode);
    if (mode === "LAND") params.set("category", "LAND");
    const category = String(data.get("category") ?? "");
    if (category && mode !== "LAND") params.set("category", category);
    const region = String(data.get("region") ?? "");
    if (region) { params.set("country", "GH"); params.set("region", region); }
    for (const key of ["q", "minPrice", "maxPrice", "bedroomsMin"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) params.set(key, value);
    }
    router.push(`/marketplace/properties${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <div className="bg-white text-ink">
      <div aria-label="What are you looking for?" className="flex overflow-x-auto border-b border-hairline [scrollbar-width:none]" role="tablist">
        {MODES.map((item) => (
          <button
            aria-selected={mode === item.key}
            className={`relative min-h-12 shrink-0 px-3 text-sm font-semibold transition-colors sm:px-6 ${
              mode === item.key ? "text-forest-deep after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-gold sm:after:inset-x-6" : "text-muted hover:text-forest"
            }`}
            key={item.key}
            onClick={() => setMode(item.key)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === "DEVELOPMENTS" ? (
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" role="tabpanel">
          <p className="max-w-xl text-sm leading-6 text-muted">
            New-build apartments and homes are sold by developers on NesAfric. Browse developers to see their projects and available units.
          </p>
          <Link className={`${buttonClass("primary")} shrink-0`} href="/marketplace/professionals?type=DEVELOPER">Browse developers</Link>
        </div>
      ) : (
        <form aria-label="Search property" className="grid grid-cols-2 gap-3 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_auto] lg:items-end" onSubmit={submit} role="tabpanel">
          <div className="col-span-2 lg:col-span-1">
            <label className={fieldLabelClass} htmlFor="hero-region">Location</label>
            <select className={controlClass} defaultValue="" id="hero-region" name="region">
              <option value="">Anywhere in Ghana</option>
              {GHANA_REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
          </div>
          {mode !== "LAND" ? (
            <div className="col-span-2 sm:col-span-1">
              <label className={fieldLabelClass} htmlFor="hero-type">Property type</label>
              <select className={controlClass} defaultValue="" id="hero-type" name="category">
                <option value="">Any type</option>
                {PROPERTY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          ) : (
            <div className="col-span-2 sm:col-span-1">
              <label className={fieldLabelClass} htmlFor="hero-q">Keyword</label>
              <input className={controlClass} id="hero-q" name="q" placeholder="e.g. plot, beachfront" />
            </div>
          )}
          <div>
            <label className={fieldLabelClass} htmlFor="hero-min">Min price (GH₵)</label>
            <input className={controlClass} id="hero-min" inputMode="numeric" min="0" name="minPrice" placeholder="No min" type="number" />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor="hero-max">Max price (GH₵)</label>
            <input className={controlClass} id="hero-max" inputMode="numeric" min="0" name="maxPrice" placeholder="No max" type="number" />
          </div>
          {mode !== "LAND" && (
            <div>
              <label className={fieldLabelClass} htmlFor="hero-beds">Bedrooms</label>
              <select className={controlClass} defaultValue="" id="hero-beds" name="bedroomsMin">
                <option value="">Any</option>
                {[1, 2, 3, 4, 5].map((beds) => <option key={beds} value={beds}>{beds}+</option>)}
              </select>
            </div>
          )}
          <button className={`${buttonClass("primary")} col-span-2 lg:col-span-1`} type="submit">Search</button>
        </form>
      )}
    </div>
  );
}
