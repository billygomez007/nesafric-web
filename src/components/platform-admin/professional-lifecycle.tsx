"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass, buttonSizes } from "@/components/ui/button-styles";
import { fieldLabelClass, textareaClass } from "@/components/ui/field-styles";
import { usePlatformPermission } from "@/components/platform-admin/shell";
import { PLATFORM_PERMISSIONS } from "@/platform/platform-admin/permissions";
import type { LifecycleAction, LifecyclePermissions } from "@/modules/marketplace-professionals/admin-lifecycle";

/** The fields every lifecycle control needs about a marketplace professional. */
export type LifecycleProfessional = {
  id: string;
  displayName: string;
  type: string;
  status: string;
  verificationStatus: string;
  archivedAt?: string | null;
};

export function humanizeStatus(value: string) {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TONES = {
  positive: "border-success/25 bg-success-tint text-success",
  pending: "border-gold/40 bg-warning-tint text-warning-ink",
  negative: "border-danger/25 bg-danger-tint text-danger-ink",
  neutral: "border-hairline bg-surface text-muted",
} as const;

function verificationTone(status: string): keyof typeof TONES {
  if (status === "VERIFIED") return "positive";
  if (status === "PENDING") return "pending";
  if (status === "REJECTED" || status === "SUSPENDED") return "negative";
  return "neutral";
}

function accountTone(status: string): keyof typeof TONES {
  if (status === "ACTIVE") return "positive";
  if (status === "SUSPENDED") return "negative";
  return "neutral";
}

function Badge({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONES }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      <span className="font-medium opacity-75">{label}</span>
      {humanizeStatus(value)}
    </span>
  );
}

/** Account and verification are separate concerns and are always shown as two badges. */
export function AccountBadge({ status }: { status: string }) {
  return <Badge label="Account" tone={accountTone(status)} value={status} />;
}

export function VerificationBadge({ status }: { status: string }) {
  return <Badge label="Verification" tone={verificationTone(status)} value={status} />;
}

export function HomepageBadge({ state }: { state: "published" | "hidden" | "none" }) {
  if (state === "none") return <Badge label="Homepage" tone="neutral" value="Not added" />;
  return <Badge label="Homepage" tone={state === "published" ? "positive" : "pending"} value={state === "published" ? "Published" : "Hidden"} />;
}

export function CompanyLogo({ name, logoUrl, size = "md" }: { name: string; logoUrl?: string | null; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-10 w-10" : "h-12 w-16";
  if (logoUrl) {
    return (
      <span className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-hairline bg-white p-1`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`${name} logo`} className="max-h-full max-w-full object-contain" src={logoUrl} />
      </span>
    );
  }
  return (
    <span className={`flex ${box} shrink-0 flex-col items-center justify-center rounded-[var(--radius-control)] border border-dashed border-hairline bg-surface text-center text-[10px] font-medium leading-tight text-muted`}>
      No logo
      <span className="sr-only"> uploaded for {name}</span>
    </span>
  );
}

export function useLifecyclePermissions(): LifecyclePermissions {
  return {
    canVerify: usePlatformPermission(PLATFORM_PERMISSIONS.marketplaceVerify),
    canManageHomepage: usePlatformPermission(PLATFORM_PERMISSIONS.homepageMediaManage),
  };
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/** Sends one lifecycle action to its API. Resolves with the response body, or throws an Error
 * carrying the API's own message. */
export async function performLifecycleAction(professional: LifecycleProfessional, action: LifecycleAction, reason: string) {
  const trimmed = reason.trim();
  let response: Response;

  if (action.kind === "add_to_homepage") {
    response = await fetch("/api/platform-admin/homepage-media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketplaceProfessionalId: professional.id, isPublished: true }),
    });
  } else if (action.kind === "suspend_account" || action.kind === "reactivate_account") {
    response = await fetch(`/api/platform-admin/professionals/${professional.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: action.target, expectedStatus: professional.status, ...(trimmed ? { reason: trimmed } : {}) }),
    });
  } else {
    response = await fetch(`/api/platform-admin/professionals/${professional.id}/verification`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: action.target, expectedStatus: professional.verificationStatus, ...(trimmed ? { reason: trimmed } : {}) }),
    });
  }

  if (!response.ok) throw new Error(await readError(response, `Could not ${action.label.toLowerCase()}.`));
  return response.json();
}

