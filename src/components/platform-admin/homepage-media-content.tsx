"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { MarketplaceLogoUploader } from "@/components/marketplace-logo-uploader";
import { buttonClass } from "@/components/ui/button-styles";
import { controlClass, fieldLabelClass, textareaClass } from "@/components/ui/field-styles";
import { ErrorState, LoadingState, SuccessNotice } from "@/components/ui/states";
import {
  AccountBadge,
  CompanyLogo,
  HomepageBadge,
  humanizeStatus,
  LifecycleActionButtons,
  LifecycleDialog,
  performLifecycleAction,
  successMessage,
  VerificationBadge,
} from "@/components/platform-admin/professional-lifecycle";
import {
  homepageIneligibilityReason,
  isArchived,
  isHomepageEligible,
  professionalLifecycleActions,
  type LifecycleAction,
  type LifecyclePermissions,
} from "@/modules/marketplace-professionals/admin-lifecycle";

type Company = {
  id: string;
  displayName: string;
  legalName?: string | null;
  slug: string;
  logoUrl?: string | null;
  type: string;
  status: string;
  verificationStatus: string;
  archivedAt?: string | null;
};

type Candidate = Company & {
  homepageCompanyLogos: Array<{ id: string; isPublished: boolean; sortOrder: number }>;
};

type RailItem = {
  id: string;
  marketplaceProfessionalId: string;
  isPublished: boolean;
  sortOrder: number;
  marketplaceProfessional: Company;
};

type MediaPayload = {
  items: RailItem[];
  candidates: Candidate[];
  permissions: LifecyclePermissions;
};

type CompanyFilter = "ALL" | "READY" | "NEEDS_VERIFICATION" | "INACTIVE";

const FILTERS: Array<{ key: CompanyFilter; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "READY", label: "Ready to feature" },
  { key: "NEEDS_VERIFICATION", label: "Needs verification" },
  { key: "INACTIVE", label: "Suspended or archived" },
];

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function matches(company: Company, term: string) {
  if (!term) return true;
  return [company.displayName, company.legalName, company.slug, company.type]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term));
}

function inFilter(company: Company, filter: CompanyFilter) {
  switch (filter) {
    case "READY": return isHomepageEligible(company);
    case "NEEDS_VERIFICATION": return !isArchived(company) && company.verificationStatus !== "VERIFIED";
    case "INACTIVE": return isArchived(company) || company.status !== "ACTIVE";
    default: return true;
  }
}

