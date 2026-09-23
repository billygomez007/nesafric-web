"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AccountProfile = {
  id: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
};

type Notice = {
  kind: "success" | "error";
  message: string;
} | null;

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/10";

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;

  return (
    <div
      className={
        notice.kind === "success"
          ? "rounded-xl border border-teal/20 bg-teal/5 px-4 py-3 text-sm text-forest"
          : "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      }
    >
      {notice.message}
    </div>
  );
}

function Card({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-hairline pb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal">
          {eyebrow}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function AccountSettings() {
  const router = useRouter();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [displayName, setDisplayName] = useState("");
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailNotice, setEmailNotice] = useState<Notice>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response = await fetch("/api/account/profile", { cache: "no-store" });
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body?.error?.message ?? "Unable to load your account.");
        }

        if (!cancelled) {
          setProfile(body);
          setDisplayName(body.displayName);
          setEmail(body.email);
        }
      } catch (error) {
        if (!cancelled) {
          setProfileNotice({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load your account.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateProfile(event: FormEvent) {
    event.preventDefault();
    setProfileNotice(null);
    setSavingProfile(true);

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to update your profile.");
      }

      setProfile(body);
      setProfileNotice({ kind: "success", message: "Profile updated successfully." });
      router.refresh();
    } catch (error) {
      setProfileNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to update your profile.",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function updateEmail(event: FormEvent) {
    event.preventDefault();
    setEmailNotice(null);
    setSavingEmail(true);

    try {
      const response = await fetch("/api/account/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, currentPassword: emailPassword }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to update your email.");
      }

      setProfile((current) =>
        current ? { ...current, email: body.email, emailVerified: false } : current,
      );
      setEmail(body.email);
      setEmailPassword("");
      setEmailNotice({
        kind: "success",
        message: "Email updated. Please use the new email the next time you sign in.",
      });
    } catch (error) {
      setEmailNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to update your email.",
      });
    } finally {
      setSavingEmail(false);
    }
  }

  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordNotice(null);

    if (newPassword !== confirmPassword) {
      setPasswordNotice({ kind: "error", message: "The new passwords do not match." });
      return;
    }

    setSavingPassword(true);

    try {
      const response = await fetch("/api/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Unable to change your password.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice({
        kind: "success",
        message: "Password changed successfully. Other signed-in sessions have been closed.",
      });
    } catch (error) {
      setPasswordNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to change your password.",
      });
    } finally {
      setSavingPassword(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });

    try {
      window.localStorage.removeItem("propertyos.activeOrganisationId");
      window.localStorage.removeItem("nesafric.activeMarketplaceProfessionalId");
    } catch {
      // Best effort only.
    }

    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-6 text-sm text-muted">
        Loading account settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card
        eyebrow="Profile"
        title="Your profile"
        description="This is the name shown across your NesAfric account and workspaces."
      >
        <form className="space-y-4" onSubmit={updateProfile}>
          <NoticeBanner notice={profileNotice} />

          <label className="block text-sm font-medium text-ink">
            Display name
            <input
              className={inputClass}
              maxLength={100}
              minLength={2}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              value={displayName}
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted">
              Account created {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}
            </p>
            <button
              className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingProfile}
              type="submit"
            >
              {savingProfile ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </Card>

      <Card
        eyebrow="Account"
        title="Email address"
        description="Change the email you use to sign in. For security, confirm the change with your current password."
      >
        <form className="space-y-4" onSubmit={updateEmail}>
          <NoticeBanner notice={emailNotice} />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-ink">
              Email
              <input
                className={inputClass}
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>

            <label className="block text-sm font-medium text-ink">
              Current password
              <input
                autoComplete="current-password"
                className={inputClass}
                onChange={(event) => setEmailPassword(event.target.value)}
                required
                type="password"
                value={emailPassword}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted">
              Status: {profile?.emailVerified ? "Verified" : "Verification required"}
            </p>
            <button
              className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingEmail}
              type="submit"
            >
              {savingEmail ? "Updating..." : "Change email"}
            </button>
          </div>
        </form>
      </Card>

      <Card
        eyebrow="Security"
        title="Change password"
        description="Use at least 12 characters. Changing your password closes your other active NesAfric sessions."
      >
        <form className="space-y-4" onSubmit={updatePassword}>
          <NoticeBanner notice={passwordNotice} />

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm font-medium text-ink">
              Current password
              <input
                autoComplete="current-password"
                className={inputClass}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                type="password"
                value={currentPassword}
              />
            </label>

            <label className="block text-sm font-medium text-ink">
              New password
              <input
                autoComplete="new-password"
                className={inputClass}
                minLength={12}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>

            <label className="block text-sm font-medium text-ink">
              Confirm new password
              <input
                autoComplete="new-password"
                className={inputClass}
                minLength={12}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
          </div>

          <div className="flex justify-end pt-1">
            <button
              className="rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60"
              disabled={savingPassword}
              type="submit"
            >
              {savingPassword ? "Changing..." : "Change password"}
            </button>
          </div>
        </form>
      </Card>

      <section className="rounded-2xl border border-hairline bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              Account actions
            </p>
            <h2 className="mt-1.5 text-lg font-semibold text-ink">Sign out</h2>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              End this session and return to the NesAfric sign-in page.
            </p>
          </div>

          <button
            className="rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-semibold text-forest transition hover:border-forest/30 hover:bg-cream"
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
