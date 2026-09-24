"use client";

import { FormEvent, useEffect, useState } from "react";
import { PlatformAdminShell } from "@/components/platform-admin/shell";

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  platformPrincipal: {
    role: string;
    status: string;
  } | null;
  memberships: Array<{
    id: string;
    status: string;
    organisation: {
      id: string;
      name: string;
      type: string;
    };
    roles: Array<{
      role: {
        key: string;
        name: string;
      };
    }>;
  }>;
  marketplaceProfessionalMemberships: Array<{
    id: string;
    role: string;
    status: string;
    marketplaceProfessional: {
      id: string;
      displayName: string;
      type: string;
      status: string;
      verificationStatus: string;
    };
  }>;
  _count: {
    memberships: number;
    marketplaceProfessionalMemberships: number;
    sessions: number;
  };
};

function UsersContent() {
  const [users, setUsers] = useState<UserRow[]>([]);
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

    fetch(`/api/platform-admin/users?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();

        if (!response.ok) {
          throw new Error(
            body.error?.message ?? "Unable to load platform users.",
          );
        }

        return body as UserRow[];
      })
      .then((body) => {
        setUsers(body);
        setError("");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setError(
          error instanceof Error
            ? error.message
            : "Unable to load platform users.",
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

  return (
    <div className="grid gap-6">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          Identity & access
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-forest">Platform users</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              Search NesAfric accounts across PropertyOS and Marketplace Professional workspaces.
              Password hashes, session tokens and credentials are never exposed here.
            </p>
          </div>

          <div className="rounded-xl border border-hairline bg-white px-4 py-3 shadow-card">
            <p className="text-xs uppercase tracking-wider text-muted">Results</p>
            <p className="mt-1 text-2xl font-semibold text-forest">{users.length}</p>
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
          placeholder="Search by name or email"
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
        <p className="text-sm text-muted">Loading users…</p>
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-white p-8 text-center shadow-card">
          <h3 className="font-semibold text-forest">No users found</h3>
          <p className="mt-2 text-sm text-muted">
            Try another name or email address.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-hairline bg-warm-white text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-4 font-semibold">User</th>
                  <th className="px-5 py-4 font-semibold">Verification</th>
                  <th className="px-5 py-4 font-semibold">PropertyOS</th>
                  <th className="px-5 py-4 font-semibold">Marketplace</th>
                  <th className="px-5 py-4 font-semibold">Platform access</th>
                  <th className="px-5 py-4 font-semibold">Created</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-hairline">
                {users.map((user) => (
                  <tr className="align-top hover:bg-warm-white/60" key={user.id}>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">{user.displayName}</p>
                      <p className="mt-1 text-xs text-muted">{user.email}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted">{user.id}</p>
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          user.emailVerifiedAt
                            ? "bg-emerald/10 text-emerald"
                            : "bg-gold/15 text-forest"
                        }`}
                      >
                        {user.emailVerifiedAt ? "Email verified" : "Email pending"}
                      </span>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {user._count.memberships} workspace
                        {user._count.memberships === 1 ? "" : "s"}
                      </p>

                      <div className="mt-2 grid gap-1">
                        {user.memberships.slice(0, 3).map((membership) => (
                          <p className="text-xs text-muted" key={membership.id}>
                            {membership.organisation.name}
                            {membership.roles.length
                              ? ` · ${membership.roles
                                  .map((entry) => entry.role.name)
                                  .join(", ")}`
                              : ""}
                          </p>
                        ))}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <p className="font-semibold text-forest">
                        {user._count.marketplaceProfessionalMemberships} profile
                        {user._count.marketplaceProfessionalMemberships === 1 ? "" : "s"}
                      </p>

                      <div className="mt-2 grid gap-1">
                        {user.marketplaceProfessionalMemberships
                          .slice(0, 3)
                          .map((membership) => (
                            <p className="text-xs text-muted" key={membership.id}>
                              {membership.marketplaceProfessional.displayName}
                              {" · "}
                              {membership.role}
                            </p>
                          ))}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      {user.platformPrincipal ? (
                        <div>
                          <span className="inline-flex rounded-full bg-forest px-2.5 py-1 text-xs font-semibold text-white">
                            {user.platformPrincipal.role.replaceAll("_", " ")}
                          </span>
                          <p className="mt-2 text-xs text-muted">
                            {user.platformPrincipal.status}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">None</span>
                      )}
                    </td>

                    <td className="px-5 py-4 text-xs text-muted">
                      {new Date(user.createdAt).toLocaleDateString()}
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

export default function PlatformAdminUsersPage() {
  return (
    <PlatformAdminShell>
      <UsersContent />
    </PlatformAdminShell>
  );
}
