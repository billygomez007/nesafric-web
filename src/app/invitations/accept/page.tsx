"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type InvitationPreview = {
  organisationName: string;
  invitedEmail: string;
  inviterName: string;
  roleName: string;
  status: string;
  expiresAt: string;
};

function getInvitationToken() {
  if (typeof window === "undefined") {
    return "";
  }

  const fragment =
    window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;

  return (
    new URLSearchParams(fragment).get("token") ??
    ""
  );
}

function getInvitationReturnTarget() {
  if (typeof window === "undefined") {
    return "/invitations/accept";
  }

  return `${window.location.pathname}${window.location.hash}`;
}

export default function InvitationAcceptPage() {
  const router = useRouter();

  const [preview, setPreview] =
    useState<InvitationPreview | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [accepting, setAccepting] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      const rawToken =
        getInvitationToken();

      if (!rawToken) {
        await Promise.resolve();

        if (!cancelled) {
          setError(
            "This invitation link is invalid.",
          );

          setLoading(false);
        }

        return;
      }

      try {
        const response = await fetch(
          "/api/invitations/preview",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
            },
            body: JSON.stringify({
              token: rawToken,
            }),
            cache: "no-store",
          },
        );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error?.message ??
              data?.message ??
              "Unable to load this invitation.",
          );
        }

        if (!cancelled) {
          setPreview(data);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load this invitation.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, []);

  async function continueToAuth(
    mode: "login" | "register",
  ) {
    const response = await fetch(
      "/api/auth/return-to",
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          returnTo:
            getInvitationReturnTarget(),
        }),
      },
    );

    if (!response.ok) {
      setError(
        "Unable to continue to authentication.",
      );
      return;
    }

    router.push(
      mode === "login"
        ? "/login"
        : "/register",
    );
  }

  async function acceptInvitation() {
    const token =
      getInvitationToken();

    if (!token) {
      setError(
        "This invitation link is invalid.",
      );
      return;
    }

    setAccepting(true);
    setError("");

    try {
      const response = await fetch(
        "/api/invitations/accept",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            token,
          }),
        },
      );

      const data =
        await response.json();

      if (response.status === 401) {
        await continueToAuth("login");
        return;
      }

      if (!response.ok) {
        throw new Error(
          data?.error?.message ??
            data?.message ??
            "Unable to accept this invitation.",
        );
      }

      if (
        typeof data?.organisationId === "string" &&
        data.organisationId
      ) {
        localStorage.setItem(
          "propertyos.activeOrganisationId",
          data.organisationId,
        );
      }

      router.push("/dashboard");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to accept this invitation.",
      );
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-slate-500">
          Loading your invitation…
        </p>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-16">
        <section className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">
            NesAfric
          </p>

          <h1 className="mt-3 text-2xl font-semibold text-slate-950">
            Invitation unavailable
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-600">
            {error ||
              "This invitation could not be loaded."}
          </p>

          <Link
            href="/login"
            className="mt-6 inline-flex rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
          >
            Go to sign in
          </Link>
        </section>
      </main>
    );
  }

  const unavailable =
    preview.status === "EXPIRED" ||
    preview.status === "REVOKED";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-slate-950 px-8 py-10 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">
            NesAfric
          </p>

          <h1 className="mt-4 text-3xl font-semibold">
            You’re invited to join{" "}
            {preview.organisationName}
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            {preview.inviterName} invited you
            to collaborate in their NesAfric
            property workspace.
          </p>
        </div>

        <div className="space-y-6 p-8">
          <dl className="grid gap-5 rounded-2xl bg-slate-50 p-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Workspace
              </dt>
              <dd className="mt-1 font-medium text-slate-950">
                {preview.organisationName}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Role
              </dt>
              <dd className="mt-1 font-medium text-slate-950">
                {preview.roleName}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Invited email
              </dt>
              <dd className="mt-1 break-all font-medium text-slate-950">
                {preview.invitedEmail}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Expires
              </dt>
              <dd className="mt-1 font-medium text-slate-950">
                {new Date(
                  preview.expiresAt,
                ).toLocaleDateString(
                  "en-GB",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  },
                )}
              </dd>
            </div>
          </dl>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {unavailable ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-900">
              This invitation is no longer
              available. Ask the workspace
              administrator to send a new
              invitation.
            </div>
          ) : (
            <button
              type="button"
              disabled={accepting}
              onClick={() =>
                void acceptInvitation()
              }
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed"
            >
              {accepting
                ? "Accepting invitation…"
                : preview.status ===
                    "ACCEPTED"
                  ? "Open workspace"
                  : "Accept invitation"}
            </button>
          )}

          <p className="text-center text-sm leading-6 text-slate-500">
            Sign in with{" "}
            <strong>
              {preview.invitedEmail}
            </strong>{" "}
            to accept this invitation.
          </p>

          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <button
              type="button"
              className="font-semibold text-slate-950 underline"
              onClick={() =>
                void continueToAuth("login")
              }
            >
              Sign in
            </button>

            <button
              type="button"
              className="font-semibold text-slate-950 underline"
              onClick={() =>
                void continueToAuth("register")
              }
            >
              Create account
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
