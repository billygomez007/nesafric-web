"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Professional = {
  id: string;
  displayName: string;
  legalName?: string | null;
  slug: string;
  logoUrl?: string | null;
  type?: string | null;
  verificationStatus?: string | null;
};

type HomepageCompany = {
  id: string;
  marketplaceProfessionalId: string;
  isPublished: boolean;
  sortOrder: number;
  marketplaceProfessional?: Professional | null;
};

function displayName(item: HomepageCompany) {
  return item.marketplaceProfessional?.displayName || "Company";
}

function logoUrl(item: HomepageCompany) {
  return item.marketplaceProfessional?.logoUrl || null;
}

async function readError(response: Response) {
  try {
    const payload = await response.json();
    return (
      payload?.error?.message ||
      payload?.message ||
      payload?.error ||
      `Request failed (${response.status})`
    );
  } catch {
    return `Request failed (${response.status})`;
  }
}

export function HomepageMediaContent() {
  const [items, setItems] = useState<HomepageCompany[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const mediaResponse = await fetch("/api/platform-admin/homepage-media", {
        cache: "no-store",
      });

      if (!mediaResponse.ok) {
        throw new Error(await readError(mediaResponse));
      }

      const mediaPayload = await mediaResponse.json();

      const mediaItems = Array.isArray(mediaPayload)
        ? mediaPayload
        : mediaPayload.items ?? [];

      const professionalItems = Array.isArray(mediaPayload?.eligibleProfessionals)
        ? mediaPayload.eligibleProfessionals
        : [];

      setItems(mediaItems);
      setProfessionals(professionalItems);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load homepage media.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const mediaResponse = await fetch("/api/platform-admin/homepage-media", {
          cache: "no-store",
        });

        if (!mediaResponse.ok) {
          throw new Error(await readError(mediaResponse));
        }

        const mediaPayload = await mediaResponse.json();

        if (cancelled) return;

        const mediaItems = Array.isArray(mediaPayload)
          ? mediaPayload
          : mediaPayload.items ?? [];

        const professionalItems = Array.isArray(
          mediaPayload?.eligibleProfessionals,
        )
          ? mediaPayload.eligibleProfessionals
          : [];

        setItems(mediaItems);
        setProfessionals(professionalItems);
      } catch (nextError) {
        if (cancelled) return;

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Unable to load homepage media.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIds = useMemo(
    () =>
      new Set(
        items
          .map((item) => item.marketplaceProfessionalId)
          .filter((value): value is string => Boolean(value)),
      ),
    [items],
  );

  const availableProfessionals = useMemo(() => {
    const term = search.trim().toLowerCase();

    return professionals.filter((professional) => {
      if (selectedIds.has(professional.id)) return false;

      if (!term) return true;

      return [
        professional.displayName,
        professional.legalName,
        professional.slug,
        professional.type,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [professionals, search, selectedIds]);

  async function addCompany() {
    if (!selectedProfessionalId) return;

    setSaving("add");
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/platform-admin/homepage-media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplaceProfessionalId: selectedProfessionalId,
          isPublished: true,
          sortOrder: items.length,
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setSelectedProfessionalId("");
      setMessage("Company added to the homepage logo rail.");
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to add company.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function patchItem(
    item: HomepageCompany,
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    setSaving(item.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/platform-admin/homepage-media/${item.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage(successMessage);
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update homepage media.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function removeItem(item: HomepageCompany) {
    if (
      !window.confirm(
        `Remove ${displayName(item)} from the homepage logo manager?`,
      )
    ) {
      return;
    }

    setSaving(item.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/api/platform-admin/homepage-media/${item.id}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setMessage("Company removed from Homepage Media.");
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to remove homepage media.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function move(item: HomepageCompany, direction: -1 | 1) {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = index + direction;

    if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;

    const target = items[targetIndex];

    setSaving(item.id);
    setError(null);
    setMessage(null);

    try {
      const firstResponse = await fetch(
        `/api/platform-admin/homepage-media/${item.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sortOrder: target.sortOrder }),
        },
      );

      if (!firstResponse.ok) {
        throw new Error(await readError(firstResponse));
      }

      const secondResponse = await fetch(
        `/api/platform-admin/homepage-media/${target.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sortOrder: item.sortOrder }),
        },
      );

      if (!secondResponse.ok) {
        throw new Error(await readError(secondResponse));
      }

      setMessage("Homepage logo order updated.");
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to reorder homepage media.",
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
          Marketplace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Homepage Media
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Control the companies displayed in the homepage logo rail. Only
          verified marketplace companies should be published as real companies.
          Advertising creative remains managed through Campaigns.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-950">
            Add a verified company
          </h2>
          <p className="text-sm text-slate-600">
            Select a verified company already registered in the NesAfric
            marketplace. Its current marketplace name and logo remain the
            source of truth.
          </p>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search verified companies"
            className="h-11 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-500"
          />

          <select
            value={selectedProfessionalId}
            onChange={(event) =>
              setSelectedProfessionalId(event.target.value)
            }
            className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-500"
          >
            <option value="">Choose a verified company</option>
            {availableProfessionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.displayName}
                {professional.type ? ` — ${professional.type}` : ""}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void addCompany()}
            disabled={!selectedProfessionalId || saving === "add"}
            className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving === "add" ? "Adding…" : "Add company"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Homepage company rail
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Published companies appear publicly in this order.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            Loading Homepage Media…
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-medium text-slate-900">
              No homepage companies selected
            </p>
            <p className="mt-2 text-sm text-slate-500">
              The public homepage should show its truthful empty state until a
              verified company is selected.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((item, index) => {
              const logo = logoUrl(item);
              const name = displayName(item);
              const busy = saving === item.id;

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-2">
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logo}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-slate-400">
                          No logo
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">
                        {name}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>Position {index + 1}</span>
                        {item.marketplaceProfessional?.type ? (
                          <span>• {item.marketplaceProfessional.type}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void move(item, -1)}
                      disabled={busy || index === 0}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => void move(item, 1)}
                      disabled={busy || index === items.length - 1}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void patchItem(
                          item,
                          { isPublished: !item.isPublished },
                          item.isPublished
                            ? "Company hidden from the public homepage."
                            : "Company published on the public homepage.",
                        )
                      }
                      disabled={busy}
                      className={
                        item.isPublished
                          ? "rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
                          : "rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"
                      }
                    >
                      {item.isPublished ? "Published" : "Hidden"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void removeItem(item)}
                      disabled={busy}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="font-semibold text-slate-950">
          Advertising carousel
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Advertising remains under Marketplace → Campaigns. Homepage Media
          will not create a second advertising system. Campaign creatives will
          support separate desktop web, mobile web, and native app artwork.
        </p>
        <a
          href="/platform-admin/campaigns"
          className="mt-4 inline-flex rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200"
        >
          Manage campaigns
        </a>
      </section>
    </div>
  );
}