export function HomepageMediaContent() {
  const [data, setData] = useState<MediaPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<{ company: Company; action: LifecycleAction } | null>(null);
  const [removing, setRemoving] = useState<RailItem | null>(null);
  const [logoCompany, setLogoCompany] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CompanyFilter>("ALL");

  const fetchMedia = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/platform-admin/homepage-media", { cache: "no-store", signal });
    if (!response.ok) throw new Error(await readError(response, "Homepage Media could not be loaded."));
    return (await response.json()) as MediaPayload;
  }, []);

  /** Re-reads the rail and the company list after any change, so a company verified or
   * reactivated here becomes addable at once, without reloading the browser page. */
  const reload = useCallback(async () => {
    try {
      setData(await fetchMedia());
      setLoadError("");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Homepage Media could not be loaded.");
    }
  }, [fetchMedia]);

  useEffect(() => {
    const controller = new AbortController();
    fetchMedia(controller.signal)
      .then((payload) => setData(payload))
      .catch((caught) => {
        if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "Homepage Media could not be loaded.");
      });
    return () => controller.abort();
  }, [fetchMedia]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const permissions = data?.permissions ?? { canVerify: false, canManageHomepage: false };
  const railByCompany = useMemo(() => new Map(items.map((item) => [item.marketplaceProfessionalId, item])), [items]);

  const readyCount = candidates.filter(isHomepageEligible).length;
  const readyNotOnRail = candidates.filter((company) => isHomepageEligible(company) && !railByCompany.has(company.id)).length;
  const publishedCount = items.filter((item) => item.isPublished && isHomepageEligible(item.marketplaceProfessional)).length;
  const attentionCount = candidates.filter((company) => !isArchived(company) && !isHomepageEligible(company)).length;

  const term = search.trim().toLowerCase();
  const visibleCompanies = candidates.filter((company) => inFilter(company, filter) && matches(company, term));

  function begin(key: string) {
    setBusy(key);
    setError("");
    setNotice("");
  }

  async function mutate(key: string, request: () => Promise<Response>, success: string, fallback: string) {
    begin(key);
    try {
      const response = await request();
      if (!response.ok) throw new Error(await readError(response, fallback));
      setNotice(success);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  function setPublished(item: RailItem, isPublished: boolean) {
    const name = item.marketplaceProfessional.displayName;
    return mutate(
      item.id,
      () => fetch(`/api/platform-admin/homepage-media/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isPublished }) }),
      isPublished ? `${name} is published on the homepage.` : `${name} is hidden from the homepage.`,
      isPublished ? "Could not publish this company." : "Could not unpublish this company.",
    );
  }

  function move(item: RailItem, direction: -1 | 1) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const ids = items.map((entry) => entry.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return mutate(
      item.id,
      () => fetch("/api/platform-admin/homepage-media/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }),
      `${item.marketplaceProfessional.displayName} moved to position ${target + 1}.`,
      "Could not reorder the homepage rail.",
    );
  }

  async function remove(item: RailItem) {
    await mutate(
      item.id,
      () => fetch(`/api/platform-admin/homepage-media/${item.id}`, { method: "DELETE" }),
      `${item.marketplaceProfessional.displayName} was removed from the homepage rail.`,
      "Could not remove this company.",
    );
    setRemoving(null);
  }

  async function addToHomepage(company: Company) {
    await mutate(
      company.id,
      () => fetch("/api/platform-admin/homepage-media", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketplaceProfessionalId: company.id, isPublished: true }) }),
      `${company.displayName} was added to the homepage rail and published.`,
      "Could not add this company.",
    );
  }

  async function lifecycleDone(message: string) {
    setLifecycle(null);
    setError("");
    setNotice(message);
    await reload();
  }

  if (!data) {
    return loadError
      ? <ErrorState message={loadError} onRetry={() => void reload()} title="Homepage Media is unavailable" />
      : <LoadingState label="Loading Homepage Media" />;
  }

  const addButton = (
    <button className={buttonClass("primary")} onClick={() => { setAddOpen(true); setNotice(""); setError(""); }} type="button">
      Add company logo
    </button>
  );

  return (
    <div className="grid gap-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Controls the trusted companies and logos shown on the public NesAfric homepage. Only active, verified companies
          (brokerages, real estate companies, developers and property marketing companies) can appear. Advertising remains
          managed through <Link className="font-semibold text-forest underline-offset-4 hover:underline" href="/platform-admin/campaigns">Campaigns</Link>.
        </p>
        {addButton}
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-hairline lg:grid-cols-4">
        {[
          ["Live on homepage", publishedCount, "Published and eligible"],
          ["In the rail", items.length, `${items.length - publishedCount} not shown publicly`],
          ["Ready to add", readyNotOnRail, `${readyCount} verified companies in total`],
          ["Need attention", attentionCount, "Unverified or suspended"],
        ].map(([label, value, hint]) => (
          <div className="bg-white px-5 py-4" key={String(label)}>
            <dt className="text-xs font-medium text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-forest-deep">{value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
          </div>
        ))}
      </dl>

      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {error && <ErrorState message={error} title="That change was not saved" />}
      {loadError && <ErrorState message={loadError} onRetry={() => void reload()} title="Could not refresh" />}

      <section aria-labelledby="rail-heading" className="overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-forest-deep" id="rail-heading">Homepage company rail</h2>
            <p className="mt-0.5 text-sm text-muted">Published companies appear on the public homepage in this order.</p>
          </div>
          <Link className={buttonClass("tertiary")} href="/" target="_blank">View homepage ↗</Link>
        </header>

        {items.length === 0 ? (
          readyCount === 0 ? (
            <div className="px-5 py-10">
              <p className="font-semibold text-forest-deep">No verified companies are available yet.</p>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                A company must be verified and have an active account before its logo can be featured.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className={buttonClass("primary")} href="/platform-admin/professionals">Verify a company</Link>
                <button className={buttonClass("secondary")} onClick={() => setAddOpen(true)} type="button">Browse companies</button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-10">
              <p className="font-semibold text-forest-deep">Verified companies are available but none have been added to the homepage.</p>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
                {readyCount} verified {readyCount === 1 ? "company is" : "companies are"} ready. Until one is added, the public homepage shows its empty state.
              </p>
              <div className="mt-4">{addButton}</div>
            </div>
          )
        ) : (
          <ol className="divide-y divide-hairline">
            {items.map((item, index) => {
              const company = item.marketplaceProfessional;
              const blocked = homepageIneligibilityReason(company);
              const rowBusy = busy === item.id;
              return (
                <li className="grid gap-4 px-5 py-4 lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] lg:items-center" key={item.id}>
                  <span aria-label={`Position ${index + 1}`} className="hidden text-sm font-semibold tabular-nums text-muted lg:block">{index + 1}</span>
                  <div className="flex min-w-0 items-center gap-4">
                    <CompanyLogo logoUrl={company.logoUrl} name={company.displayName} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        <span className="text-muted lg:hidden">{index + 1}. </span>{company.displayName}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{humanizeStatus(company.type)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <HomepageBadge state={item.isPublished ? "published" : "hidden"} />
                        {blocked && <AccountBadge status={company.archivedAt ? "ARCHIVED" : company.status} />}
                        {blocked && <VerificationBadge status={company.verificationStatus} />}
                      </div>
                      {blocked && item.isPublished && (
                        <p className="mt-2 text-xs font-medium text-warning-ink">Not shown publicly: {blocked}</p>
                      )}
                      {!company.logoUrl && (
                        <p className="mt-2 text-xs text-muted">
                          No logo uploaded. The rail shows the company name until a logo is added.{" "}
                          {permissions.canVerify && <button className="font-semibold text-forest underline-offset-4 hover:underline" onClick={() => setLogoCompany(company)} type="button">Upload logo</button>}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button aria-label={`Move ${company.displayName} up`} className={buttonClass("secondary", "sm")} disabled={rowBusy || busy !== null || index === 0} onClick={() => void move(item, -1)} type="button">
                      <span aria-hidden="true">↑</span> Up
                    </button>
                    <button aria-label={`Move ${company.displayName} down`} className={buttonClass("secondary", "sm")} disabled={rowBusy || busy !== null || index === items.length - 1} onClick={() => void move(item, 1)} type="button">
                      <span aria-hidden="true">↓</span> Down
                    </button>
                    {item.isPublished ? (
                      <button className={buttonClass("secondary", "sm")} disabled={rowBusy} onClick={() => void setPublished(item, false)} type="button">Unpublish</button>
                    ) : (
                      <button className={buttonClass("primary", "sm")} disabled={rowBusy || Boolean(blocked)} onClick={() => void setPublished(item, true)} title={blocked ?? undefined} type="button">Publish</button>
                    )}
                    <button className={`${buttonClass("tertiary")} px-1 text-danger-ink hover:text-danger`} disabled={rowBusy} onClick={() => setRemoving(item)} type="button">Remove</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="companies-heading" className="overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-white">
        <header className="grid gap-4 border-b border-hairline px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-forest-deep" id="companies-heading">Marketplace companies</h2>
              <p className="mt-0.5 text-sm text-muted">
                Every brokerage, real estate company, developer and property marketing company. Individual agents, brokers and other types cannot be featured.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div aria-label="Filter companies" className="flex flex-wrap gap-1.5" role="group">
              {FILTERS.map((option) => (
                <button
                  aria-pressed={filter === option.key}
                  className={`min-h-9 rounded-full border px-3 text-[13px] font-medium transition-colors ${filter === option.key ? "border-forest bg-forest text-white" : "border-hairline bg-white text-ink hover:border-forest/40"}`}
                  key={option.key}
                  onClick={() => setFilter(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="md:w-72">
              <span className="sr-only">Search companies</span>
              <input className={controlClass} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or slug" type="search" value={search} />
            </label>
          </div>
        </header>

        {visibleCompanies.length === 0 ? (
          <p className="px-5 py-10 text-sm text-muted">
            {candidates.length === 0 ? "No companies have registered on the marketplace yet." : "No companies match this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium" scope="col">Company</th>
                  <th className="px-3 py-3 font-medium" scope="col">Type</th>
                  <th className="px-3 py-3 font-medium" scope="col">Status</th>
                  <th className="px-3 py-3 font-medium" scope="col">Homepage</th>
                  <th className="px-3 py-3 font-medium" scope="col">Position</th>
                  <th className="px-5 py-3 font-medium" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {visibleCompanies.map((company) => {
                  const item = railByCompany.get(company.id);
                  const position = item ? items.indexOf(item) + 1 : null;
                  const actions = professionalLifecycleActions(company, permissions, { onHomepage: Boolean(item) });
                  const rowBusy = busy !== null && (busy === company.id || busy === item?.id);
                  return (
                    <tr className="align-top" key={company.id}>
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <CompanyLogo logoUrl={company.logoUrl} name={company.displayName} size="sm" />
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">{company.displayName}</p>
                            <Link className="text-xs text-muted hover:text-forest hover:underline" href={`/marketplace/professionals/${company.slug}`} target="_blank">/{company.slug} ↗</Link>
                            {!company.logoUrl && <p className="mt-1 text-xs text-warning-ink">No logo uploaded</p>}
                            {permissions.canVerify && !isArchived(company) && (
                              <button className="mt-1 block text-xs font-semibold text-forest underline-offset-4 hover:underline" onClick={() => setLogoCompany(company)} type="button">
                                {company.logoUrl ? "Change logo" : "Upload logo"}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-xs text-ink">{humanizeStatus(company.type)}</td>
                      <td className="px-3 py-4">
                        <div className="flex flex-col items-start gap-1.5">
                          <AccountBadge status={company.archivedAt ? "ARCHIVED" : company.status} />
                          <VerificationBadge status={company.verificationStatus} />
                        </div>
                      </td>
                      <td className="px-3 py-4"><HomepageBadge state={item ? (item.isPublished ? "published" : "hidden") : "none"} /></td>
                      <td className="px-3 py-4 tabular-nums text-muted">{position ?? "—"}</td>
                      <td className="px-5 py-4">
                        <div className="flex max-w-md flex-wrap gap-2">
                          <LifecycleActionButtons
                            actions={actions}
                            disabled={rowBusy}
                            onSelect={(action) => {
                              if (action.kind === "add_to_homepage") void addToHomepage(company);
                              else setLifecycle({ company, action });
                            }}
                          />
                          {item && (item.isPublished ? (
                            <button className={buttonClass("secondary", "sm")} disabled={rowBusy} onClick={() => void setPublished(item, false)} type="button">Unpublish</button>
                          ) : (
                            <button className={buttonClass("secondary", "sm")} disabled={rowBusy || !isHomepageEligible(company)} onClick={() => void setPublished(item, true)} type="button">Publish</button>
                          ))}
                          {item && <button className={buttonClass("secondary", "sm")} disabled={rowBusy} onClick={() => setRemoving(item)} type="button">Remove from homepage</button>}
                          {isArchived(company) && <span className="text-xs text-muted">Archived profiles are read-only.</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-panel)] border border-hairline bg-surface px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-forest-deep">Advertising is managed in Campaigns</h2>
          <p className="mt-0.5 text-sm text-muted">Homepage Media only curates the trusted-company rail. Banners and promotions stay in Campaigns.</p>
        </div>
        <Link className={buttonClass("secondary", "sm")} href="/platform-admin/campaigns">Manage campaigns</Link>
      </section>

      {addOpen && (
        <AddCompanyDialog
          candidates={candidates}
          onAdded={async (message) => { setNotice(message); setError(""); await reload(); }}
          onChanged={reload}
          onClose={() => setAddOpen(false)}
          permissions={permissions}
          railByCompany={railByCompany}
        />
      )}

      {lifecycle && (
        <LifecycleDialog
          action={lifecycle.action}
          onClose={() => setLifecycle(null)}
          onDone={(message) => lifecycleDone(message)}
          professional={lifecycle.company}
        />
      )}

      {logoCompany && (
        <Dialog
          description="This is the company's own profile logo. It updates the public profile and, if featured, the homepage rail. The business can also change it from its workspace."
          footer={<button className={buttonClass("secondary")} onClick={() => setLogoCompany(null)} type="button">Done</button>}
          onClose={() => setLogoCompany(null)}
          title={`Logo: ${logoCompany.displayName}`}
        >
          <MarketplaceLogoUploader
            canEdit
            endpoint={`/api/platform-admin/professionals/${logoCompany.id}/logo`}
            logoUrl={logoCompany.logoUrl ?? null}
            name={logoCompany.displayName}
            onChange={(logoUrl) => {
              setLogoCompany((current) => (current ? { ...current, logoUrl } : current));
              void reload();
            }}
          />
        </Dialog>
      )}

      {removing && (
        <Dialog
          busy={busy === removing.id}
          description="The company stays verified and keeps its marketplace profile. Only its place in the homepage rail is removed."
          footer={
            <>
              <button className={buttonClass("secondary")} disabled={busy === removing.id} onClick={() => setRemoving(null)} type="button">Cancel</button>
              <button className={buttonClass("danger")} disabled={busy === removing.id} onClick={() => void remove(removing)} type="button">
                {busy === removing.id ? "Removing…" : "Remove from homepage"}
              </button>
            </>
          }
          onClose={() => setRemoving(null)}
          title={`Remove ${removing.marketplaceProfessional.displayName}?`}
        />
      )}
    </div>
  );
}

/** Picker for adding a company to the rail. Only eligible company types are listed. Companies
 * that are not yet verified or active can be fixed in place; once a company is ACTIVE and
 * VERIFIED its row offers "Add to homepage" straight away. */
function AddCompanyDialog({ candidates, railByCompany, permissions, onClose, onAdded, onChanged }: {
  candidates: Candidate[];
  railByCompany: Map<string, RailItem>;
  permissions: LifecyclePermissions;
  onClose: () => void;
  onAdded: (message: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<{ id: string; action: LifecycleAction } | null>(null);
  const [note, setNote] = useState("");

  const term = search.trim().toLowerCase();
  const available = candidates
    .filter((company) => !railByCompany.has(company.id) && matches(company, term))
    .sort((a, b) => Number(isHomepageEligible(b)) - Number(isHomepageEligible(a)));

  async function add(company: Candidate) {
    setBusy(company.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform-admin/homepage-media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketplaceProfessionalId: company.id, isPublished: true }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not add this company."));
      await onAdded(`${company.displayName} was added to the homepage rail and published.`);
      setNotice(`${company.displayName} added and published.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this company.");
    } finally {
      setBusy(null);
    }
  }

  async function runLifecycle(company: Candidate, action: LifecycleAction) {
    if (action.reasonRequired && !note.trim()) { setError("Enter a reason. It is saved in the audit history."); return; }
    setBusy(company.id);
    setError("");
    setNotice("");
    try {
      await performLifecycleAction(company, action, note);
      setConfirming(null);
      setNote("");
      await onChanged();
      setNotice(successMessage(company, action));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      busy={busy !== null}
      description="Choose a company registered on the NesAfric marketplace. Its marketplace name and logo are used as-is."
      footer={<button className={buttonClass("secondary")} disabled={busy !== null} onClick={onClose} type="button">Done</button>}
      onClose={onClose}
      size="lg"
      title="Add company logo"
    >
      <label className={fieldLabelClass} htmlFor="add-company-search">Search companies</label>
      <input className={controlClass} id="add-company-search" onChange={(event) => setSearch(event.target.value)} placeholder="Company name or slug" type="search" value={search} />

      {notice && <SuccessNotice className="mt-3">{notice}</SuccessNotice>}
      {error && <p className="mt-3 border-l-2 border-danger bg-danger-tint px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p>}

      {available.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {term ? "No companies match your search." : "Every eligible company is already in the homepage rail."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
          {available.map((company) => {
            const eligible = isHomepageEligible(company);
            const reason = homepageIneligibilityReason(company);
            // Only the fixes that move a company toward eligibility belong in this picker.
            const fixes = professionalLifecycleActions(company, permissions).filter((action) =>
              ["verify", "reinstate_verification", "reactivate_account"].includes(action.kind),
            );
            const open = confirming?.id === company.id ? confirming.action : null;
            const rowBusy = busy === company.id;
            return (
              <li className="py-3" key={company.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <CompanyLogo logoUrl={company.logoUrl} name={company.displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{company.displayName}</p>
                    <p className="text-xs text-muted">{humanizeStatus(company.type)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <AccountBadge status={company.archivedAt ? "ARCHIVED" : company.status} />
                      <VerificationBadge status={company.verificationStatus} />
                    </div>
                    {!company.logoUrl && <p className="mt-1.5 text-xs text-warning-ink">No logo uploaded. The company adds its logo from its marketplace profile.</p>}
                    {reason && <p className="mt-1.5 text-xs text-muted">{reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {eligible && permissions.canManageHomepage && (
                      <button className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={() => void add(company)} type="button">
                        {rowBusy ? "Adding…" : "Add to homepage"}
                      </button>
                    )}
                    {!open && fixes.map((action) => (
                      <button className={buttonClass(action.kind === "reactivate_account" ? "secondary" : "primary", "sm")} disabled={busy !== null} key={action.kind} onClick={() => { setConfirming({ id: company.id, action }); setNote(""); setError(""); }} type="button">
                        {action.kind === "verify" ? "Verify company" : action.label}
                      </button>
                    ))}
                    {!eligible && fixes.length === 0 && !isArchived(company) && !permissions.canVerify && (
                      <span className="text-xs text-muted">Needs a verification admin</span>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="mt-3 rounded-[var(--radius-control)] border border-hairline bg-warm-white p-3">
                    <p className="text-sm text-ink">
                      <span className="font-semibold">{open.label}</span>
                      {open.target && <> · {humanizeStatus(open.kind === "reactivate_account" ? company.status : company.verificationStatus)} → {humanizeStatus(open.target)}</>}
                    </p>
                    <label className={`${fieldLabelClass} mt-3`} htmlFor={`note-${company.id}`}>Note (optional)</label>
                    <textarea className={textareaClass} id={`note-${company.id}`} maxLength={2000} onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={() => void runLifecycle(company, open)} type="button">
                        {rowBusy ? "Saving…" : `Confirm ${open.label.toLowerCase()}`}
                      </button>
                      <button className={buttonClass("secondary", "sm")} disabled={busy !== null} onClick={() => setConfirming(null)} type="button">Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
