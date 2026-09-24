"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type ProfessionalRow = {
  id: string;
  type: string;
  displayName: string;
  legalName: string | null;
  slug: string;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string;
  specialities: string[];
  servicesOffered: string[];
  serviceAreas: string[];
  status: string;
  verificationStatus: string;
  createdAt: string;
  archivedAt: string | null;
  subscription: {
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    plan: {
      key: string;
      name: string;
    };
  } | null;
  members: Array<{
    id: string;
    role: string;
    status: string;
    user: {
      id: string;
      displayName: string;
      email: string;
    };
  }>;
  _count: {
    members: number;
    listings: number;
    developments: number;
    campaigns: number;
    aiemployees: number;
  };
};

function verificationStyle(status: string) {
  switch (status) {
    case "VERIFIED":
      return "bg-emerald/10 text-emerald";
    case "PENDING":
      return "bg-gold/15 text-forest";
    case "REJECTED":
    case "SUSPENDED":
      return "bg-red-50 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function ProfessionalsContent() {
  const [professionals, setProfessionals] = useState<ProfessionalRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ take: "100" });

    if (activeSearch.trim()) {
      params.set("search", activeSearch.trim());
    }

    fetch(`/api/platform-admin/professionals?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ??
              "Unable to load Marketplace Professionals.",
          );
        }

        return body as ProfessionalRow[];
      })
      .then((body) => {
        setProfessionals(body);
        setError("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load Marketplace Professionals.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [activeSearch]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setActiveSearch(search);
  }

  const verified = professionals.filter(
    (professional) => professional.verificationStatus === "VERIFIED",
  ).length;

  const pending = professionals.filter(
    (professional) => professional.verificationStatus === "PENDING",
  ).length;

  const suspended = professionals.filter(
    (professional) =>
      professional.status === "SUSPENDED" ||
      professional.verificationStatus === "SUSPENDED",
  ).length;

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Property marketplace
        </p>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-forest">
              Real Estate Professionals
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Platform oversight for agents, brokers, brokerages, developers,
              real estate companies and property marketing companies.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">Total</p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {professionals.length}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Verified
              </p>
              <p className="mt-1 text-2xl font-semibold text-forest">{verified}</p>
            </div>

            <div className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Pending
              </p>
              <p className="mt-1 text-2xl font-semibold text-forest">{pending}</p>
            </div>

            <div className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
              <p className="text-xs uppercase tracking-wider text-muted">
                Suspended
              </p>
              <p className="mt-1 text-2xl font-semibold text-forest">
                {suspended}
              </p>
            </div>
          </div>
        </div>
      </section>

      <form
        className="flex flex-col gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card sm:flex-row"
        onSubmit={submit}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm outline-none focus:border-teal"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search business, agent, email or slug"
          value={search}
        />

        <button
          className="rounded-lg bg-forest px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald"
          type="submit"
        >
          Search
        </button>

        {(activeSearch || search) && (
          <button
            className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-semibold text-forest"
            onClick={() => {
              setLoading(true);
              setError("");
              setSearch("");
              setActiveSearch("");
            }}
            type="button"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading professionals…</p>
      ) : professionals.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <h3 className="font-semibold text-forest">No professionals found</h3>
          <p className="mt-2 text-sm text-muted">
            Try another business name, agent name or email.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4 font-semibold">Professional</th>
                  <th className="px-5 py-4 font-semibold">Type</th>
                  <th className="px-5 py-4 font-semibold">Verification</th>
                  <th className="px-5 py-4 font-semibold">Team</th>
                  <th className="px-5 py-4 font-semibold">Marketplace</th>
                  <th className="px-5 py-4 font-semibold">Plan</th>
                  <th className="px-5 py-4 font-semibold">Created</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {professionals.map((professional) => (
                  <tr
                    className="align-top hover:bg-warm-white/60"
                    key={professional.id}
                  >
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {professional.displayName}
                      </p>

                      {professional.legalName &&
                        professional.legalName !== professional.displayName && (
                          <p className="mt-1 text-xs text-muted">
                            {professional.legalName}
                          </p>
                        )}

                      <p className="mt-1 text-xs text-muted">
                        {professional.contactEmail ?? "No email"}
                      </p>

                      <Link
                        className="mt-2 inline-block text-xs font-semibold text-teal"
                        href={`/marketplace/professionals/${professional.slug}`}
                        target="_blank"
                      >
                        Public profile ↗
                      </Link>
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-xs font-semibold text-forest">
                        {professional.type.replaceAll("_", " ")}
                      </span>
                      <p className="mt-2 text-xs text-muted">
                        {professional.countryCode}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${verificationStyle(
                          professional.verificationStatus,
                        )}`}
                      >
                        {professional.verificationStatus.replaceAll("_", " ")}
                      </span>

                      <p className="mt-2 text-xs text-muted">
                        Account: {professional.status.replaceAll("_", " ")}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {professional._count.members} member
                        {professional._count.members === 1 ? "" : "s"}
                      </p>

                      <div className="mt-2 grid gap-1">
                        {professional.members.slice(0, 2).map((member) => (
                          <p className="text-xs text-muted" key={member.id}>
                            {member.user.displayName} · {member.role}
                          </p>
                        ))}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-xs">
                      <p>
                        <span className="font-semibold text-forest">
                          {professional._count.listings}
                        </span>{" "}
                        listings
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-forest">
                          {professional._count.developments}
                        </span>{" "}
                        developments
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-forest">
                          {professional._count.campaigns}
                        </span>{" "}
                        campaigns
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-forest">
                          {professional._count.aiemployees}
                        </span>{" "}
                        AI employees
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      {professional.subscription ? (
                        <>
                          <p className="font-semibold text-forest">
                            {professional.subscription.plan.name}
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            {professional.subscription.status}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted">No plan</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(professional.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformAdminProfessionalsPage() {
  return (
    <PlatformAdminShell>
      <ProfessionalsContent />
    </PlatformAdminShell>
  );
}
