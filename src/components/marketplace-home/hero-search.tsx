"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass } from "@/components/ui/field-styles";

const QUICK_LINKS = [
  {
    label: "Rent",
    href: "/marketplace/properties?listingType=RENT",
    tone: "border-market-rent/45 bg-market-rent-tint text-market-rent hover:border-market-rent hover:bg-market-rent-tint",
  },
  {
    label: "Buy",
    href: "/marketplace/properties?listingType=SALE",
    tone: "border-market-sale/45 bg-market-sale-tint text-market-sale hover:border-market-sale hover:bg-market-sale-tint",
  },
  {
    label: "Land",
    href: "/marketplace/properties?category=LAND",
    tone: "border-market-land/45 bg-market-land-tint text-market-land hover:border-market-land hover:bg-market-land-tint",
  },
  {
    label: "Commercial",
    href: "/marketplace/properties?category=COMMERCIAL",
    tone: "border-market-commercial/45 bg-market-commercial-tint text-market-commercial hover:border-market-commercial hover:bg-market-commercial-tint",
  },
  {
    label: "Houses",
    href: "/marketplace/properties?category=HOUSE",
    tone: "border-market-verified/35 bg-market-verified-tint text-market-verified hover:border-market-verified",
  },
  {
    label: "Apartments",
    href: "/marketplace/properties?category=APARTMENT",
    tone: "border-market-verified/35 bg-market-verified-tint text-market-verified hover:border-market-verified",
  },
  {
    label: "Townhouses",
    href: "/marketplace/properties?category=TOWNHOUSE",
    tone: "border-market-verified/35 bg-market-verified-tint text-market-verified hover:border-market-verified",
  },
  {
    label: "Villa",
    href: "/marketplace/properties?category=VILLA",
    tone: "border-market-verified/35 bg-market-verified-tint text-market-verified hover:border-market-verified",
  },
] as const;

export function HeroSearch() {
  const router = useRouter();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const data = new FormData(event.currentTarget);
    const query = String(data.get("q") ?? "").trim();
    const params = new URLSearchParams();

    if (query) params.set("q", query);

    router.push(
      `/marketplace/properties${params.toString() ? `?${params.toString()}` : ""}`,
    );
  }

  return (
    <div>
      <form
        aria-label="Search property"
        className="flex flex-col gap-3 rounded-[var(--radius-panel)] bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:p-4"
        onSubmit={submit}
      >
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="hero-property-search">
            Search area, city or property
          </label>
          <input
            autoComplete="off"
            className={`${controlClass} min-h-12 border-0 bg-transparent text-base shadow-none focus:ring-0`}
            id="hero-property-search"
            name="q"
            placeholder="Search area, city, or property"
            type="search"
          />
        </div>

        <button
          className={`${buttonClass("primary")} min-h-12 shrink-0 sm:px-8`}
          type="submit"
        >
          Search
        </button>
      </form>

      <nav
        aria-label="Browse property categories"
        className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
      >
        {QUICK_LINKS.map((item) => (
          <Link
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-5 text-sm font-semibold shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${item.tone}`}
            href={item.href}
            key={item.label}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
