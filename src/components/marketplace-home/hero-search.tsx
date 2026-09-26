"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass } from "@/components/ui/field-styles";

const QUICK_LINKS = [
  { label: "Rent", href: "/marketplace/properties?listingType=RENT" },
  { label: "Buy", href: "/marketplace/properties?listingType=SALE" },
  { label: "Land", href: "/marketplace/properties?category=LAND" },
  { label: "Commercial", href: "/marketplace/properties?category=COMMERCIAL" },
  { label: "Houses", href: "/marketplace/properties?category=HOUSE" },
  { label: "Apartments", href: "/marketplace/properties?category=APARTMENT" },
  { label: "Townhouses", href: "/marketplace/properties?category=TOWNHOUSE" },
  { label: "Villa", href: "/marketplace/properties?category=VILLA" },
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
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white transition hover:border-gold-soft/60 hover:bg-white/15 hover:text-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-soft"
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
