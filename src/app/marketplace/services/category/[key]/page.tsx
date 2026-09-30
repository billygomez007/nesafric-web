import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketplaceSubnav } from "@/components/marketplace-subnav";
import { PropertyServicesDirectory } from "@/components/property-services-directory";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { listPubliclyVisibleServiceCategories } from "@/modules/providers/service";

async function getParentCategory(key: string) {
  const categories = await listPubliclyVisibleServiceCategories();

  return (
    categories.find(
      (category) => category.parentId === null && category.key === key,
    ) ?? null
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ key: string }>;
}): Promise<Metadata> {
  const { key } = await params;
  const category = await getParentCategory(key);

  if (!category) {
    return {
      title: "Property Services | NesAfric",
    };
  }

  return {
    title: `${category.name} | Property Services | NesAfric`,
    description: category.description ?? undefined,
  };
}

export default async function PropertyServicesCategoryPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const category = await getParentCategory(key);

  if (!category) {
    notFound();
  }

  return (
    <>
      <SiteNav />
      <MarketplaceSubnav />

      <main className="min-h-screen bg-surface">
        <section className="border-b border-hairline bg-white">
          <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap items-center gap-2 text-sm text-muted"
            >
              <Link
                className="font-medium transition hover:text-forest"
                href="/marketplace/services"
              >
                Property Services
              </Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page" className="text-forest">
                {category.name}
              </span>
            </nav>

            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-forest sm:text-4xl">
              {category.name}
            </h1>

            {category.description ? (
              <p className="mt-3 max-w-3xl text-base leading-7 text-muted">
                {category.description}
              </p>
            ) : null}
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <PropertyServicesDirectory mode="children" parentKey={category.key} />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
