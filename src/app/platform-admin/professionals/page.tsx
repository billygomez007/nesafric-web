"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";
import { buttonClass } from "@/components/ui/button-styles";
import { MarketplaceLogoUploader } from "@/components/marketplace-logo-uploader";
import {
  AccountBadge,
  HomepageBadge,
  LifecycleActionButtons,
  LifecycleDialog,
  performLifecycleAction,
  successMessage,
  useLifecyclePermissions,
  VerificationBadge,
} from "@/components/platform-admin/professional-lifecycle";
import {
  homepageIneligibilityReason,
  isArchived,
  isHomepageCompanyType,
  professionalLifecycleActions,
  type LifecycleAction,
} from "@/modules/marketplace-professionals/admin-lifecycle";

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
  homepageCompanyLogos: Array<{ id: string; isPublished: boolean; sortOrder: number }>;
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

type DirectoryFilter = "TOTAL" | "UNVERIFIED" | "VERIFIED" | "PENDING" | "SUSPENDED";

function homepageState(professional: ProfessionalRow) {
  const item = professional.homepageCompanyLogos?.[0];
  if (!item) return "none" as const;
  return item.isPublished ? ("published" as const) : ("hidden" as const);
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function ProfessionalsContent() {
  const [professionals, setProfessionals] = useState<ProfessionalRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [filter, setFilter] = useState<DirectoryFilter>("TOTAL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ professional: ProfessionalRow; action: LifecycleAction } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const permissions = useLifecyclePermissions();
  // Derived from the list so the drawer always reflects the latest reload.
  const selected = professionals.find((professional) => professional.id === selectedId) ?? null;

  const loadProfessionals = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams({ take: "100" });

      if (activeSearch.trim()) {
        params.set("search", activeSearch.trim());
      }

      const response = await fetch(
        `/api/platform-admin/professionals?${params.toString()}`,
        { signal },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error?.message ?? "Unable to load Marketplace Professionals.",
        );
      }

      setProfessionals(body as ProfessionalRow[]);
      setError("");
    },
    [activeSearch],
  );

  useEffect(() => {
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      loadProfessionals(controller.signal)
        .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load Marketplace Professionals.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadProfessionals]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setActiveSearch(search);
  }

  const unverified = professionals.filter(
    (professional) => professional.verificationStatus === "UNVERIFIED",
  ).length;

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

  const visibleProfessionals = useMemo(() => {
    switch (filter) {
      case "UNVERIFIED":
        return professionals.filter(
          (professional) => professional.verificationStatus === "UNVERIFIED",
        );
      case "VERIFIED":
        return professionals.filter(
          (professional) => professional.verificationStatus === "VERIFIED",
        );
      case "PENDING":
        return professionals.filter(
          (professional) => professional.verificationStatus === "PENDING",
        );
      case "SUSPENDED":
        return professionals.filter(
          (professional) =>
            professional.status === "SUSPENDED" ||
            professional.verificationStatus === "SUSPENDED",
        );
      default:
        return professionals;
    }
  }, [filter, professionals]);

  const cards: Array<{
    key: DirectoryFilter;
    label: string;
    count: number;
  }> = [
    { key: "TOTAL", label: "Total", count: professionals.length },
    { key: "UNVERIFIED", label: "Unverified", count: unverified },
    { key: "VERIFIED", label: "Verified", count: verified },
    { key: "PENDING", label: "Pending", count: pending },
    { key: "SUSPENDED", label: "Suspended", count: suspended },
  ];

  function openReview(professional: ProfessionalRow) {
    setSelectedId(professional.id);
    setError("");
    setSuccess("");
  }

  function closeReview() {
    if (pendingAction) return;
    setSelectedId(null);
  }

  /** Homepage additions need no reason, so they run directly; every status change opens the
   * confirmation dialog first. */
  async function selectAction(professional: ProfessionalRow, action: LifecycleAction) {
    setError("");
    setSuccess("");
    if (action.kind !== "add_to_homepage") {
      setPendingAction({ professional, action });
      return;
    }
    setBusyId(professional.id);
    try {
      await performLifecycleAction(professional, action, "");
      setSuccess(successMessage(professional, action));
      await loadProfessionals();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add this company to the homepage.");
    } finally {
      setBusyId(null);
    }
  }

  async function actionDone(message: string) {
    setPendingAction(null);
    setSuccess(message);
    try {
      await loadProfessionals();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reload Marketplace Professionals.");
    }
  }

  function actionsFor(professional: ProfessionalRow) {
    return professionalLifecycleActions(professional, permissions, {
      onHomepage: homepageState(professional) !== "none",
    });
  }

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Property marketplace
        </p>

        <div className="mt-2">
          <h2 className="text-2xl font-semibold text-forest">
            Real Estate Professionals
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Review marketplace professionals, manage trust decisions and monitor
            the companies and professionals operating across NesAfric.
          </p>
        </div>
      </section>

      <section
        aria-label="Professional directory filters"
        className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5"
      >
        {cards.map((card) => {
          const active = filter === card.key;

          return (
            <button
              aria-pressed={active}
              className={`rounded-xl border p-4 text-left shadow-card transition focus:outline-none focus:ring-2 focus:ring-teal/30 ${
                active
                  ? "border-teal bg-teal/5"
                  : "border-hairline bg-white hover:border-teal/40"
              }`}
              key={card.key}
              onClick={() => setFilter(card.key)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {card.label}
                </p>
                {active && (
                  <span className="rounded-full bg-teal/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-teal">
                    Active
                  </span>
                )}
              </div>

              <p className="mt-2 text-3xl font-semibold text-forest">
                {card.count}
              </p>
            </button>
          );
        })}
      </section>

      <form
        className="flex flex-col gap-3 rounded-xl border border-hairline bg-white p-4 shadow-card sm:flex-row"
        onSubmit={submit}
      >
        <input
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10"
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
            className="rounded-lg border border-hairline px-5 py-2.5 text-sm font-semibold text-forest transition hover:border-teal"
            onClick={() => {
              setSearch("");
              setActiveSearch("");
              setError("");
            }}
            type="button"
          >
            Clear
          </button>
        )}
      </form>

      {success && (
        <p className="rounded-xl border border-emerald/20 bg-emerald/5 p-4 text-sm font-medium text-forest">
          {success}
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading professionals…</p>
      ) : visibleProfessionals.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <h3 className="font-semibold text-forest">
            No {filter === "TOTAL" ? "" : humanize(filter).toLowerCase() + " "}
            professionals found
          </h3>
          <p className="mt-2 text-sm text-muted">
            Change the directory filter or search for another professional.
          </p>

          {filter !== "TOTAL" && (
            <button
              className="mt-4 rounded-lg border border-hairline px-4 py-2 text-sm font-semibold text-forest"
              onClick={() => setFilter("TOTAL")}
              type="button"
            >
              View all professionals
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <div>
              <h3 className="font-semibold text-forest">
                {filter === "TOTAL" ? "All professionals" : humanize(filter)}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {visibleProfessionals.length} record
                {visibleProfessionals.length === 1 ? "" : "s"} shown
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4 font-semibold">Professional</th>
                  <th className="px-5 py-4 font-semibold">Type</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Team</th>
                  <th className="px-5 py-4 font-semibold">Marketplace</th>
                  <th className="px-5 py-4 font-semibold">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {visibleProfessionals.map((professional) => (
                  <tr
                    className="align-top transition hover:bg-warm-white/60"
                    key={professional.id}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        {professional.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt=""
                            className="h-10 w-10 rounded-lg border border-hairline bg-white object-contain p-1"
                            src={professional.logoUrl}
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-forest/5 text-sm font-semibold text-forest">
                            {professional.displayName.slice(0, 2).toUpperCase()}
                          </div>
                        )}

                        <div>
                          <button
                            className="text-left font-semibold text-forest transition hover:text-teal focus:outline-none focus:underline"
                            onClick={() => openReview(professional)}
                            type="button"
                          >
                            {professional.displayName}
                          </button>

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
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-xs font-semibold text-forest">
                        {humanize(professional.type)}
                      </span>
                      <p className="mt-2 text-xs text-muted">
                        {professional.countryCode}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <AccountBadge status={professional.archivedAt ? "ARCHIVED" : professional.status} />
                        <VerificationBadge status={professional.verificationStatus} />
                        {isHomepageCompanyType(professional.type) && (
                          <HomepageBadge state={homepageState(professional)} />
                        )}
                      </div>
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
                      <p className="mt-2 text-muted">
                        {professional.subscription
                          ? `${professional.subscription.plan.name} · ${humanize(professional.subscription.status).toLowerCase()}`
                          : "No plan"}
                      </p>
                      <p className="mt-1 text-muted">Joined {formatDate(professional.createdAt)}</p>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex w-56 flex-wrap gap-2">
                        <LifecycleActionButtons
                          actions={actionsFor(professional)}
                          disabled={busyId === professional.id}
                          onSelect={(action) => void selectAction(professional, action)}
                        />
                        <button
                          className={buttonClass("tertiary")}
                          onClick={() => openReview(professional)}
                          type="button"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div
          aria-label={`Review ${selected.displayName}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex justify-end bg-forest/30 backdrop-blur-[1px]"
          role="dialog"
        >
          <button
            aria-label="Close professional review"
            className="absolute inset-0 cursor-default"
            disabled={Boolean(pendingAction)}
            onClick={closeReview}
            type="button"
          />

          <aside className="relative z-10 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-hairline bg-white px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
                  Professional review
                </p>
                <h3 className="mt-1 text-xl font-semibold text-forest">
                  {selected.displayName}
                </h3>
              </div>

              <button
                className="rounded-lg border border-hairline px-3 py-2 text-sm font-semibold text-forest"
                disabled={Boolean(pendingAction)}
                onClick={closeReview}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-6">
              <section className="rounded-xl border border-hairline p-5">
                <div className="flex items-start gap-4">
                  {selected.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${selected.displayName} logo`}
                      className="h-16 w-16 rounded-xl border border-hairline object-contain p-2"
                      src={selected.logoUrl}
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-forest/5 text-lg font-semibold text-forest">
                      {selected.displayName.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-forest">
                      {selected.displayName}
                    </h4>
                    {selected.legalName && (
                      <p className="mt-1 text-sm text-muted">
                        {selected.legalName}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <AccountBadge status={selected.archivedAt ? "ARCHIVED" : selected.status} />
                      <VerificationBadge status={selected.verificationStatus} />
                      <span className="rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink">
                        {humanize(selected.type)}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-forest">Branding</h4>
                <p className="mt-1 text-xs leading-5 text-muted">
                  The company&apos;s own profile logo. The business can also change it from its
                  workspace; both edit the same logo, used on the public profile and homepage rail.
                </p>
                <div className="mt-3 rounded-xl border border-hairline p-5">
                  <MarketplaceLogoUploader
                    canEdit={permissions.canVerify && !isArchived(selected)}
                    endpoint={`/api/platform-admin/professionals/${selected.id}/logo`}
                    logoUrl={selected.logoUrl}
                    name={selected.displayName}
                    onChange={(logoUrl) =>
                      setProfessionals((current) =>
                        current.map((professional) =>
                          professional.id === selected.id ? { ...professional, logoUrl } : professional,
                        ),
                      )
                    }
                  />
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-forest">Identity</h4>
                <dl className="mt-3 grid gap-4 rounded-xl border border-hairline p-5 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Slug</dt>
                    <dd className="mt-1 text-sm text-forest">{selected.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Country</dt>
                    <dd className="mt-1 text-sm text-forest">{selected.countryCode}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Email</dt>
                    <dd className="mt-1 break-all text-sm text-forest">
                      {selected.contactEmail ?? "Not provided"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Phone</dt>
                    <dd className="mt-1 text-sm text-forest">
                      {selected.contactPhone ?? "Not provided"}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-forest">Marketplace</h4>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {[
                    ["Listings", selected._count.listings],
                    ["Developments", selected._count.developments],
                    ["Campaigns", selected._count.campaigns],
                    ["AI employees", selected._count.aiemployees],
                    ["Team", selected._count.members],
                  ].map(([label, value]) => (
                    <div
                      className="rounded-xl border border-hairline bg-warm-white p-3"
                      key={String(label)}
                    >
                      <p className="text-xl font-semibold text-forest">{value}</p>
                      <p className="mt-1 text-xs text-muted">{label}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-forest">Profile</h4>
                <div className="mt-3 grid gap-4 rounded-xl border border-hairline p-5">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted">
                      Specialities
                    </p>
                    <p className="mt-1 text-sm text-forest">
                      {selected.specialities.length
                        ? selected.specialities.join(", ")
                        : "None provided"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted">
                      Services
                    </p>
                    <p className="mt-1 text-sm text-forest">
                      {selected.servicesOffered.length
                        ? selected.servicesOffered.join(", ")
                        : "None provided"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted">
                      Service areas
                    </p>
                    <p className="mt-1 text-sm text-forest">
                      {selected.serviceAreas.length
                        ? selected.serviceAreas.join(", ")
                        : "None provided"}
                    </p>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-forest">Trust and account</h4>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Verification and account status are separate. Rejecting or suspending needs a
                  reason; every change is recorded in the verification history and audit log.
                </p>
                <dl className="mt-3 grid gap-3 rounded-xl border border-hairline p-4 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted">Account status</dt>
                    <dd className="mt-1"><AccountBadge status={selected.archivedAt ? "ARCHIVED" : selected.status} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Verification status</dt>
                    <dd className="mt-1"><VerificationBadge status={selected.verificationStatus} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Homepage</dt>
                    <dd className="mt-1">
                      {isHomepageCompanyType(selected.type)
                        ? <HomepageBadge state={homepageState(selected)} />
                        : <span className="text-xs text-muted">Not eligible (not a company)</span>}
                    </dd>
                  </div>
                </dl>
                {isHomepageCompanyType(selected.type) && homepageState(selected) === "none" && homepageIneligibilityReason(selected) && (
                  <p className="mt-2 text-xs text-muted">
                    Homepage: {homepageIneligibilityReason(selected)}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {isArchived(selected) ? (
                    <p className="text-sm text-muted">Archived profiles are read-only. Restoring an archived profile is not supported.</p>
                  ) : actionsFor(selected).length === 0 ? (
                    <p className="text-sm text-muted">Your platform role cannot change this profile.</p>
                  ) : (
                    <LifecycleActionButtons
                      actions={actionsFor(selected)}
                      disabled={busyId === selected.id}
                      onSelect={(action) => void selectAction(selected, action)}
                      size="md"
                    />
                  )}
                </div>
              </section>

              <section className="flex flex-wrap items-center gap-3 border-t border-hairline pt-5">
                <Link
                  className="rounded-lg border border-hairline px-4 py-2 text-sm font-semibold text-forest"
                  href={`/marketplace/professionals/${selected.slug}`}
                  target="_blank"
                >
                  View public profile ↗
                </Link>

                <p className="text-xs text-muted">
                  Created {formatDate(selected.createdAt)}
                </p>
              </section>
            </div>
          </aside>
        </div>
      )}

      {pendingAction && (
        <LifecycleDialog
          action={pendingAction.action}
          onClose={() => setPendingAction(null)}
          onDone={(message) => actionDone(message)}
          professional={pendingAction.professional}
        />
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