export function successMessage(professional: LifecycleProfessional, action: LifecycleAction) {
  switch (action.kind) {
    case "verify": return `${professional.displayName} is now verified.`;
    case "reinstate_verification": return `${professional.displayName}'s verification was reinstated.`;
    case "reject": return `${professional.displayName}'s verification was rejected.`;
    case "suspend_verification": return `${professional.displayName}'s verification was suspended.`;
    case "suspend_account": return `${professional.displayName}'s account was suspended.`;
    case "reactivate_account": return `${professional.displayName}'s account is active again.`;
    case "add_to_homepage": return `${professional.displayName} was added to the homepage rail and published.`;
  }
}

const EXPLANATIONS: Record<LifecycleAction["kind"], string> = {
  verify: "Marks the company as verified. Verified, active companies can be featured on the homepage.",
  reinstate_verification: "Restores the company's verified status.",
  reject: "Rejects this company's verification. The reason is recorded in the verification history.",
  suspend_verification: "Removes the verified status. The company leaves the public homepage rail until reinstated.",
  suspend_account: "Suspends the account. Verification is unchanged, but the profile is hidden from the public marketplace and homepage.",
  reactivate_account: "Makes the account active again. Verification is unchanged.",
  add_to_homepage: "Adds the company's marketplace logo to the homepage rail and publishes it.",
};

/** Destructive-but-not-final action (opens a confirmation): outlined in danger, not filled. */
const dangerOutline =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border border-danger/30 bg-white text-sm font-semibold text-danger-ink transition-colors duration-150 hover:border-danger/60 hover:bg-danger-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong disabled:pointer-events-none disabled:border-hairline disabled:bg-surface disabled:text-slate-500";

/** Buttons for exactly the actions the lifecycle rules allow. Primary actions first. */
export function LifecycleActionButtons({ actions, onSelect, disabled, size = "sm" }: {
  actions: LifecycleAction[];
  onSelect: (action: LifecycleAction) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const order = { primary: 0, secondary: 1, danger: 2 } as const;
  const sorted = [...actions].sort((a, b) => order[a.tone] - order[b.tone]);
  return (
    <>
      {sorted.map((action) => (
        <button
          className={action.tone === "danger" ? `${dangerOutline} ${buttonSizes[size]}` : buttonClass(action.tone, size)}
          disabled={disabled}
          key={action.kind}
          onClick={() => onSelect(action)}
          type="button"
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

/** Confirmation step for one lifecycle action. Collects the reason (required for rejection and
 * suspension, optional note otherwise) and reports the API result. */
export function LifecycleDialog({ professional, action, onClose, onDone }: {
  professional: LifecycleProfessional;
  action: LifecycleAction;
  onClose: () => void;
  onDone: (message: string, body: unknown) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const collectsReason = action.kind !== "add_to_homepage";
  const missingReason = action.reasonRequired && reason.trim().length === 0;

  async function confirm() {
    if (missingReason) { setError("Enter a reason. It is saved in the audit history."); return; }
    setBusy(true);
    setError("");
    try {
      const body = await performLifecycleAction(professional, action, reason);
      await onDone(successMessage(professional, action), body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
      setBusy(false);
    }
  }

  const fromValue = action.kind === "suspend_account" || action.kind === "reactivate_account" ? professional.status : professional.verificationStatus;

  return (
    <Dialog
      busy={busy}
      description={EXPLANATIONS[action.kind]}
      footer={
        <>
          <button className={buttonClass("secondary")} disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className={buttonClass(action.tone === "danger" ? "danger" : "primary")} disabled={busy} onClick={() => void confirm()} type="button">
            {busy ? "Saving…" : action.label}
          </button>
        </>
      }
      onClose={onClose}
      title={`${action.label}: ${professional.displayName}`}
    >
      {action.target && (
        <p className="text-sm text-muted">
          {action.kind === "suspend_account" || action.kind === "reactivate_account" ? "Account" : "Verification"}:{" "}
          <span className="font-semibold text-ink">{humanizeStatus(fromValue)}</span>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> to </span>
          <span className="font-semibold text-ink">{humanizeStatus(action.target)}</span>
        </p>
      )}
      {collectsReason && (
        <div className="mt-4">
          <label className={fieldLabelClass} htmlFor="lifecycle-reason">
            {action.reasonRequired ? "Reason (required)" : "Note (optional)"}
          </label>
          <textarea
            className={textareaClass}
            id="lifecycle-reason"
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            placeholder={action.reasonRequired ? "Explain this decision" : "Add context for the audit history"}
            rows={3}
            value={reason}
          />
        </div>
      )}
      {error && <p className="mt-3 border-l-2 border-danger bg-danger-tint px-3 py-2 text-sm text-danger-ink" role="alert">{error}</p>}
    </Dialog>
  );
}
