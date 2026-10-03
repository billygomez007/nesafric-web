"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type PropertyServiceCategory = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  parentId?: string | null;
  parent?: {
    id: string;
    key: string;
    name: string;
    sortOrder: number;
  } | null;
};

type Props = {
  mode?: "parents" | "children";
  parentKey?: string;
  variant?: "grid" | "rail";
  limit?: number;
};

function ordered(categories: PropertyServiceCategory[]) {
  return [...categories].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export function PropertyServicesDirectory({
  mode = "parents",
  parentKey,
  variant = "grid",
  limit,
}: Props) {
  const [categories, setCategories] = useState<PropertyServiceCategory[] | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/public/marketplace/categories", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load property service categories.");
        }

        setCategories(await response.json());
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to load property service categories.",
        );
      });

    return () => controller.abort();
  }, []);

  const visible = useMemo(() => {
    if (!categories) return [];

    if (mode === "parents") {
      const excludedParentNames = new Set([
        "Surveying, Valuation & Planning",
        "Moving, Relocation & Storage",
        "Legal Documentation",
      ]);

      const parents = ordered(
        categories.filter(
          (category) =>
            category.parentId === null &&
            !excludedParentNames.has(category.name),
        ),
      );

      return typeof limit === "number" ? parents.slice(0, limit) : parents;
    }

    const parent = categories.find(
      (category) => category.parentId === null && category.key === parentKey,
    );

    if (!parent) return [];

    return ordered(
      categories.filter((category) => category.parentId === parent.id),
    );
  }, [categories, mode, parentKey, limit]);

  if (error) {
    return (
      <p
        className="rounded-xl border border-hairline bg-white p-5 text-sm text-muted"
        role="status"
      >
        {error}
      </p>
    );
  }

  if (!categories) {
    return (
      <p className="text-sm text-muted" role="status">
        Loading property services…
      </p>
    );
  }

  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-hairline bg-white p-5 text-sm text-muted">
        No property service categories are available yet.
      </p>
    );
  }

  const rail = variant === "rail";

  return (
    <ul
      aria-label={
        mode === "parents"
          ? "Property service categories"
          : "Property service subcategories"
      }
      className={
        rail
          ? "grid grid-flow-col grid-rows-2 auto-cols-[minmax(220px,280px)] gap-3 overflow-x-auto pb-2"
          : "grid gap-px overflow-hidden rounded-2xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3"
      }
    >
      {visible.map((category) => (
        <li
          className={rail ? "min-w-0" : "bg-white"}
          key={category.id}
        >
          <Link
            className={
              rail
                ? "group flex min-h-[88px] items-center justify-between gap-4 rounded-2xl border border-hairline bg-white px-5 py-4 shadow-sm transition hover:border-forest/30 hover:bg-warm-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                : "group flex h-full min-h-36 flex-col justify-between gap-5 p-6 transition hover:bg-warm-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest"
            }
            href={
              mode === "parents"
                ? `/marketplace/services/category/${encodeURIComponent(category.key)}`
                : `/marketplace/services?category=${encodeURIComponent(category.key)}`
            }
          >
            <span className={rail ? "text-base font-semibold leading-snug text-forest-deep" : ""}>
              <span
                className={
                  rail
                    ? "block"
                    : "block text-lg font-semibold tracking-[-0.01em] text-forest-deep group-hover:underline"
                }
              >
                {category.name}
              </span>

              {!rail && category.description ? (
                <span className="mt-2 block text-sm leading-6 text-muted">
                  {category.description}
                </span>
              ) : null}
            </span>

            <span
              aria-hidden="true"
              className="shrink-0 text-sm font-semibold text-forest transition group-hover:translate-x-1"
            >
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
