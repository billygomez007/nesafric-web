"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Tenant = {
  id: string;
  email: string | null;
  phone: string | null;
  tenant: {
    legalName: string;
    preferredName: string | null;
  };
};

const DEVELOPMENT_PREVIEW_TENANTS: Tenant[] = [
  {
    id: "preview-ama",
    email: "ama@example.com",
    phone: "+233 24 000 0001",
    tenant: {
      legalName: "Ama Mensah",
      preferredName: "Ama",
    },
  },
  {
    id: "preview-kwame",
    email: "kwame@example.com",
    phone: "+233 20 000 0002",
    tenant: {
      legalName: "Kwame Asante",
      preferredName: null,
    },
  },
  {
    id: "preview-akosua",
    email: "akosua@example.com",
    phone: "+233 55 000 0003",
    tenant: {
      legalName: "Akosua Owusu",
      preferredName: "Akosua",
    },
  },
  {
    id: "preview-kojo",
    email: null,
    phone: "+233 27 000 0004",
    tenant: {
      legalName: "Kojo Boateng",
      preferredName: null,
    },
  },
  {
    id: "preview-abena",
    email: "abena@example.com",
    phone: "+233 50 000 0005",
    tenant: {
      legalName: "Abena Ofori",
      preferredName: "Abena",
    },
  },
  {
    id: "preview-yaw",
    email: "yaw@example.com",
    phone: null,
    tenant: {
      legalName: "Yaw Addo",
      preferredName: null,
    },
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function TenantList() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const organisationId = localStorage.getItem(
      "propertyos.activeOrganisationId",
    );

    if (!organisationId) {
      if (process.env.NODE_ENV !== "production") {
        const timer = setTimeout(
          () => setTenants(DEVELOPMENT_PREVIEW_TENANTS),
          0,
        );
        return () => clearTimeout(timer);
      }

      const timer = setTimeout(
        () => setError("Choose an organisation to view tenants."),
        0,
      );
      return () => clearTimeout(timer);
    }

    fetch("/api/tenants", {
      headers: { "x-organisation-id": organisationId },
    }).then(async (response) => {
      if (response.ok) {
        setTenants(await response.json());
        return;
      }

      setError(
        (await response.json()).error?.message ?? "Unable to load tenants.",
      );
    });
  }, []);

  const filtered = useMemo(() => {
    if (!tenants) return null;

    const term = search.trim().toLowerCase();

    if (!term) return tenants;

    return tenants.filter((tenant) => {
      return (
        tenant.tenant.legalName.toLowerCase().includes(term) ||
        (tenant.tenant.preferredName ?? "").toLowerCase().includes(term) ||
        (tenant.email ?? "").toLowerCase().includes(term) ||
        (tenant.phone ?? "").toLowerCase().includes(term)
      );
    });
  }, [search, tenants]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
        {error}
      </div>
    );
  }

  if (!tenants) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div
            className="h-[210px] animate-pulse rounded-2xl border border-hairline bg-white"
            key={item}
          />
        ))}
      </div>
    );
  }

  if (!tenants.length) {
    return (
      <section className="rounded-2xl border border-dashed border-hairline bg-white px-6 py-14 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal">
          <svg
            aria-hidden="true"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <circle cx="9" cy="8" r="3" />
            <path d="M3.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6" />
            <circle cx="17" cy="9" r="2.5" />
            <path d="M15.5 14.5c3.2-.5 5 1.3 5.5 4.5" />
          </svg>
        </div>

        <h2 className="mt-4 text-lg font-semibold text-ink">No tenants yet</h2>

        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          Create your first tenant record to connect people with leases,
          payments, reminders and maintenance activity.
        </p>

        <Link
          className="mt-5 inline-flex rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-light"
          href="/tenants/new"
        >
          Add your first tenant
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-hairline bg-white p-4 shadow-[0_8px_24px_rgba(16,45,42,0.025)] sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <svg
              aria-hidden="true"
              className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>

            <input
              className="h-11 w-full rounded-xl border border-hairline bg-warm-white pl-10 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-teal focus:ring-2 focus:ring-teal/10"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tenants by name, email or phone..."
              type="search"
              value={search}
            />
          </div>

          <div className="self-start rounded-xl bg-surface px-3 py-2.5 text-xs font-medium text-muted sm:self-auto">
            {filtered?.length ?? 0}{" "}
            {(filtered?.length ?? 0) === 1 ? "tenant" : "tenants"}
          </div>
        </div>
      </section>

      {filtered && filtered.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-hairline bg-white p-10 text-center">
          <p className="text-sm font-medium text-ink">
            No tenants match your search.
          </p>
          <p className="mt-1 text-sm text-muted">
            Try searching with another name, email address or phone number.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered?.map((tenant) => {
            const displayName =
              tenant.tenant.preferredName || tenant.tenant.legalName;

            return (
              <Link
                className="group rounded-2xl border border-hairline bg-white p-5 shadow-[0_8px_24px_rgba(16,45,42,0.03)] transition hover:-translate-y-0.5 hover:border-teal/25 hover:shadow-[0_14px_34px_rgba(16,45,42,0.07)]"
                href={`/tenants/${tenant.id}`}
                key={tenant.id}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal/10 text-sm font-semibold text-teal">
                    {initials(tenant.tenant.legalName)}
                  </div>

                  <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal">
                    Tenant
                  </span>
                </div>

                <div className="mt-5">
                  <h2 className="text-base font-semibold tracking-[-0.015em] text-ink">
                    {displayName}
                  </h2>

                  {tenant.tenant.preferredName && (
                    <p className="mt-1 text-xs text-muted">
                      {tenant.tenant.legalName}
                    </p>
                  )}
                </div>

                <div className="mt-5 space-y-3 border-t border-hairline pt-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      Email
                    </p>
                    <p className="mt-1 truncate text-sm font-medium text-ink">
                      {tenant.email ?? "Not provided"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      Phone
                    </p>
                    <p className="mt-1 text-sm font-medium text-ink">
                      {tenant.phone ?? "Not provided"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-teal">
                    View tenant
                  </span>

                  <span className="text-teal transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
